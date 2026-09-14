"""Read-only, administrator-facing HRMS data usage statistics."""

from __future__ import annotations

import re
from collections import OrderedDict
from datetime import date, datetime, timedelta
from itertools import islice

import frappe
from frappe import _
from frappe.utils import cint

from hrms.api.data_operations import (
	DATA_CLEANUP_MODULES,
	_employee_names,
	_filters_for_company,
	_primary_company,
	_require_system_manager,
)


DATA_STATISTICS_GROUPS = OrderedDict(
	(
		(
			"master",
			{
				"label": "基础主档",
				"description": "公司、组织、职位和员工等长期使用数据。",
				"doctypes": ("Company", "Department", "Designation", "Employment Type", "Employee"),
			},
		),
		(
			"configuration",
			{
				"label": "业务配置",
				"description": "员工字段、审批、考勤、薪资和钉钉连接配置。",
				"doctypes": (
					"HRMS Employee Field Template",
					"HRMS Form Approval Matrix",
					"HRMS Attendance Custom Rule",
					"HRMS Payroll Rule",
					"HRMS Payroll Field Mapping",
					"HRMS DingTalk Settings",
				),
			},
		),
	)
)

DATA_STATISTICS_LABELS = {
	"Company": "公司",
	"Department": "部门",
	"Designation": "职位",
	"Employment Type": "用工类型",
	"Employee": "员工花名册",
	"HRMS Employee Field Template": "员工字段模板",
	"HRMS Form Approval Matrix": "人资表单审批矩阵",
	"HRMS Attendance Custom Rule": "考勤自定义规则",
	"HRMS Payroll Rule": "薪资计算规则",
	"HRMS Payroll Field Mapping": "薪资字段映射",
	"HRMS DingTalk Settings": "钉钉连接设置",
	"HRMS Attendance Exception": "考勤异常",
	"HRMS Apple Reward Record": "苹果奖励记录",
	"HRMS Attendance Leave Evidence": "考勤请假凭证",
	"HRMS Monthly Attendance Summary": "月度考勤汇总",
	"HRMS Attendance Department Confirmation": "考勤部门确认",
	"HRMS Attendance Lock Audit": "考勤锁定审计",
	"HRMS Attendance Month Lock": "考勤月份锁定",
	"HRMS Attendance Day Check": "考勤日检查",
	"HRMS Attendance Processing Record": "考勤处理记录",
	"HRMS Attendance Import Batch": "考勤导入批次",
	"HRMS Payroll Settlement Record": "薪资结算记录",
	"HRMS Payroll Input Record": "薪资输入记录",
	"HRMS Payroll Variable Record": "薪资变动项记录",
	"HRMS Payroll Welfare Source Record": "薪资福利来源记录",
	"HRMS Employee Salary Change": "员工调薪记录",
	"HRMS Payroll Variable Import Batch": "薪资变动项导入批次",
	"HRMS Form Import Row": "表单导入明细",
	"HRMS Business Process Record": "业务流程记录",
	"HRMS Form Import Batch": "表单导入批次",
	"Employee Promotion": "员工晋升",
	"Employee Transfer": "员工调岗",
	"Employee Separation": "员工离职",
	"Job Offer": "录用通知",
	"Interview Feedback": "面试反馈",
	"Interview": "面试",
	"Job Applicant": "应聘者",
	"Job Opening": "招聘职位",
	"Job Requisition": "招聘申请",
	"Staffing Plan": "人员编制计划",
	"HRMS DingTalk Raw Record": "钉钉原始同步记录",
	"HRMS DingTalk Sync Log": "钉钉同步日志",
	"HRMS DingTalk User Map": "钉钉员工映射",
}

APPROVER_FIELDS = ("approved_by", "approver", "reviewed_by", "verified_by")
AUDIT_PAGE_LENGTH = 100
IMPORT_SESSION_GAP = timedelta(minutes=10)
IMPORT_MODIFICATION_THRESHOLD = 10


def _statistics_month_range(month=None, today=None):
	today = today or date.today()
	month_key = str(month or "").strip() or today.strftime("%Y-%m")
	if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month_key):
		raise ValueError("month must use YYYY-MM")
	year, month_number = (int(part) for part in month_key.split("-"))
	month_start = datetime(year, month_number, 1)
	month_end = datetime(year + 1, 1, 1) if month_number == 12 else datetime(year, month_number + 1, 1)
	return month_key, month_start, month_end


