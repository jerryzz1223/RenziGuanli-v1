"""Roster pull progress, field review and explicitly confirmed employee creation."""

import hashlib
import json
import time

import frappe
from frappe import _

from hrms.api import dingtalk_integration as integration


FULL_ROSTER_TASK_MARKER = "正在拉取企业通讯录与智能人事全员名单"


def _progress_key(sync_log):
	return "hrms:roster-progress:" + sync_log


def _progress_reporter(sync_log):
	last = [None, 0]

	def report(stage, completed=0, total=None, failed=0):
		now = time.time()
		if stage == last[0] and now - last[1] < 1 and completed != total:
			return
		frappe.cache().set_value(_progress_key(sync_log), {
			"stage": stage, "completed": completed, "total": total,
			"failed": failed, "updated_at": now,
		}, expires_in_sec=7200)
		last[:] = [stage, now]

	return report


def _read_progress(log):
	if log.status not in ("已排队", "运行中"):
		return None
	progress = frappe.cache().get_value(_progress_key(log.name))
	if progress:
		progress = dict(progress)
		progress["stale_seconds"] = max(0, int(time.time() - progress["updated_at"]))
	return progress


@frappe.whitelist(methods=["POST"])
def queue_roster_comparison(company: str = ""):
	integration._require_dingtalk_employee_import_approver()
	company = integration._require_api_sync_enabled(company)
	# Serialize submissions for this company, including separate browser sessions.
	frappe.db.sql("SELECT name FROM `tabCompany` WHERE name=%s FOR UPDATE", (company,))
	active = frappe.db.sql(
		"""SELECT name, status FROM `tabHRMS DingTalk Sync Log`
		WHERE company=%s AND sync_type=%s AND status IN ('已排队', '运行中')
		AND error_message=%s
		ORDER BY creation DESC LIMIT 1 FOR UPDATE""",
		(company, "员工档案同步", FULL_ROSTER_TASK_MARKER), as_dict=True,
	)
	if active:
		return {"sync_log": active[0].name, "status": active[0].status, "duplicate": True}
	log = integration._new_sync_log("员工档案同步", company=company)
	log.status = "已排队"
	log.error_message = FULL_ROSTER_TASK_MARKER
	log.save(ignore_permissions=False)
	_progress_reporter(log.name)("等待后台任务启动")
	frappe.enqueue(
		"hrms.api.dingtalk_roster_tasks.run_roster_comparison",
		queue="long", timeout=3600, enqueue_after_commit=True,
		company=company, sync_log=log.name,
	)
	return {"sync_log": log.name, "status": log.status, "duplicate": False}


def _task(company, sync_log):
	log = frappe.get_doc(integration.DINGTALK_SYNC_LOG_DOCTYPE, sync_log)
	if log.company != company or log.sync_type != "员工档案同步":
		frappe.throw(_("花名册比对任务与当前公司不匹配。"))
	return log


def run_roster_comparison(company: str, sync_log: str):
	log = _task(company, sync_log)
	if log.status != "已排队":
		return
	try:
		_progress_reporter(sync_log)("正在连接钉钉并校验配置")
		integration._require_dingtalk_employee_import_approver()
		integration._require_api_sync_enabled(company)
		log.status = "运行中"
		log.save(ignore_permissions=False)
		frappe.db.commit()
		result = integration._sync_all_employee_rosters(company, sync_log=log, include_directory=True, progress=_progress_reporter(sync_log))
		frappe.db.commit()
		return result
	except Exception as exc:
		# Discard uncommitted snapshots on a fatal error, then persist a terminal
		# state even when initial authentication or roster-list fetching failed.
		frappe.db.rollback()
		integration._finish_sync_log(log, "失败", failed=1, error_message=str(exc))
		frappe.db.commit()
		return {"sync_log": log.name, "status": "失败"}


