"""Background read-only roster comparisons; never approve or apply Employee changes."""

import frappe
from frappe import _

from hrms.api import dingtalk_integration as integration


FULL_ROSTER_TASK_MARKER = "正在拉取企业通讯录与智能人事全员名单"


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
		integration._require_dingtalk_employee_import_approver()
		integration._require_api_sync_enabled(company)
		log.status = "运行中"
		log.save(ignore_permissions=False)
		frappe.db.commit()
		result = integration._sync_all_employee_rosters(company, sync_log=log, include_directory=True)
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
		"finished_at": log.finished_at,
	}


def fetch_full_roster_users():
	"""Union the live internal directory and HRM roster, independent of pre-entry."""
	from collections import deque

	departments = deque(["1"])
	seen_departments = set()
	directory = {}
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
			next_cursor = integration._next_cursor(payload)
			if next_cursor is None:
				break
			cursor = next_cursor
	onjob = integration._fetch_dingtalk_onjob_userids()
	details = integration._fetch_dingtalk_preentry_details(onjob) if onjob else {}
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
def list_roster_employees(company: str = "", sync_log: str = "", start: int = 0, page_length: int = 100):
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
	rows = frappe.get_all(
		integration.DINGTALK_EMPLOYEE_IMPORT_DOCTYPE,
		filters=filters,
		fields=["name", "employee_code", "employee_name", "department", "designation",
			"date_of_joining", "matched_employee", "import_status", "error_message"],
		order_by="employee_code asc, name asc", limit_start=start, limit_page_length=page_length + 1,
	)
	return {"rows": rows[:page_length], "sync_log": sync_log, "status": log.status,
		"total": frappe.db.count(integration.DINGTALK_EMPLOYEE_IMPORT_DOCTYPE, filters),
		"has_more": len(rows) > page_length, "next_start": start + page_length,
		"received": log.records_received or 0, "failed": log.records_failed or 0,
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


@frappe.whitelist()
def get_roster_employee_detail(import_name: str, company: str = ""):
	"""Return all API-provided fields, current mapped values and safe local files."""
	doc = _review_record(import_name, company)
	values, labels = integration._recompute_dingtalk_employee_import(doc)
	employee = frappe.get_doc("Employee", doc.matched_employee) if doc.matched_employee else None
	if employee and employee.company != doc.company:
		frappe.throw(_("员工所属公司与钉钉资料不一致。"))
	meta = {f.fieldname: f for f in frappe.get_meta("Employee").fields if f.fieldname}
	differences = integration._dingtalk_employee_field_differences(values, employee or {}, labels, meta)
	difference_names = {item["fieldname"] for item in differences}
	fields = []
	for name, value in values.items():
		field = meta.get(name)
		editable = bool(employee and field and not field.read_only
			and name not in integration.DINGTALK_COMPARISON_PROTECTED_FIELDS
			and field.fieldtype in {"Data", "Link", "Select", "Date", "Datetime", "Int", "Float", "Currency", "Percent", "Check", "Small Text", "Text", "Long Text", "Phone"})
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