def _within_statistics_month(value, month_start, month_end):
	if not value:
		return False
	try:
		moment = value if isinstance(value, datetime) else datetime.fromisoformat(str(value)[:19])
	except (TypeError, ValueError):
		return False
	return month_start <= moment < month_end


def _statistics_groups():
	groups = OrderedDict((key, dict(value)) for key, value in DATA_STATISTICS_GROUPS.items())
	for key, config in DATA_CLEANUP_MODULES.items():
		if key == "employees":
			continue
		groups[key] = {
			"label": config["label"],
			"description": config["description"],
			"doctypes": config["doctypes"],
		}
	return groups


def _latest_approval(doctype, record_name, latest_record, meta):
	explicit_fields = [fieldname for fieldname in APPROVER_FIELDS if meta.has_field(fieldname)]
	for fieldname in explicit_fields:
		if latest_record.get(fieldname):
			return latest_record.get(fieldname), "approved"
	workflow_action = frappe.get_all(
		"Workflow Action",
		filters={
			"reference_doctype": doctype,
			"reference_name": record_name,
			"status": "Completed",
		},
		fields=["completed_by"],
		order_by="modified desc",
		limit_page_length=1,
	)
	if workflow_action and workflow_action[0].get("completed_by"):
		return workflow_action[0].get("completed_by"), "approved"
	return "", "pending" if explicit_fields else "not_configured"


def _apply_user_labels(tables):
	user_fields = ("created_by", "modified_by", "approved_by")
	users = {table.get(fieldname) for table in tables for fieldname in user_fields if table.get(fieldname)}
	labels = {}
	if users:
		labels = {
			row.name: row.full_name or row.name
			for row in frappe.get_all(
				"User",
				filters={"name": ["in", sorted(users)]},
				fields=["name", "full_name"],
				limit_page_length=0,
			)
		}
	for table in tables:
		for fieldname in user_fields:
			table[f"{fieldname}_label"] = labels.get(table.get(fieldname), table.get(fieldname) or "")


def _chunks(values, size=500):
	iterator = iter(values)
	while batch := list(islice(iterator, size)):
		yield batch


def _statistics_doctypes():
	seen = set()
	return [
		doctype
		for config in _statistics_groups().values()
		for doctype in config["doctypes"]
		if not (doctype in seen or seen.add(doctype))
	]


def _record_filters(doctype, company, employees):
	return {"name": company} if doctype == "Company" else dict(_filters_for_company(doctype, company, employees) or {})


def _auditable_records(doctype, company, employees, fields=None):
	if not frappe.db.exists("DocType", doctype):
		return []
	meta = frappe.get_meta(doctype)
	if meta.issingle:
		return []
	return frappe.get_all(
		doctype,
		filters=_record_filters(doctype, company, employees),
		fields=fields or ["name", "owner", "creation"],
		limit_page_length=0,
	)


def _user_labels(users):
	users = sorted({user for user in users if user})
	if not users:
		return {}
	return {
		row.name: row.full_name or row.name
		for row in frappe.get_all(
			"User",
			filters={"name": ["in", users]},
			fields=["name", "full_name"],
			limit_page_length=0,
		)
	}


def _import_batch_field(meta):
	for fieldname in ("import_batch", "source_import_batch"):
		field = meta.get_field(fieldname)
		if field:
			return fieldname, field.options or ""
	return "", ""