@frappe.whitelist()
def get_roster_comparison_status(sync_log: str, company: str = ""):
	integration._require_dingtalk_employee_import_approver()
	company = integration._require_sync_company(company)
	log = _task(company, sync_log)
	return {
		"sync_log": log.name, "company": company, "status": log.status,
		"received": log.records_received or 0,
		"failed": log.records_failed or 0,
		"error_message": "" if log.error_message == FULL_ROSTER_TASK_MARKER else log.error_message or "",
		"finished_at": log.finished_at, "progress": _read_progress(log),
	}


def fetch_full_roster_users(progress=None):
	"""Union the live internal directory and HRM roster, independent of pre-entry."""
	from collections import deque

	departments = deque(["1"])
	seen_departments = set()
	directory = {}
	if progress:
		progress("正在读取企业通讯录")
	while departments:
		dept_id = departments.popleft()
		if dept_id in seen_departments or dept_id == "-7":
			continue
		seen_departments.add(dept_id)
		payload = integration._dingtalk_api_request(
			"POST", integration.DINGTALK_DEPARTMENT_LIST_PATH, use_oapi=True,
			json_body={"dept_id": int(dept_id), "language": "zh_CN"},
		)
		for item in integration._extract_result_list(payload, "departments", "dept_infos", "deptInfos", "result"):
			child = integration._first(item, "dept_id", "deptId", "id")
			if child is not None:
				departments.append(str(child))
		cursor = 0
		seen_cursors = set()
		while True:
			if str(cursor) in seen_cursors:
				frappe.throw(_("钉钉通讯录分页游标重复，未将不完整名单标为完成。"))
			seen_cursors.add(str(cursor))
			payload = integration._dingtalk_api_request(
				"POST", integration.DINGTALK_DEPARTMENT_USERS_PATH, use_oapi=True,
				json_body={"dept_id": int(dept_id), "cursor": cursor, "size": 100,
					"order_field": "modify_desc", "contain_access_limit": True},
			)
			for item in integration._extract_result_list(payload, "users", "user_list", "userList", "result"):
				userid = str(integration._first(item, "userid", "userId", "user_id") or "").strip()
				if not userid:
					frappe.throw(_("钉钉通讯录返回缺少 UserId 的员工，无法确认名单完整性。"))
				directory.setdefault(userid, item)
			if progress:
				progress("正在读取企业通讯录", len(directory))
			next_cursor = integration._next_cursor(payload)
			if next_cursor is None:
				break
			cursor = next_cursor
	if progress:
		progress("正在读取智能人事名单")
	onjob = integration._fetch_dingtalk_onjob_userids(**({"progress": progress} if progress else {}))
	details = integration._fetch_dingtalk_preentry_details(onjob, **({"progress": progress} if progress else {})) if onjob else {}
	userids = list(dict.fromkeys([*onjob, *directory]))
	for userid in userids:
		if userid in details or userid not in directory:
			continue
		item = directory[userid]
		# Preserve only published directory facts. Do not invent an entry date,
		# status transition, or a primary department for multiple memberships.
		fields = [
			("sys00-name", integration._first(item, "name", "userName")),
			("sys00-jobNumber", integration._first(item, "job_number", "jobNumber")),
			("sys00-mobile", integration._first(item, "mobile")),
			("sys00-position", integration._first(item, "title", "position")),
		]
		field_data = [{"field_code": key, "field_value_list": [{"value": value}]} for key, value in fields if value]
		user = integration._normalize_dingtalk_roster_user(
			{"userid": userid, "field_data_list": field_data, "hrms_directory_only": True}, userid,
		)
		details[userid] = user
	return userids, details


