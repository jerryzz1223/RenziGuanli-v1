"""Permission-aware, single-employment employee history workbook.

No SQL/get_all, no file creation, no recalculation of attendance or support.
Each source is permission filtered; missing/denied sources remain explicit.
"""
from io import BytesIO
import json
import re

import frappe
from frappe.model import get_permitted_fields


PAGE_SIZE = 500
MAX_ROWS = 100000
NON_VALUES = {"Section Break", "Column Break", "Tab Break", "HTML", "Button", "Table", "Table MultiSelect", "Password", "Attach", "Attach Image", "Image"}


def _fields(doctype, names=None, parenttype=None):
	permitted = set(get_permitted_fields(doctype, parenttype=parenttype, user=frappe.session.user, permission_type="read", ignore_virtual=True))
	return [f for f in frappe.get_meta(doctype).fields
			if f.fieldname in permitted and f.fieldtype not in NON_VALUES
			and not f.get("hidden") and not f.fieldname.endswith("_json")
			and (names is None or f.fieldname in names)]


def _require_source(doctype):
	for permission in ("read", "export"):
		if not frappe.has_permission(doctype, permission):
			frappe.throw("无权读取或导出该履历数据来源。", frappe.PermissionError)


def _list(doctype, filters, fields):
	"""Stable pagination with Frappe row/user permissions, never silently truncate."""
	result = []
	while True:
		page = frappe.get_list(doctype, filters=filters, fields=fields,
							   order_by="name asc", limit_start=len(result), limit_page_length=PAGE_SIZE)
		result.extend(page)
		if len(result) > MAX_ROWS:
			frappe.throw("履历来源记录超过导出上限，请联系管理员分批归档。")
		if len(page) < PAGE_SIZE:
			return result


def _section(title, source, columns=(), rows=(), status=None):
	rows = list(rows)
	if len(rows) > MAX_ROWS:
		frappe.throw("履历明细展开后超过导出上限，请联系管理员分批归档。")
	return {"title": title, "source": source, "columns": list(columns), "rows": rows,
			"status": status or ("已读取（仅当前权限可见）" if rows else "暂无当前权限可见记录")}


def _collect(title, source, callback):
	try:
		return callback()
	except frappe.PermissionError:
		return _section(title, source, status="无读取或导出权限；未导出该区块")


def _records(title, doctype, filters, names=None, source_note=""):
	source = doctype + ("；" + source_note if source_note else "")
	if not frappe.db.exists("DocType", doctype):
		return _section(title, source, status="数据模型尚未安装")
	_require_source(doctype)
	fields = _fields(doctype, names)
	columns = [("name", "记录编号"), ("docstatus", "单据状态（0未提交1已提交2已取消）")] + [(f.fieldname, f.label or f.fieldname) for f in fields]
	rows, denied = [], False
	for row in _list(doctype, filters, [key for key, _ in columns]):
		try:
			record = frappe.get_doc(doctype, row["name"])
			record.check_permission("read")
			record.check_permission("export")
			rows.append(row)
		except frappe.PermissionError:
			denied = True
	return _section(title, source, columns, rows, "部分记录无权限，已跳过" if denied else None)


def _basic(employee):
	from hrms.utils.personnel_export_layout import display_value
	from hrms.api.employee_field_template import (
		TEMPLATE_DOCTYPE, _get_employee_export_fields, _get_allowed_export_fields,
	)
	# Export must not call the template synchronizer: it saves configuration on read.
	template = frappe.get_single(TEMPLATE_DOCTYPE)
	allowed = _get_allowed_export_fields(_get_employee_export_fields(template))
	fields = _fields("Employee", allowed)
	return _section("基本信息", "Employee；沿用花名册字段导出开关", [("label", "字段"), ("value", "内容")],
					[{"label": allowed[f.fieldname].get("field_label") or f.label, "value": display_value(f.fieldname, employee.get(f.fieldname))} for f in fields])


def _table_field(doctype, fieldname):
	"""Table fields are absent from get_permitted_fields; check their parent permlevel."""
	meta = frappe.get_meta(doctype)
	field = meta.get_field(fieldname)
	if field is None:
		return None
	level = int(field.get("permlevel") or 0)
	if field.get("hidden") or (level and level not in meta.get_permlevel_access(permission_type="read", user=frappe.session.user)):
		frappe.throw("无权读取该员工子表。", frappe.PermissionError)
	return field