def _creation_events(records, batch_field="", batch_doctype=""):
	"""Collapse imported rows into batch actions instead of counting every row as one operator action."""
	groups = []
	batch_groups = OrderedDict()
	unbatched_by_user = {}
	for record in records:
		batch_name = record.get(batch_field) if batch_field else ""
		if batch_name:
			batch_groups.setdefault((record.owner, batch_name), []).append(record)
		else:
			unbatched_by_user.setdefault(record.owner, []).append(record)

	groups.extend((user, batch_name, rows) for (user, batch_name), rows in batch_groups.items())
	for user, user_records in unbatched_by_user.items():
		current = []
		previous = None
		for record in sorted(user_records, key=lambda row: str(row.creation or "")):
			moment = record.creation if isinstance(record.creation, datetime) else datetime.fromisoformat(str(record.creation)[:19])
			if current and previous is not None and moment - previous > IMPORT_SESSION_GAP:
				groups.append((user, "", current))
				current = []
			current.append(record)
			previous = moment
		if current:
			groups.append((user, "", current))

	events = []
	for user, batch_name, rows in groups:
		rows = sorted(rows, key=lambda row: str(row.creation or ""))
		events.append(
			{
				"operator": user,
				"operated_at": str(rows[-1].creation or "")[:19],
				"operation_type": "imported",
				"operation": "导入记录",
				"record_count": len(rows),
				"record_names": [row.name for row in rows[:20]],
				"_record_names_all": [row.name for row in rows],
				"batch_name": batch_name,
				"batch_doctype": batch_doctype if batch_name else "",
			}
		)
	return events


def _collapse_import_sessions(events):
	"""Merge row creations and bulk update Versions produced by one import into one operator action."""
	result = [event for event in events if event.get("operation_type") not in {"imported", "modified"}]
	by_user = {}
	for event in events:
		if event.get("operation_type") in {"imported", "modified"}:
			by_user.setdefault(event.get("operator"), []).append(event)
	for user, user_events in by_user.items():
		sessions = []
		current = []
		previous = None
		for event in sorted(user_events, key=lambda row: row.get("operated_at") or ""):
			moment = datetime.fromisoformat(str(event.get("operated_at") or "")[:19])
			if current and previous is not None and moment - previous > IMPORT_SESSION_GAP:
				sessions.append(current)
				current = []
			current.append(event)
			previous = moment
		if current:
			sessions.append(current)

		for session in sessions:
			is_import = any(event.get("operation_type") == "imported" for event in session) or len(session) >= IMPORT_MODIFICATION_THRESHOLD
			if not is_import:
				result.extend(session)
				continue
			import_events = [event for event in session if event.get("operation_type") == "imported"]
			batch_event = next((event for event in import_events if event.get("batch_name")), import_events[0] if import_events else {})
			record_names = []
			for event in session:
				if event.get("operation_type") == "imported":
					record_names.extend(event.get("_record_names_all") or event.get("record_names") or [])
				elif event.get("record_name"):
					record_names.append(event["record_name"])
			unique_record_names = list(dict.fromkeys(record_names))
			result.append(
				{
					"operator": user,
					"operated_at": max(str(event.get("operated_at") or "")[:19] for event in session),
					"operation_type": "imported",
					"operation": "导入记录",
					"record_count": len(unique_record_names),
					"record_names": unique_record_names[:20],
					"_record_names_all": unique_record_names,
					"batch_name": batch_event.get("batch_name") or "",
					"batch_doctype": batch_event.get("batch_doctype") or "",
					"record_exists": batch_event.get("record_exists", 0),
					"open_doctype": batch_event.get("open_doctype") or "",
					"open_name": batch_event.get("open_name") or "",
					"changes": [],
				}
			)
	return sorted(result, key=lambda row: row.get("operated_at") or "", reverse=True)


def _version_rows(doctype, record_names, fields, user=""):
	rows = []
	for names in _chunks(record_names):
		filters = {"ref_doctype": doctype, "docname": ["in", names]}
		if user:
			filters["owner"] = user
		rows.extend(
			frappe.get_all(
				"Version",
				filters=filters,
				fields=fields,
				order_by="creation desc",
				limit_page_length=0,
			)
		)
	return rows


def _workflow_rows(doctype, record_names, user=""):
	rows = []
	for names in _chunks(record_names):
		filters = {
			"reference_doctype": doctype,
			"reference_name": ["in", names],
			"status": "Completed",
		}
		if user:
			filters["completed_by"] = user
		rows.extend(
			frappe.get_all(
				"Workflow Action",
				filters=filters,
				fields=["name", "reference_name", "completed_by", "modified"],
				order_by="modified desc",
				limit_page_length=0,
			)
		)
	return rows