@frappe.whitelist()
def list_roster_employees(company: str = "", sync_log: str = "", start: int = 0, page_length: int = 100, query: str = "", review_filter: str = "all", sort_by: str = "employee_code", sort_order: str = "asc"):
	"""Page through every review status in one full pull; expose no raw payload."""
	integration._require_dingtalk_employee_import_approver()
	company = integration._require_sync_company(company)
	if not sync_log:
		latest = frappe.get_all(
			integration.DINGTALK_SYNC_LOG_DOCTYPE,
			filters={"company": company, "sync_type": "员工档案同步"},
			fields=["name"], order_by="creation desc", limit_page_length=1,
		)
		if not latest:
			return {"rows": [], "total": 0, "sync_log": "", "has_more": False}
		sync_log = latest[0].name
	log = _task(company, sync_log)
	start = max(int(start or 0), 0)
	page_length = min(max(int(page_length or 100), 1), 500)
	sources = frappe.get_all(
		integration.DINGTALK_RAW_RECORD_DOCTYPE,
		filters={"company": company, "source_type": integration.DINGTALK_EMPLOYEE_ROSTER_SOURCE_TYPE},
		pluck="name", limit_page_length=0,
	)
	filters = {"company": company, "sync_log": sync_log,
		"source_record": ["in", sources or ["__no_full_roster_source__"]]}
	# Values are bound parameters; only fixed column names/directions enter SQL.
	columns = {"employee_code", "employee_name", "department", "designation", "date_of_joining", "matched_employee", "import_status"}
	if sort_by not in columns or sort_order not in {"asc", "desc"} or review_filter not in {"all", "conflict", "same"}:
		frappe.throw(_("查询或排序条件无效，请重新选择。"))
	where = "company=%(company)s AND sync_log=%(sync_log)s AND source_record IN %(sources)s"
	params = {"company": company, "sync_log": sync_log, "sources": tuple(sources or ["__no_full_roster_source__"])}
	query = str(query or "").strip()[:200]
	if query:
		# Search literal text, including percent/underscore, across the full batch.
		params["query"] = "%" + query.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"
		where += " AND (" + " OR ".join(f"`{name}` LIKE %(query)s ESCAPE '!'" for name in (*sorted(columns), "error_message")) + ")"
	if review_filter == "same":
		where += " AND import_status='无变更'"
	elif review_filter == "conflict":
		where += " AND (import_status IS NULL OR import_status!='无变更')"
	filtered_total = frappe.db.sql("SELECT COUNT(*) FROM `tabHRMS DingTalk Employee Import` WHERE " + where, params)[0][0]
	order = f"`{sort_by}` {sort_order}, name asc"
	if sort_by == "employee_code":
		# Numeric work numbers sort as 1, 2, 10; text codes retain lexical ordering.
		order = f"CASE WHEN COALESCE(employee_code, '')='' THEN 1 ELSE 0 END asc, CASE WHEN employee_code REGEXP '^[0-9]+$' THEN 0 ELSE 1 END asc, CASE WHEN employee_code REGEXP '^[0-9]+$' THEN CAST(employee_code AS DECIMAL(65,0)) END {sort_order}, employee_code {sort_order}, name asc"
	params.update({"start": start, "limit": page_length + 1})
	rows = frappe.db.sql(
		"SELECT name, employee_code, employee_name, department, designation, date_of_joining, matched_employee, import_status, error_message "
		"FROM `tabHRMS DingTalk Employee Import` WHERE " + where + " ORDER BY " + order + " LIMIT %(limit)s OFFSET %(start)s",
		params, as_dict=True,
	)
	return {"rows": rows[:page_length], "sync_log": sync_log, "status": log.status,
		"total": frappe.db.count(integration.DINGTALK_EMPLOYEE_IMPORT_DOCTYPE, filters),
		"filtered_total": filtered_total,
		"has_more": len(rows) > page_length, "next_start": start + page_length,
		"received": log.records_received or 0, "failed": log.records_failed or 0,
		"progress": _read_progress(log),
		"error_message": "" if log.error_message == FULL_ROSTER_TASK_MARKER else log.error_message or ""}


def _review_record(import_name, company):
	integration._require_dingtalk_employee_import_approver()
	company = integration._require_sync_company(company)
	doc = frappe.get_doc(integration.DINGTALK_EMPLOYEE_IMPORT_DOCTYPE, import_name)
	if doc.company != company:
		frappe.throw(_("钉钉资料与当前公司不匹配。"))
	source = frappe.db.get_value(integration.DINGTALK_RAW_RECORD_DOCTYPE, doc.source_record, "source_type")
	if source != integration.DINGTALK_EMPLOYEE_ROSTER_SOURCE_TYPE:
		frappe.throw(_("只能查看全量员工档案来源的记录。"))
	return doc