def _child(employee, fieldname, title):
	field = _table_field("Employee", fieldname)
	if field is None:
		return _section(title, "Employee." + fieldname, status="数据模型尚未安装")
	fields = _fields(field.options, parenttype="Employee")
	return _section(title, "Employee." + fieldname,
					[(f.fieldname, f.label or f.fieldname) for f in fields],
					[{f.fieldname: row.get(f.fieldname) for f in fields} for row in employee.get(fieldname) or []])


def _education(employee):
	"""Include the flat education profile shown in employee detail as well as history."""
	section = _child(employee, "education", "教育背景")
	mapping = {
		"custom_education_level": ("qualification", "学历"),
		"custom_graduation_school": ("school_univ", "毕业院校"),
		"custom_major": ("major_opt_subj", "专业科系"),
	}
	# The Employee has already passed read/export checks. Apply field permissions
	# independently: a visible flat field never grants access to a child field.
	fields = _fields("Employee", set(mapping))
	flat = {mapping[f.fieldname][0]: employee.get(f.fieldname) for f in fields
			if employee.get(f.fieldname) not in (None, "")}
	columns = list(section["columns"])
	for f in fields:
		key, label = mapping[f.fieldname]
		if key not in dict(columns):
			columns.append((key, label))
	rows = list(section["rows"])
	# Suppress only a mirrored profile row, preserving every historical child row.
	if flat and not any(all(row.get(key) == value for key, value in flat.items()) for row in rows):
		rows.append(flat)
	status = None
	if section["status"] == "数据模型尚未安装":
		status = "已读取员工档案学历资料；教育经历子表尚未安装" if flat else section["status"]
	return _section("教育背景", "Employee.education；员工档案学历、毕业院校、专业科系", columns, rows, status)


def _training(employee):
	"""Read permitted parent docs, export only this employee's child rows."""
	title, source = "教育训练", "Training Result / Training Event / Training Result Employee"
	for doctype in ("Training Result", "Training Event", "Training Result Employee"):
		if not frappe.db.exists("DocType", doctype):
			return _section(title, source, status="培训数据模型尚未安装：" + doctype)
	if not employee.get("company"):
		return _section(title, source, status="缺少公司，无法安全匹配培训课程")
	_require_source("Training Result")
	_require_source("Training Event")
	result_fields = set(get_permitted_fields("Training Result", user=frappe.session.user))
	if "training_event" not in result_fields or _table_field("Training Result", "employees") is None:
		frappe.throw("无权读取培训结果子表。", frappe.PermissionError)
	event_fields = _fields("Training Event", {"event_name", "course", "start_time", "source_actual_dates", "source_course_type", "training_category", "training_mode", "trainer_name", "location"})
	child_fields = _fields("Training Result Employee", {"hours", "source_study_hours", "score", "grade", "assessment_result", "needs_retraining", "comments", "source_month", "source_row"}, parenttype="Training Result")
	columns = [("name", "培训结果编号"), ("docstatus", "单据状态（0草稿1提交）")] + [("event_" + f.fieldname, f.label) for f in event_fields] + [(f.fieldname, f.label) for f in child_fields]
	# Company is derived from the checked Employee, never a caller-supplied filter.
	events = {r["name"] for r in _list("Training Event", {"company": employee.get("company"), "docstatus": ["<", 2]}, ["name"])}
	if not events:
		return _section(title, source, columns)
	rows, denied = [], False
	for result in _list("Training Result", {"docstatus": ["<", 2], "training_event": ["in", sorted(events)]}, ["name"]):
		try:
			doc = frappe.get_doc("Training Result", result["name"])
			doc.check_permission("read")
			doc.check_permission("export")
			if doc.get("training_event") not in events:
				continue
			matching = [row for row in doc.get("employees") or [] if
						row.get("employee") == employee.name or
						(not row.get("employee") and employee.get("custom_employee_code") and
						 str(row.get("employee_code") or "").strip() == str(employee.get("custom_employee_code")).strip())]
			if not matching:
				continue
			event = frappe.get_doc("Training Event", doc.get("training_event"))
			event.check_permission("read")
			event.check_permission("export")
			for child in matching:
				rows.append({"name": doc.name, "docstatus": doc.docstatus,
							 **{"event_" + f.fieldname: event.get(f.fieldname) for f in event_fields},
							 **{f.fieldname: child.get(f.fieldname) for f in child_fields}})
		except frappe.PermissionError:
			denied = True
	return _section(title, source, columns, rows, "部分培训单据无权限，已跳过" if denied else None)