def _version_changes(doctype, version_data):
	try:
		data = frappe.parse_json(version_data or "{}") or {}
	except Exception:
		data = {}
	meta = frappe.get_meta(doctype)
	changes = []
	for change in data.get("changed") or []:
		if not isinstance(change, (list, tuple)) or len(change) < 3:
			continue
		fieldname, old_value, new_value = change[:3]
		field = meta.get_field(fieldname)
		changes.append(
			{
				"fieldname": fieldname,
				"label": field.label if field else fieldname,
				"old_value": old_value,
				"new_value": new_value,
			}
		)
	for key, label in (("added", "新增子表行"), ("removed", "删除子表行"), ("row_changed", "修改子表行")):
		for row in data.get(key) or []:
			changes.append({"fieldname": key, "label": label, "old_value": "", "new_value": row})
	return changes


def _version_operation(changes):
	for change in changes:
		if change["fieldname"] != "docstatus":
			continue
		if str(change["new_value"]) == "1":
			return "submitted", "提交记录"
		if str(change["new_value"]) == "2":
			return "cancelled", "取消提交"
	return "modified", "修改记录"


def _table_activity(doctype, company, employees, month_start, month_end):
	if not frappe.db.exists("DocType", doctype):
		return {
			"doctype": doctype,
			"label": DATA_STATISTICS_LABELS.get(doctype, _(doctype)),
			"record_count": 0,
			"last_updated_on": "",
			"monthly_update_count": 0,
			"activity_available": 0,
			"missing": 1,
			"created_by": "",
			"modified_by": "",
			"approved_by": "",
			"approval_status": "not_configured",
			"last_modified_at": "",
			"latest_record_name": "",
			"is_single": 0,
		}

	meta = frappe.get_meta(doctype)
	row = {
		"doctype": doctype,
		"label": DATA_STATISTICS_LABELS.get(doctype, _(doctype)),
		"record_count": 1 if meta.issingle else 0,
		"last_updated_on": "",
		"monthly_update_count": 0,
		"activity_available": 0 if meta.issingle else 1,
		"missing": 0,
		"created_by": "",
		"modified_by": "",
		"approved_by": "",
		"approval_status": "not_configured",
		"last_modified_at": "",
		"latest_record_name": "",
		"is_single": cint(meta.issingle),
	}
	if meta.issingle:
		return row

	filters = {"name": company} if doctype == "Company" else _filters_for_company(doctype, company, employees)
	filters = dict(filters or {})
	row["record_count"] = frappe.db.count(doctype, filters)
	approval_fields = [fieldname for fieldname in APPROVER_FIELDS if meta.has_field(fieldname)]
	latest = frappe.get_all(
		doctype,
		filters=filters,
		fields=["name", "owner", "modified_by", "modified", *approval_fields],
		order_by="modified desc",
		limit_page_length=1,
	)
	if latest and latest[0].get("modified"):
		latest_record = latest[0]
		row["latest_record_name"] = latest_record.get("name") or ""
		row["last_updated_on"] = str(latest_record.get("modified"))[:10]
		row["last_modified_at"] = str(latest_record.get("modified"))[:19]
		row["created_by"] = latest_record.get("owner") or ""
		row["modified_by"] = latest_record.get("modified_by") or ""
		row["approved_by"], row["approval_status"] = _latest_approval(
			doctype,
			latest_record.get("name"),
			latest_record,
			meta,
		)
	month_filters = dict(filters)
	month_filters["modified"] = ["between", [month_start, month_end - timedelta(microseconds=1)]]
	row["monthly_update_count"] = cint(frappe.db.count(doctype, month_filters))
	return row