def _direct_update_preview(company, sync_log, import_names_json):
	integration._require_dingtalk_employee_import_approver()
	company = integration._require_sync_company(company)
	log = _task(company, sync_log)
	if log.status != "已完成" or integration._latest_dingtalk_employee_roster_sync_log(company) != sync_log:
		frappe.throw(_("请使用最新且完整的全员拉取批次更新员工。"))
	names = integration._dingtalk_roster_selected_names(import_names_json)
	if not names:
		frappe.throw(_("请至少选择一名员工。"))
	meta = {field.fieldname: field for field in frappe.get_meta("Employee").fields if field.fieldname}
	rows, issues = [], []
	for name in names:
		doc = _review_record(name, company)
		if doc.sync_log != sync_log or doc.import_status == "已驳回":
			issues.append("记录 {0} 不属于当前可更新批次".format(name))
			continue
		if not doc.matched_employee:
			issues.append("{0} 尚未建档，请进入核对页先确认建档资料".format(doc.employee_name or name))
			continue
		employee = frappe.get_doc("Employee", doc.matched_employee)
		values, labels = integration._recompute_dingtalk_employee_import(doc)
		if employee.company != company or str(values.get("custom_employee_code") or "").strip() != str(employee.get("custom_employee_code") or "").strip():
			issues.append("记录 {0} 的公司或公司工号不匹配，请重新核对".format(name))
			continue
		if employee.get("status") == "Left":
			issues.append("记录 {0} 的员工已离职，请先核对状态".format(name))
			continue
		differences = integration._dingtalk_employee_field_differences(values, employee, labels, meta)
		fields = []
		for difference in differences:
			field = meta.get(difference["fieldname"])
			if not field or field.read_only or field.fieldtype not in REVIEW_FIELD_TYPES:
				continue
			integration._set_dingtalk_difference_applyability(difference, field)
			fields.append(difference)
		rows.append({"name": name, "employee_name": doc.employee_name, "employee": employee.name, "employee_modified": str(employee.modified),
			"import_modified": str(doc.modified), "fields": fields})
	fingerprint = [company, sync_log, names, rows]
	token = hashlib.sha256(json.dumps(fingerprint, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()
	return {"rows": rows, "issues": issues, "can_update": not issues, "preview_token": token}


@frappe.whitelist(methods=["POST"])
def preview_direct_roster_update(company: str, sync_log: str, import_names_json: str):
	return _direct_update_preview(company, sync_log, import_names_json)


@frappe.whitelist(methods=["POST"])
def apply_direct_roster_update(company: str, sync_log: str, import_names_json: str, preview_token: str, decisions_json: str):
	integration._require_dingtalk_employee_import_approver()
	company = integration._require_sync_company(company)
	frappe.db.sql("SELECT name FROM `tabCompany` WHERE name=%s FOR UPDATE", (company,))
	preview = _direct_update_preview(company, sync_log, import_names_json)
	if not preview["can_update"]:
		frappe.throw(_("所选员工无法直接更新：{0}").format("；".join(preview["issues"][:10])))
	if not preview_token or preview_token != preview["preview_token"]:
		frappe.throw(_("员工资料已变化，请重新点击直接更新。"))
	decisions = integration._json_loads(decisions_json)
	expected_rows = {row["name"] for row in preview["rows"] if row["fields"]}
	if not isinstance(decisions, dict) or set(decisions) != expected_rows:
		frappe.throw(_("请逐项确认所选员工的全部差异。"))
	plans = []
	for row in preview["rows"]:
		if not row["fields"]:
			continue
		choices = decisions[row["name"]]
		if not isinstance(choices, dict) or set(choices) != {item["fieldname"] for item in row["fields"]}:
			frappe.throw(_("请逐项确认所选员工的全部差异。"))
		selected, kept, custom = [], [], {}
		for item in row["fields"]:
			name = item["fieldname"]
			choice = choices[name]
			if not isinstance(choice, dict) or choice.get("choice") not in {"keep", "dingtalk", "custom"}:
				frappe.throw(_("存在尚未确认的字段处理方式。"))
			if choice["choice"] == "keep":
				kept.append(name)
			else:
				selected.append(name)
				if choice["choice"] == "custom":
					custom[name] = choice.get("value")
		plans.append((row, selected, kept, custom))
	updated = fields = 0
	# One request transaction: any rejected row rolls back the entire selection.
	for row, selected, kept, custom in plans:
		integration.apply_dingtalk_employee_comparison(
			row["name"], json.dumps(selected), custom_values_json=json.dumps(custom), keep_fieldnames_json=json.dumps(kept),
			expected_modified=row["employee_modified"], expected_import_modified=row["import_modified"],
		)
		updated += bool(selected)
		fields += len(selected)
	return {"updated": updated, "unchanged": len(preview["rows"]) - updated, "reviewed": len(plans), "updated_fields": fields}


REVIEW_FIELD_TYPES = {"Data", "Link", "Select", "Date", "Datetime", "Int", "Float", "Currency", "Percent", "Check", "Small Text", "Text", "Long Text", "Phone"}


def _new_review_values(doc):
	values, labels = integration._recompute_dingtalk_employee_import(doc)
	values = dict(values)
	# Missing identity/profile fields must still be available for explicit input.
	for name, label in (("custom_employee_code", "公司工号"), *integration.DINGTALK_REVIEWABLE_PROFILE_FIELDS):
		values.setdefault(name, "")
		labels.setdefault(name, label)
	return values, labels


def _new_review_editable(name, field):
	return bool(field and name not in {"company", "status", "first_name"}
		and (not field.read_only or name == "employee_name") and field.fieldtype in REVIEW_FIELD_TYPES)


def _prepare_new_employee_review(doc, decisions_json, reason=""):
	if doc.matched_employee:
		frappe.throw(_("该记录已关联员工，请刷新后使用资料核对。"))
	if doc.import_status == "已驳回":
		frappe.throw(_("该记录已被驳回，请重新同步。"))
	log = _task(doc.company, doc.sync_log)
	if log.status != "已完成" or integration._latest_dingtalk_employee_roster_sync_log(doc.company) != doc.sync_log:
		frappe.throw(_("请使用最新且完整的全员拉取批次建档。"))
	decisions = integration._json_loads(decisions_json)
	if not isinstance(decisions, dict):
		frappe.throw(_("字段核对选择格式无效。"))
	source, labels = _new_review_values(doc)
	meta = {f.fieldname: f for f in frappe.get_meta("Employee").fields if f.fieldname}
	editable = {name for name in source if _new_review_editable(name, meta.get(name))}
	if set(decisions) != editable:
		frappe.throw(_("请逐项选择采用钉钉值、手动填写或暂不录入。"))
	values = {"company": doc.company, "status": "Active"}
	for name in editable:
		choice = decisions[name]
		if not isinstance(choice, dict) or choice.get("choice") not in {"dingtalk", "custom", "skip"}:
			frappe.throw(_("存在尚未确认的字段处理方式。"))
		value = source[name] if choice["choice"] == "dingtalk" else choice.get("value") if choice["choice"] == "custom" else None
		if value not in (None, ""):
			values[name] = integration._normalise_dingtalk_employee_value(name, value, meta[name])
	if values.get("employee_name"):
		values["first_name"] = values["employee_name"]
	issues = integration._dingtalk_new_employee_validation_issues(values)
	if values.get("custom_work_nature") == "离职":
		issues.append("在职来源标为离职，请先核对状态")
	if values.get("department"):
		department_company = frappe.db.get_value("Department", values["department"], "company")
		if department_company != doc.company:
			issues.append("所选部门不属于当前公司")
	code = str(values.get("custom_employee_code") or "").strip()
	if code and frappe.db.exists("Employee", {"custom_employee_code": code}):
		issues.append("该公司工号已存在员工档案，不能重复建档")
	mapping = frappe.db.get_value(integration.DINGTALK_USER_MAP_DOCTYPE,
		{"company": doc.company, "dingtalk_userid": doc.dingtalk_userid}, "employee")
	if mapping:
		issues.append("该钉钉用户已关联员工，请刷新核对，不能重复建档")
	fingerprint = [doc.name, str(doc.modified), doc.sync_log, values, decisions, str(reason).strip()]
	token = hashlib.sha256(json.dumps(fingerprint, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()
	return {"values": values, "labels": labels, "issues": issues, "warnings": integration._dingtalk_missing_profile_labels(values), "preview_token": token, "can_create": not issues}


@frappe.whitelist(methods=["POST"])
def preview_roster_new_employee(import_name: str, company: str, decisions_json: str, reason: str = ""):
	doc = _review_record(import_name, company)
	return _prepare_new_employee_review(doc, decisions_json, reason)


@frappe.whitelist(methods=["POST"])
def create_roster_new_employee(import_name: str, company: str, decisions_json: str, reason: str = "", preview_token: str = ""):
	doc = _review_record(import_name, company)
	scope_company = doc.company
	frappe.db.sql("SELECT name FROM `tabCompany` WHERE name=%s FOR UPDATE", (doc.company,))
	frappe.db.sql("SELECT name FROM `tabHRMS DingTalk Employee Import` WHERE name=%s FOR UPDATE", (doc.name,))
	doc.reload()
	if doc.company != scope_company:
		frappe.throw(_("资料所属公司已变化，请刷新后重新核对。"))
	doc = _review_record(import_name, scope_company)
	preview = _prepare_new_employee_review(doc, decisions_json, reason)
	if not preview["can_create"]:
		frappe.throw(_("建档预检未通过：{0}").format("；".join(preview["issues"])))
	if not preview_token or preview["preview_token"] != preview_token:
		frappe.throw(_("资料或核对选择已变化，请重新预检。"))
	values = preview["values"]
	# Create only, using the exact validated preview; do not create base records.
	employee = frappe.new_doc("Employee")
	employee.flags.hrms_dingtalk_sync = True
	employee.flags.ignore_mandatory = True
	for name, value in values.items():
		if name in employee.meta.get_valid_columns() and value not in (None, ""):
			employee.set(name, value)
	employee.insert(ignore_permissions=True)
	doc.matched_employee = employee.name
	doc.sync_operation = "新建员工"
	doc.sync_completed_at = integration.now_datetime()
	doc.approved_by = frappe.session.user
	doc.approved_at = integration.now_datetime()
	doc.approval_note = "逐项核对新建员工；选择：{0}".format(decisions_json)
	if str(reason or "").strip():
		doc.approval_note += "；原因：" + str(reason).strip()
	doc.import_status = "已人工处理"
	doc.error_message = None
	doc.save(ignore_permissions=True)
	integration._set_dingtalk_mapping_after_import(doc, values, employee.name)
	return {"employee": employee.name}


@frappe.whitelist()
def get_roster_employee_detail(import_name: str, company: str = ""):
	"""Return all API-provided fields, current mapped values and safe local files."""
	doc = _review_record(import_name, company)
	values, labels = integration._recompute_dingtalk_employee_import(doc)
	employee = frappe.get_doc("Employee", doc.matched_employee) if doc.matched_employee else None
	if employee and employee.company != doc.company:
		frappe.throw(_("员工所属公司与钉钉资料不一致。"))
	if not employee:
		values, labels = _new_review_values(doc)
	meta = {f.fieldname: f for f in frappe.get_meta("Employee").fields if f.fieldname}
	differences = integration._dingtalk_employee_field_differences(values, employee or {}, labels, meta)
	difference_names = {item["fieldname"] for item in differences}
	fields = []
	for name, value in values.items():
		if not employee and name == "first_name":
			continue
		field = meta.get(name)
		editable = bool(employee and field and not field.read_only
			and name not in integration.DINGTALK_COMPARISON_PROTECTED_FIELDS
			and field.fieldtype in {"Data", "Link", "Select", "Date", "Datetime", "Int", "Float", "Currency", "Percent", "Check", "Small Text", "Text", "Long Text", "Phone"})
		if not employee:
			editable = _new_review_editable(name, field)
		item = {"fieldname": name, "label": labels.get(name) or (field.label if field else name),
			"system_value": employee.get(name) if employee else None, "dingtalk_value": value,
			"fieldtype": field.fieldtype if field else "Data", "options": field.options if field else "",
			"editable": editable, "different": name in difference_names}
		integration._set_dingtalk_difference_applyability(item, field)
		fields.append(item)
	payload = integration._json_loads(doc.payload_json)
	raw = (payload.get("raw") or payload) if isinstance(payload, dict) else {}
	user = integration._normalize_dingtalk_roster_user(raw, doc.dingtalk_userid)
	attachments = []
	for index, original in enumerate(integration._json_loads(doc.attachments_json) or []):
		item = {key: original.get(key) for key in ("field_name", "file_name", "is_image", "file_size", "sync_status", "sync_message")}
		item.update({"index": index, "download_available": bool(original.get("download_url") or original.get("file_id"))})
		# Expose only verified private/local File records, never remote signed URLs.
		file_name = original.get("hrms_file_name")
		if employee and file_name:
			file = frappe.db.get_value("File", {"name": file_name, "attached_to_doctype": "Employee", "attached_to_name": employee.name}, ["file_url"], as_dict=True)
			if file and str(file.file_url or "").startswith(("/private/files/", "/files/")):
				item["file_url"] = file.file_url
		attachments.append(item)
	return {"name": doc.name, "employee_name": doc.employee_name, "employee": doc.matched_employee,
		"employee_modified": str(employee.modified) if employee else "", "import_modified": str(doc.modified), "fields": fields,
		"source_fields": [{"code": code, "label": user.get("roster_field_labels", {}).get(code) or code, "value": value}
			for code, value in user.get("roster_fields", {}).items()],
		"source_data": raw, "attachments": attachments, "attachment_status": doc.attachment_status,
		"review_note": doc.approval_note, "import_status": doc.import_status}


@frappe.whitelist(methods=["POST"])
def import_roster_employee_attachments(import_name: str, company: str, indexes_json: str, verify_only: int = 0):
	"""Verify or archive explicitly selected files without editing Employee fields."""
	doc = _review_record(import_name, company)
	original = integration._json_loads(doc.attachments_json) or []
	indexes = integration._json_loads(indexes_json)
	if not isinstance(indexes, list) or not indexes or any(type(i) is not int or i < 0 or i >= len(original) for i in indexes):
		frappe.throw(_("请选择有效的附件。"))
	indexes = list(dict.fromkeys(indexes))
	if int(verify_only):
		results = []
		for index in indexes:
			content, error = integration._download_dingtalk_attachment(dict(original[index]))
			results.append({"index": index, "verified": bool(content), "reason": error, "bytes": len(content or b"")})
		return {"results": results}
	if not doc.matched_employee:
		frappe.throw(_("请先建立员工档案，再导入附件。"))
	employee_company = frappe.db.get_value("Employee", doc.matched_employee, "company")
	if employee_company != doc.company:
		frappe.throw(_("附件所属员工与当前公司不匹配。"))
	frappe.db.sql("SELECT name FROM `tabHRMS DingTalk Employee Import` WHERE name=%s FOR UPDATE", (doc.name,))
	doc.reload()
	if integration._json_loads(doc.attachments_json) != original:
		frappe.throw(_("附件资料已变化，请刷新后重试。"))
	doc.attachments_json = integration._json_dumps([original[i] for i in indexes])
	result = integration._import_dingtalk_attachments(doc, doc.matched_employee)
	for index, item in zip(indexes, result["attachments"]):
		original[index] = item
	doc.attachments_json = integration._json_dumps(original)
	archived = sum(item.get("sync_status") == "已归档" for item in original)
	doc.attachment_status = "已下载" if archived == len(original) else "部分下载" if archived else result["status"]
	doc.save(ignore_permissions=True)
	return result