def _attachments(employee, title, material_type=None):
	from hrms.api.employee_field_template import EMPLOYEE_MATERIAL_FIELD_PREFIX
	filters = {"attached_to_doctype": "Employee", "attached_to_name": employee.name}
	if material_type:
		filters["attached_to_field"] = ["in", [material_type, EMPLOYEE_MATERIAL_FIELD_PREFIX + material_type]]
	if not frappe.has_permission("File", "read"):
		frappe.throw("无权查看材料。", frappe.PermissionError)
	names = {"file_name", "file_url", "attached_to_field", "creation", "custom_hrms_attachment_title"}
	fields = _fields("File", names)
	columns = [("name", "材料编号")] + [(f.fieldname, f.label or f.fieldname) for f in fields]
	rows = []
	for row in _list("File", filters, [key for key, _ in columns]):
		file = frappe.get_doc("File", row["name"])
		if frappe.has_permission("File", "read", doc=file):
			url = str(row.get("file_url") or "")
			if url.startswith(("/files/", "/private/files/")):
				row["file_url"] = frappe.utils.get_url(url)
			rows.append(row)
	return _section(title, "File → 当前 Employee；归档原件索引，文件链接仍受站点权限控制；不含原件正文", columns, rows)


def _apple_batches(employee, cache=None):
	key = ("apple_batches", employee.name, employee.get("company"))
	if cache is not None and key in cache:
		return cache[key]
	batch_type = "HRMS Attendance Import Batch"
	_require_source(batch_type)
	batches = {}
	for row in _list(batch_type, {"company": employee.get("company")}, ["name", "status", "attendance_month"]):
		batch = frappe.get_doc(batch_type, row["name"])
		if frappe.has_permission(batch_type, "read", doc=batch) and frappe.has_permission(batch_type, "export", doc=batch):
			batches[row["name"]] = row
	if cache is not None:
		cache[key] = batches
	return batches


def _apple_history_details(employee, cache=None):
	from hrms.access_control import require_hrms_capability
	require_hrms_capability("attendance_view")
	doctype = "HRMS Apple Tree History Summary"
	source = doctype + ".source_rows_json；沿用苹果树原始明细列，仅展开已授权且员工关联完全匹配的历史行，保留批次版本"
	if not employee.get("company"):
		return _section("苹果树历史明细", source, status="缺少公司，无法安全匹配")
	if not frappe.db.exists("DocType", doctype):
		return _section("苹果树历史明细", source, status="数据模型尚未安装")
	_require_source(doctype)
	raw_field = frappe.get_meta(doctype).get_field("source_rows_json")
	permitted = set(get_permitted_fields(doctype, user=frappe.session.user, permission_type="read"))
	if raw_field is None or raw_field.get("hidden") or "source_rows_json" not in permitted:
		frappe.throw("无权读取苹果树历史明细字段。", frappe.PermissionError)
	batches = _apple_batches(employee, cache=cache)
	columns = [("record", "来源记录"), ("batch", "导入批次"), ("batch_status", "批次状态"),
			   ("sequence", "序号"), ("created_at", "创建时间"), ("reward_date", "奖/惩日期"),
			   ("source_department", "受奖/惩人部门"), ("employee_code", "工号"), ("employee_name", "姓名"),
			   ("green_apples", "绿苹果"), ("red_apples", "红苹果"), ("reward_item", "奖/惩项目"),
			   ("note", "备注"), ("created_by_name", "创建人"), ("signature", "签名"), ("note_2", "备注2")]
	rows, skipped = [], False
	if batches:
		for ref in _list(doctype, {"employee": employee.name, "company": employee.get("company"), "import_batch": ["in", list(batches)]}, ["name"]):
			doc = frappe.get_doc(doctype, ref["name"])
			if not all(frappe.has_permission(doctype, perm, doc=doc) for perm in ("read", "export")):
				skipped = True
				continue
			# Corrupt source JSON aborts the export rather than silently losing history.
			details = json.loads(doc.get("source_rows_json") or "[]")
			if not isinstance(details, list):
				frappe.throw("苹果树历史明细格式异常，请修复来源记录后重试。")
			for detail in details:
				if not isinstance(detail, dict) or detail.get("employee") != employee.name:
					skipped = True
					continue
				rows.append({**{key: detail.get(key) for key, _ in columns},
							 "record": doc.name, "batch": doc.get("import_batch"),
							 "batch_status": batches[doc.get("import_batch")].get("status")})
	return _section("苹果树历史明细", source, columns, rows, "部分明细无权限或员工关联不匹配，已跳过" if skipped else None)