@frappe.whitelist()
def get_hrms_data_statistics(month: str | None = None, company: str = ""):
	"""Return a simple, read-only usage report for project-relevant HRMS tables."""
	_require_system_manager()
	try:
		month_key, month_start, month_end = _statistics_month_range(month)
	except ValueError:
		frappe.throw(_("月份格式无效，请使用 YYYY-MM。"))

	company = str(company or "").strip() or _primary_company()
	if not company or not frappe.db.exists("Company", company):
		frappe.throw(_("未找到可统计的公司。"))
	employees = _employee_names(company)
	seen = set()
	groups = []
	for key, config in _statistics_groups().items():
		tables = []
		for doctype in config["doctypes"]:
			if doctype in seen:
				continue
			seen.add(doctype)
			tables.append(_table_activity(doctype, company, employees, month_start, month_end))
		groups.append(
			{
				"key": key,
				"label": config["label"],
				"description": config["description"],
				"tables": tables,
			}
		)

	all_tables = [table for group in groups for table in group["tables"]]
	_apply_user_labels(all_tables)
	return {
		"title": "人资系统使用情况分析报告",
		"company": company,
		"activity_month": month_key,
		"activity_month_label": f"{month_key[:4]}年{month_key[5:]}月",
		"groups": groups,
		"summary": {
			"table_count": len(all_tables),
			"record_count": sum(table["record_count"] for table in all_tables),
			"active_table_count": sum(1 for table in all_tables if table["monthly_update_count"]),
			"monthly_update_count": sum(table["monthly_update_count"] for table in all_tables),
		},
		"statistics_basis": "每月更新数按记录的最后修改时间统计；同一记录在所选月份内多次保存只计 1 条。",
		"traceability_basis": "录入人、审批人、修改人和修改时间取该表最后修改的一条记录；审批人仅来自明确的审批字段或已完成工作流记录。",
		"singleton_note": "单例配置表不保存记录修改时间，其日期和月度更新数显示为“未记录”。",
	}


@frappe.whitelist()
def get_hrms_operator_statistics(company: str = "", month: str | None = None):
	"""Group one month's traceable operator events by operator and form."""
	_require_system_manager()
	try:
		month_key, month_start, month_end = _statistics_month_range(month)
	except ValueError:
		frappe.throw(_("月份格式无效，请使用 YYYY-MM。"))
	company = str(company or "").strip() or _primary_company()
	if not company or not frappe.db.exists("Company", company):
		frappe.throw(_("未找到可统计的公司。"))
	employees = _employee_names(company)
	people = {}
	forms = {}
	all_active_dates = set()

	def add_event(user, doctype, operated_at, operation_type, affected_record_count=1):
		if not user or not _within_statistics_month(operated_at, month_start, month_end):
			return
		operated_at = str(operated_at or "")[:19]
		active_date = operated_at[:10]
		all_active_dates.add(active_date)
		person = people.setdefault(user, {"user": user, "operation_count": 0, "last_operated_at": "", "forms": {}, "_active_dates": set(), "operation_types": {}, "imported_record_count": 0})
		person["operation_count"] += 1
		if operation_type == "imported":
			person["imported_record_count"] += affected_record_count
		person["last_operated_at"] = max(person["last_operated_at"], operated_at)
		person["_active_dates"].add(active_date)
		person["operation_types"][operation_type] = person["operation_types"].get(operation_type, 0) + 1
		form = person["forms"].setdefault(
			doctype,
			{
				"doctype": doctype,
				"label": DATA_STATISTICS_LABELS.get(doctype, _(doctype)),
				"operation_count": 0,
				"last_operated_at": "",
				"operation_types": {},
				"imported_record_count": 0,
				"_active_dates": set(),
			},
		)
		form["operation_count"] += 1
		if operation_type == "imported":
			form["imported_record_count"] += affected_record_count
		form["last_operated_at"] = max(form["last_operated_at"], operated_at)
		form["operation_types"][operation_type] = form["operation_types"].get(operation_type, 0) + 1
		form["_active_dates"].add(active_date)
		aggregate = forms.setdefault(
			doctype,
			{
				"doctype": doctype,
				"label": DATA_STATISTICS_LABELS.get(doctype, _(doctype)),
				"operation_count": 0,
				"last_operated_at": "",
				"operation_types": {},
				"imported_record_count": 0,
				"_active_dates": set(),
				"_operators": {},
			},
		)
		aggregate["operation_count"] += 1
		if operation_type == "imported":
			aggregate["imported_record_count"] += affected_record_count
		aggregate["last_operated_at"] = max(aggregate["last_operated_at"], operated_at)
		aggregate["operation_types"][operation_type] = aggregate["operation_types"].get(operation_type, 0) + 1
		aggregate["_active_dates"].add(active_date)
		operator = aggregate["_operators"].setdefault(user, {"user": user, "operation_count": 0, "last_operated_at": ""})
		operator["operation_count"] += 1
		operator["last_operated_at"] = max(operator["last_operated_at"], operated_at)

	for doctype in _statistics_doctypes():
		meta = frappe.get_meta(doctype)
		batch_field, batch_doctype = _import_batch_field(meta)
		record_fields = ["name", "owner", "creation", *([batch_field] if batch_field else [])]
		records = _auditable_records(doctype, company, employees, fields=record_fields)
		record_names = [row.name for row in records]
		raw_events = _creation_events(records, batch_field, batch_doctype)
		for version in _version_rows(doctype, record_names, ["docname", "owner", "creation", "data"]):
			operation_type, _operation_label = _version_operation(_version_changes(doctype, version.data))
			raw_events.append({"operator": version.owner, "operated_at": str(version.creation or "")[:19], "operation_type": operation_type, "record_name": getattr(version, "docname", "")})
		for workflow in _workflow_rows(doctype, record_names):
			raw_events.append({"operator": workflow.completed_by, "operated_at": str(workflow.modified or "")[:19], "operation_type": "approved", "record_name": workflow.reference_name})
		for event in _collapse_import_sessions(raw_events):
			add_event(event["operator"], doctype, event["operated_at"], event["operation_type"], event.get("record_count", 1))

	labels = _user_labels(people)
	result = []
	for user, person in people.items():
		person_forms = person.pop("forms").values()
		for form in person_forms:
			form["active_day_count"] = len(form.pop("_active_dates"))
			form["daily_average"] = round(form["operation_count"] / max(form["active_day_count"], 1), 1)
		person_forms = sorted(person_forms, key=lambda row: (-row["operation_count"], row["label"]))
		person["user_label"] = labels.get(user, user)
		person["active_day_count"] = len(person.pop("_active_dates"))
		person["daily_average"] = round(person["operation_count"] / max(person["active_day_count"], 1), 1)
		person["form_count"] = len(person_forms)
		person["forms"] = person_forms
		result.append(person)
	result.sort(key=lambda row: (-row["operation_count"], row["user_label"]))
	form_result = []
	for form in forms.values():
		form["active_day_count"] = len(form.pop("_active_dates"))
		form["daily_average"] = round(form["operation_count"] / max(form["active_day_count"], 1), 1)
		form["operators"] = sorted(
			[
				{**operator, "user_label": labels.get(operator["user"], operator["user"])}
				for operator in form.pop("_operators").values()
			],
			key=lambda row: (-row["operation_count"], row["user_label"]),
		)
		form["operator_count"] = len(form["operators"])
		form_result.append(form)
	form_result.sort(key=lambda row: (-row["operation_count"], row["label"]))
	return {
		"company": company,
		"activity_month": month_key,
		"people": result,
		"forms": form_result,
		"summary": {
			"operator_count": len(result),
			"operation_count": sum(row["operation_count"] for row in result),
			"active_day_count": len(all_active_dates),
			"daily_average": round(sum(row["operation_count"] for row in result) / max(len(all_active_dates), 1), 1),
		},
		"audit_basis": "按所选月份汇总导入批次、Version 修改日志和已完成审批；一次文件导入无论新增或更新多少行都只计 1 次操作，并单独显示影响的数据条数。没有批次号的旧记录根据同一操作员的连续批量写入合并为一次历史导入。复核提示是客观风险信号，不直接判定操作错误。",
	}