def _apple(employee, cache=None):
	"""The existing Apple detail reader uses get_all internally; never broaden its access here.

	Export permission-filtered source records with their versions instead of
	merging different versions into a newly calculated statistical result.
	"""
	from hrms.access_control import require_hrms_capability
	require_hrms_capability("attendance_view")
	company = employee.get("company")
	source = "HRMS Apple Reward Record / HRMS Apple Tree History Summary；保留全部可见批次版本，不跨版本累计；有效汇总以苹果树中心及考勤终稿为准"
	if not company:
		return _section("苹果树", source, status="缺少公司，无法安全匹配")
	batches = _apple_batches(employee, cache=cache)
	if not batches:
		return _section("苹果树", source, status="暂无当前权限可见的公司导入批次")
	columns = [("source_type", "来源模型"), ("batch_status", "批次状态"), ("batch_month", "批次月份")]
	rows, notes = [], []
	for doctype in ("HRMS Apple Reward Record", "HRMS Apple Tree History Summary"):
		def collect():
			return _records("苹果树", doctype, {"employee": employee.name, "import_batch": ["in", list(batches)]})
		section = _collect("苹果树", doctype, collect)
		notes.append(doctype + "：" + section["status"])
		if section["rows"] and "import_batch" not in {key for key, _ in section["columns"]}:
			notes.append(doctype + "：批次字段不可导出，无法核验来源，未纳入该来源")
			continue
		for key, label in section["columns"]:
			if key not in {key for key, _ in columns}:
				columns.append((key, label))
		for row in section["rows"]:
			batch = batches.get(row.get("import_batch"))
			# The parent batch field must itself be visible to establish provenance.
			if not batch:
				continue
			rows.append({**row, "source_type": doctype, "batch_status": batch.get("status"), "batch_month": batch.get("attendance_month")})
	return _section("苹果树", source + "；只纳入已关联当前 Employee 的记录，未匹配员工的工号记录需先归档核实", columns, rows, "；".join(notes))


def _attendance_final(employee):
	from hrms.api.attendance_processing_center import get_monthly_final_preview
	source = "get_monthly_final_preview(kind=signed)；仅既有有效锁定终稿，不重算/修改异常或签字规则"
	code, company = str(employee.get("custom_employee_code") or "").strip(), employee.get("company")
	if not code or not company:
		return _section("考勤月度终稿", source, status="缺少公司或工号，无法安全匹配")
	_require_source("HRMS Attendance Import Batch")
	batches = _list("HRMS Attendance Import Batch", {"company": company, "source_type": "attendance_draft"}, ["name", "attendance_month"])
	rows, columns = [], [("month", "月份"), ("version", "锁定版本"), ("note", "读取说明")]
	for month in sorted({str(b.get("attendance_month") or "") for b in batches} - {""}):
		preview = get_monthly_final_preview(company=company, attendance_month=month, kind="signed", employee_code=code)
		if not preview.get("available"):
			rows.append({"month": month, "note": preview.get("reason") or "终稿不可用"})
			continue
		for c in preview.get("columns") or []:
			if c["field"] not in {key for key, _ in columns}:
				columns.append((c["field"], c["label"]))
		# Defence in depth: even an upstream broad response cannot cross employees.
		for row in preview.get("rows") or []:
			if str(row.get("employee_code") or "").strip() == code:
				rows.append({**row, "month": month, "version": preview.get("locked_snapshot_version")})
	return _section("考勤月度终稿", source, columns, rows)


def collect_employee_history(employee):
	from hrms.access_control import require_hrms_capability
	require_hrms_capability("personnel_export")
	doc = frappe.get_doc("Employee", str(employee or "").strip())
	doc.check_permission("read")
	doc.check_permission("export")
	sections = [_basic(doc)]
	source_cache = {}
	jobs = [
		("教育背景", "Employee.education", lambda: _education(doc)),
		("内部任职履历", "Employee.internal_work_history", lambda: _child(doc, "internal_work_history", "内部任职履历")),
		("外部工作履历", "Employee.external_work_history", lambda: _child(doc, "external_work_history", "外部工作履历")),
		("教育训练", "Training Result / Training Event", lambda: _training(doc)),
		("苹果树", "苹果树原始及历史来源", lambda: _apple(doc, cache=source_cache)),
		("苹果树历史明细", "HRMS Apple Tree History Summary", lambda: _apple_history_details(doc, cache=source_cache)),
		("请假记录", "Leave Application", lambda: _records("请假记录", "Leave Application", {"employee": doc.name})),
		("请假审批证据", "HRMS Attendance Leave Evidence", lambda: _records("请假审批证据", "HRMS Attendance Leave Evidence", {"employee": doc.name})),
		("人事异动", "Employee Transfer", lambda: _records("人事异动", "Employee Transfer", {"employee": doc.name})),
		("转正晋升", "Employee Promotion", lambda: _records("转正晋升", "Employee Promotion", {"employee": doc.name})),
		("离职办理", "Employee Separation", lambda: _records("离职办理", "Employee Separation", {"employee": doc.name})),
		("考勤日记录", "Attendance（Frappe 权限读取接口）", lambda: _records("考勤日记录", "Attendance", {"employee": doc.name})),
		("导入考勤日记录", "HRMS Attendance Day Check", lambda: _records("导入考勤日记录", "HRMS Attendance Day Check", {"employee": doc.name}, source_note="按导入批次保留历史；有效结果以考勤月度终稿为准")),
		("考勤月度终稿", "get_monthly_final_preview", lambda: _attendance_final(doc)),
		("奖惩记录", "HRMS Employee Reward Punishment", lambda: _records("奖惩记录", "HRMS Employee Reward Punishment", {"employee": doc.name})),
		("奖惩提报单", "File → Employee", lambda: _attachments(doc, "奖惩提报单", "reward_punishment_report")),
		("员工谈话表", "File → Employee", lambda: _attachments(doc, "员工谈话表", "employee_talk_form")),
		("材料附件", "File → Employee", lambda: _attachments(doc, "材料附件")),
	]
	for title, source, callback in jobs:
		sections.append(_collect(title, source, callback))
	sections.extend(_support_sections(doc))
	return {"employee": doc.name, "generated_at": str(frappe.utils.now()), "sections": sections}


def _support_sections(employee):
	from hrms.api.cross_department_support import get_employee_support_counts, DOCTYPE
	source = "hrms.api.cross_department_support.get_employee_support_counts；实际已提交支援单据"
	if not frappe.db.exists("DocType", DOCTYPE):
		return [_section("支援次数", source, status="支援记录模型尚未安装；需站点迁移，不能将缺失模型当成零次")]
	def collect():
		_require_source(DOCTYPE)
		counts = get_employee_support_counts(employee.name)
		rows = [{"period": "累计", "count": counts["total_count"]}]
		rows.extend({"period": row["month"], "count": row["count"]} for row in counts["months"])
		if counts["month"] not in {row["period"] for row in rows}:
			rows.append({"period": counts["month"], "count": counts["monthly_count"]})
		return _section("支援次数", source + "；" + counts["counting_rule"], [("period", "月份/累计"), ("count", "支援次数")], rows)
	return [_collect("支援次数", source, collect)]


def _cell(value):
	from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
	if value is None:
		return ""
	if isinstance(value, (dict, list, tuple)):
		value = frappe.as_json(value, ensure_ascii=False)
	if isinstance(value, str):
		value = ILLEGAL_CHARACTERS_RE.sub("", value)
		# Preserve all input text as a literal, including formula/DDE-looking content.
		if len(value) > 32767:
			frappe.throw("履历文本超过 Excel 单元格上限，无法完整导出。")
	return value


def _report_text(text):
	"""Replace implementation names in status messages without changing source records."""
	from hrms.utils.personnel_export_layout import VALUES
	names = {**VALUES, "Training Result Employee": "参训员工结果", "Training Result": "培训结果",
		"Training Event": "培训课程", "Employee": "员工档案", "File": "归档材料"}
	for key in sorted(names, key=len, reverse=True):
		text = str(text).replace(key, names[key])
	return text