@frappe.whitelist()
def get_hrms_operator_activity(
	doctype: str = "",
	user: str = "",
	company: str = "",
	month: str | None = None,
	operation_type: str = "all",
	start: int = 0,
	page_length: int = AUDIT_PAGE_LENGTH,
):
	"""Return paged, field-level history for one HRMS form, optionally scoped to one operator."""
	_require_system_manager()
	try:
		month_key, month_start, month_end = _statistics_month_range(month)
	except ValueError:
		frappe.throw(_("月份格式无效，请使用 YYYY-MM。"))
	user = str(user or "").strip()
	doctype = str(doctype or "").strip()
	if doctype not in _statistics_doctypes():
		frappe.throw(_("操作人员或数据表无效。"))
	company = str(company or "").strip() or _primary_company()
	if not company or not frappe.db.exists("Company", company):
		frappe.throw(_("未找到可统计的公司。"))
	employees = _employee_names(company)
	meta = frappe.get_meta(doctype)
	title_field = meta.title_field if meta.title_field and meta.has_field(meta.title_field) else ""
	batch_field, batch_doctype = _import_batch_field(meta)
	record_fields = ["name", "owner", "creation", *([title_field] if title_field else []), *([batch_field] if batch_field else [])]
	records = _auditable_records(doctype, company, employees, fields=record_fields)
	record_by_name = {row.name: row for row in records}
	events = _creation_events([record for record in records if not user or record.owner == user], batch_field, batch_doctype)
	for event in events:
		event["record_name"] = event["batch_name"] or _("{0} 条数据").format(event["record_count"])
		event["record_title"] = _("导入批次") if event["batch_name"] else _("历史导入")
		event["changes"] = []
		event["record_exists"] = cint(bool(event["batch_name"] and event["batch_doctype"] and frappe.db.exists(event["batch_doctype"], event["batch_name"])))
		event["open_doctype"] = event["batch_doctype"] if event["record_exists"] else ""
		event["open_name"] = event["batch_name"] if event["record_exists"] else ""
	versions = _version_rows(
		doctype,
		record_by_name,
		["name", "docname", "owner", "creation", "data"],
		user=user,
	)
	for version in versions:
		changes = _version_changes(doctype, version.data)
		version_operation_type, operation = _version_operation(changes)
		events.append(
			{
				"version_name": version.name,
				"record_name": version.docname,
				"record_title": record_by_name[version.docname].get(title_field) if title_field else "",
				"operation_type": version_operation_type,
				"operation": operation,
				"operated_at": str(version.creation or "")[:19],
				"operator": version.owner,
				"changes": changes,
				"record_exists": cint(version.docname in record_by_name),
			}
		)
	for workflow in _workflow_rows(doctype, record_by_name, user=user):
		events.append(
			{
				"workflow_action_name": workflow.name,
				"record_name": workflow.reference_name,
				"record_title": record_by_name[workflow.reference_name].get(title_field) if title_field else "",
				"operation_type": "approved",
				"operation": "审批记录",
				"operated_at": str(workflow.modified or "")[:19],
				"operator": workflow.completed_by,
				"changes": [],
				"record_exists": cint(workflow.reference_name in record_by_name),
			}
		)
	events = _collapse_import_sessions(events)
	for event in events:
		if event["operation_type"] != "imported":
			continue
		event["record_name"] = event.get("batch_name") or _("{0} 条数据").format(event.get("record_count") or 0)
		event["record_title"] = _("导入批次") if event.get("batch_name") else _("历史导入")
	events = [event for event in events if _within_statistics_month(event["operated_at"], month_start, month_end)]
	events.sort(key=lambda row: row["operated_at"], reverse=True)
	operation_labels = OrderedDict(
		(("all", "全部操作"), ("imported", "导入记录"), ("modified", "修改记录"), ("submitted", "提交记录"), ("approved", "审批记录"), ("cancelled", "取消提交"))
	)
	type_counts = {key: 0 for key in operation_labels}
	type_counts["all"] = len(events)
	for event in events:
		type_counts[event["operation_type"]] += 1
	operation_type = str(operation_type or "all").strip()
	if operation_type not in operation_labels:
		operation_type = "all"
	filtered_events = events if operation_type == "all" else [event for event in events if event["operation_type"] == operation_type]
	start = max(cint(start), 0)
	page_length = min(max(cint(page_length), 1), AUDIT_PAGE_LENGTH)
	page = filtered_events[start : start + page_length]
	for event in page:
		event.pop("_record_names_all", None)
	operator_labels = _user_labels(event.get("operator") for event in events)
	for event in page:
		event["operator_label"] = operator_labels.get(event.get("operator"), event.get("operator") or _("未记录"))
	label = _user_labels([user]).get(user, user) if user else _("全部操作人员")
	return {
		"company": company,
		"activity_month": month_key,
		"user": user,
		"user_label": label,
		"scope": "operator" if user else "form",
		"doctype": doctype,
		"doctype_label": DATA_STATISTICS_LABELS.get(doctype, _(doctype)),
		"operation_type": operation_type,
		"operation_groups": [
			{"key": key, "label": label, "count": type_counts[key]} for key, label in operation_labels.items()
		],
		"events": page,
		"total": len(filtered_events),
		"all_total": len(events),
		"start": start,
		"page_length": page_length,
		"has_more": start + len(page) < len(filtered_events),
	}