def _source_description(section):
	notes = {
		"基本信息": "员工档案；按花名册已启用的导出字段列示",
		"教育背景": "教育经历子表及员工档案中的学历、毕业院校、专业科系", "内部任职履历": "员工档案中的内部任职记录",
		"外部工作履历": "员工档案中的外部工作记录", "教育训练": "培训课程、培训结果及本人参训记录",
		"苹果树": "苹果树奖惩记录及历史汇总；保留全部可见批次，不跨版本累计；有效汇总以苹果树中心和考勤终稿为准",
		"苹果树历史明细": "苹果树历史原始明细；仅包含已授权且与本员工准确关联的历史行，保留批次版本",
		"请假记录": "员工请假申请", "请假审批证据": "请假审批凭据",
		"人事异动": "员工人事异动单", "转正晋升": "员工转正晋升单", "离职办理": "员工离职办理单",
		"考勤日记录": "员工日考勤记录", "导入考勤日记录": "导入考勤明细；按批次保留历史，有效结果以考勤月度终稿为准",
		"考勤月度终稿": "已锁定的有效考勤月度终稿；保留原有签字及异常处理结果",
		"奖惩记录": "员工奖惩记录", "支援次数": "实际已提交的支援单据；按系统支援统计口径计算",
	}
	if section["title"] in {"奖惩提报单", "员工谈话表", "材料附件"}:
		return "本人归档原件索引及链接；原件正文需经站点授权查看"
	if section["title"] == "支援次数" and "；" in section["source"]:
		return notes["支援次数"] + "；" + _report_text(section["source"].split("；", 1)[1])
	return notes.get(section["title"], section["title"])


def make_history_workbook(payload):
	from openpyxl import Workbook
	from hrms.utils.personnel_export_layout import chinese_label, display_value, style_personnel_sheet
	from hrms.utils.export_watermark import save_workbook_with_logo_watermark
	workbook = Workbook()
	overview = workbook.active
	overview.title = "履历目录"
	overview.append(["员工全履历表"])
	overview.merge_cells("A1:D1")
	overview.append(["员工档案", payload["employee"], "生成时间", str(payload["generated_at"])[:19]])
	overview.append(["导出范围", "当前任职档案的全部历史月份；各项记录仅限当前账号可读取和导出的范围。"])
	overview.merge_cells("B3:D3")
	overview.append(["查阅说明", "按目录查阅明细。归档材料提供原件链接；无记录、无权限和未安装的数据分别注明。"])
	overview.merge_cells("B4:D4")
	overview.append(["履历项目", "内容说明", "记录数", "读取情况"])
	for section in payload["sections"]:
		status = _report_text(section["status"])
		overview.append([section["title"], _source_description(section), len(section["rows"]), status])
		link = overview.cell(overview.max_row, 1)
		link.hyperlink = "#'" + section["title"].replace("'", "''") + "'!A1"
		sheet = workbook.create_sheet(section["title"])
		columns = section["columns"]
		paired = section["title"] == "基本信息" and [key for key, _ in columns] == ["label", "value"]
		count = 4 if paired else max(1, len(columns))
		sheet.append([section["title"]])
		if count > 1:
			sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=count)
		# Long provenance belongs in the directory; keep identity on every detail page.
		sheet.append(["员工档案：" + str(payload["employee"]) + "；" + status])
		if count > 1:
			sheet.merge_cells(start_row=2, start_column=1, end_row=2, end_column=count)
		sheet.append(["项目", "内容", "项目", "内容"] if paired else [chinese_label(label) for _, label in columns] or ["记录"])
		if not section["rows"]:
			sheet.append([status])
			if count > 1:
				sheet.merge_cells(start_row=4, start_column=1, end_row=4, end_column=count)
		if paired:
			for index in range(0, len(section["rows"]), 2):
				values = []
				for row in section["rows"][index:index + 2]:
					values.extend([chinese_label(row.get("label")), _cell(row.get("value"))])
				sheet.append(values)
		else:
			for row in section["rows"]:
				sheet.append([_cell(display_value(key, row.get(key))) for key, _ in columns])
				for index, (key, _) in enumerate(columns, 1):
					value = row.get(key)
					if key == "file_url" and value and str(value).startswith(frappe.utils.get_url() + "/"):
						sheet.cell(sheet.max_row, index).hyperlink = value
		style_personnel_sheet(sheet, header_row=3, title_row=1,
			widths={1: 20, 2: 38, 3: 20, 4: 38} if paired else None)
	style_personnel_sheet(overview, header_row=5, title_row=1, widths={1: 24, 2: 68, 3: 12, 4: 46})
	for sheet in workbook:
		for row in sheet:
			for cell in row:
				if isinstance(cell.value, str):
					cell.value = _cell(cell.value)
					cell.data_type = "s"
	output = BytesIO()
	save_workbook_with_logo_watermark(workbook, output, export_key="employee_report")
	return output.getvalue()


@frappe.whitelist()
def download_employee_history(employee: str):
	from frappe.desk.utils import provide_binary_file
	payload = collect_employee_history(employee)
	filename = re.sub(r'[\\/:*?"<>|\r\n]', "_", payload["employee"])[:100] + "-全履历"
	provide_binary_file(filename, "xlsx", make_history_workbook(payload))
