import hashlib
import json
import os
from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import get_datetime, getdate, now_datetime


DINGTALK_SETTINGS_DOCTYPE = "HRMS DingTalk Settings"
DINGTALK_RAW_RECORD_DOCTYPE = "HRMS DingTalk Raw Record"
DINGTALK_USER_MAP_DOCTYPE = "HRMS DingTalk User Map"
DINGTALK_SYNC_LOG_DOCTYPE = "HRMS DingTalk Sync Log"
DINGTALK_API_BASE_URL = "https://api.dingtalk.com"
DINGTALK_OAPI_BASE_URL = "https://oapi.dingtalk.com"
DINGTALK_ACCESS_TOKEN_URL = "https://api.dingtalk.com/v1.0/oauth2/accessToken"
DINGTALK_DEPARTMENT_LIST_PATH = "/v1.0/contact/departments"
DINGTALK_DEPARTMENT_USERS_PATH = "/v1.0/contact/departments/{dept_id}/users"
DINGTALK_ATTENDANCE_UPDATEDATA_PATH = "/topapi/attendance/getupdatedata"
DINGTALK_PROCESS_INSTANCE_IDS_PATH = "/topapi/processinstance/listids"
DINGTALK_PROCESS_INSTANCE_DETAIL_PATH = "/topapi/processinstance/get"
DINGTALK_DEFAULT_APP_ID = "98202be0-59f9-4f78-b68b-e0773a8b9ff9"
DINGTALK_DEFAULT_CORP_ID = "ding1edfb822df693fc235c2f4657eb6378f"
DINGTALK_DEFAULT_AGENT_ID = "4748178362"
DINGTALK_DEFAULT_CLIENT_ID = "dingx7yuxx801ziffqtq"


def _config_value(key, default=""):
	return frappe.conf.get(key) or os.environ.get(key.upper()) or default


def get_dingtalk_default_settings():
	return {
		"app_id": _config_value("dingtalk_app_id", DINGTALK_DEFAULT_APP_ID),
		"corp_id": _config_value("dingtalk_corp_id", DINGTALK_DEFAULT_CORP_ID),
		"agent_id": _config_value("dingtalk_agent_id", DINGTALK_DEFAULT_AGENT_ID),
		"client_id": _config_value("dingtalk_client_id", DINGTALK_DEFAULT_CLIENT_ID),
		"client_secret": _config_value("dingtalk_client_secret"),
		# Phase one treats DingTalk exports as source files. API and the employee
		# gateway remain optional until the server-side integration is approved.
		"sync_mode": "Excel导入（默认）",
		"public_gateway_enabled": 0,
	}


def _json_loads(value):
	if not value:
		return {}
	if isinstance(value, (dict, list)):
		return value
	return json.loads(value)


def _json_dumps(value):
	return json.dumps(value or {}, ensure_ascii=False, sort_keys=True, default=str)


def _payload_hash(payload):
	return hashlib.sha256(_json_dumps(payload).encode()).hexdigest()


def _first(payload, *keys):
	for key in keys:
		value = payload.get(key)
		if value not in (None, ""):
			return value
	return ""


def _items_from_payload(payload):
	payload = _json_loads(payload)
	if isinstance(payload, list):
		return payload
	for key in ("items", "list", "result", "data", "records", "dept_infos", "deptInfos", "user_list", "userList"):
		value = payload.get(key)
		if isinstance(value, list):
			return value
		if isinstance(value, dict):
			for nested_key in ("items", "list", "result", "data", "records", "dept_infos", "deptInfos", "user_list", "userList"):
				nested = value.get(nested_key)
				if isinstance(nested, list):
					return nested
	return []


def _settings_doc():
	return frappe.get_single(DINGTALK_SETTINGS_DOCTYPE)


def _as_bool(value):
	return bool(int(value or 0))


def _settings_dict(doc=None, include_secret=False):
	doc = doc or _settings_doc()
	result = {
		"enabled": doc.get("enabled"),
		"sync_mode": doc.get("sync_mode"),
		"app_id": doc.get("app_id"),
		"corp_id": doc.get("corp_id"),
		"agent_id": doc.get("agent_id"),
		"client_id": doc.get("client_id"),
		"access_token": "已保存" if doc.get_password("access_token", raise_exception=False) else "",
		"token_expires_at": doc.get("token_expires_at"),
		"local_gateway_enabled": doc.get("local_gateway_enabled"),
		"local_gateway_url": doc.get("local_gateway_url"),
		"public_gateway_enabled": doc.get("public_gateway_enabled"),
		"public_gateway_base_url": doc.get("public_gateway_base_url"),
		"employee_gateway_scopes": doc.get("employee_gateway_scopes"),
		"server_deployment_note": doc.get("server_deployment_note"),
		"last_department_sync_at": doc.get("last_department_sync_at"),
		"last_user_sync_at": doc.get("last_user_sync_at"),
		"last_attendance_sync_at": doc.get("last_attendance_sync_at"),
		"last_approval_sync_at": doc.get("last_approval_sync_at"),
	}
	if include_secret:
		result["client_secret"] = doc.get_password("client_secret", raise_exception=False) or ""
	return result


@frappe.whitelist()
def get_dingtalk_connection_status():
	"""Return safe DingTalk settings for the admin UI."""
	try:
		settings = _settings_doc()
	except Exception:
		return {"configured": False, "message": _("钉钉集成配置尚未初始化")}

	client_secret_saved = bool(settings.get_password("client_secret", raise_exception=False))
	return {
		"configured": bool(settings.get("client_id") and client_secret_saved),
		"settings": _settings_dict(settings),
		"defaults": {key: value for key, value in get_dingtalk_default_settings().items() if key != "client_secret"},
		"client_secret_saved": client_secret_saved,
		"next_steps": [
			"在钉钉创建企业内部应用，复制 Client ID / Client Secret。",
			"申请通讯录、考勤、审批读取权限。",
			"员工端只开放小网关接口，不开放完整后台。",
		],
	}


@frappe.whitelist()
def save_dingtalk_connection_settings(settings_json: str | dict | None = None, **kwargs):
	"""Save connection metadata; secrets stay in the server-side DocType password fields."""
	payload = _json_loads(settings_json) if settings_json else kwargs
	doc = _settings_doc()
	for fieldname in (
		"enabled",
		"sync_mode",
		"app_id",
		"corp_id",
		"agent_id",
		"client_id",
		"local_gateway_enabled",
		"local_gateway_url",
		"public_gateway_enabled",
		"public_gateway_base_url",
		"employee_gateway_scopes",
		"server_deployment_note",
	):
		if fieldname in payload:
			doc.set(fieldname, payload.get(fieldname))
	if payload.get("client_secret"):
		doc.set_password("client_secret", payload.get("client_secret"))
	if payload.get("access_token"):
		doc.set_password("access_token", payload.get("access_token"))
	if payload.get("token_expires_at"):
		doc.set("token_expires_at", payload.get("token_expires_at"))
	doc.save(ignore_permissions=False)
	return get_dingtalk_connection_status()


def _request_access_token(client_id, client_secret):
	import requests

	response = requests.post(
		DINGTALK_ACCESS_TOKEN_URL,
		json={"appKey": client_id, "appSecret": client_secret},
		timeout=20,
	)
	response.raise_for_status()
	data = response.json()
	access_token = data.get("accessToken") or data.get("access_token")
	expire_in = int(data.get("expireIn") or data.get("expires_in") or 7200)
	if not access_token:
		frappe.throw(_("钉钉未返回 access_token：{0}").format(frappe.as_json(data)))
	return access_token, expire_in


def get_dingtalk_access_token_value():
	settings = _settings_doc()
	access_token = settings.get_password("access_token", raise_exception=False)
	token_expires_at = get_datetime(settings.get("token_expires_at")) if settings.get("token_expires_at") else None
	if access_token and token_expires_at and token_expires_at > now_datetime():
		return access_token

	client_id = settings.get("client_id") or get_dingtalk_default_settings()["client_id"]
	client_secret = settings.get_password("client_secret", raise_exception=False) or get_dingtalk_default_settings()["client_secret"]
	if not client_id or not client_secret:
		frappe.throw(_("请先配置钉钉 Client ID 和 Client Secret"))

	access_token, expire_in = _request_access_token(client_id, client_secret)
	settings.set_password("access_token", access_token)
	settings.token_expires_at = now_datetime() + timedelta(seconds=max(expire_in - 300, 60))
	settings.save(ignore_permissions=False)
	return access_token


def _dingtalk_api_request(method, path, params=None, json_body=None, use_oapi=False, form_body=None):
	import requests

	access_token = get_dingtalk_access_token_value()
	if use_oapi:
		url = f"{DINGTALK_OAPI_BASE_URL}{path}"
		request_params = dict(params or {})
		request_params["access_token"] = access_token
		response = requests.request(
			method,
			url,
			params=request_params,
			json=json_body if form_body is None else None,
			data=form_body,
			timeout=30,
		)
	else:
		url = f"{DINGTALK_API_BASE_URL}{path}"
		response = requests.request(
			method,
			url,
			params=params,
			json=json_body,
			headers={"x-acs-dingtalk-access-token": access_token},
			timeout=30,
		)
	response.raise_for_status()
	data = response.json()
	errcode = data.get("errcode")
	if errcode not in (None, 0):
		frappe.throw(_("钉钉接口返回错误 {0}: {1}").format(errcode, data.get("errmsg") or frappe.as_json(data)))
	return data


def _extract_result_list(payload, *keys):
	payload = _json_loads(payload)
	for key in keys:
		value = payload.get(key)
		if isinstance(value, list):
			return value
		if isinstance(value, dict):
			items = _items_from_payload(value)
			if items:
				return items
	items = _items_from_payload(payload)
	return items


def _next_cursor(payload):
	payload = _json_loads(payload)
	for container in (payload, payload.get("result") or {}, payload.get("data") or {}):
		if not isinstance(container, dict):
			continue
		cursor = container.get("next_cursor", container.get("nextCursor", container.get("cursor")))
		has_more = container.get("has_more", container.get("hasMore"))
		if cursor not in (None, "") and has_more not in (False, "false", 0):
			return cursor
	return None


@frappe.whitelist()
def fetch_access_token():
	"""Fetch and cache a DingTalk access_token using Client ID / Client Secret.

	部署到服务器后仍建议由后端定时任务调用；不要把 client_secret 放到浏览器。
	"""
	access_token = get_dingtalk_access_token_value()
	settings = _settings_doc()
	return {"access_token": "已刷新" if access_token else "", "token_expires_at": settings.token_expires_at}


@frappe.whitelist()
def apply_dingtalk_default_settings():
	"""Populate this company's DingTalk app IDs without storing the secret in source code."""
	defaults = get_dingtalk_default_settings()
	doc = _settings_doc()
	for fieldname in ("app_id", "corp_id", "agent_id", "client_id", "sync_mode", "public_gateway_enabled"):
		if fieldname in defaults:
			doc.set(fieldname, defaults[fieldname])
	if defaults.get("client_secret"):
		doc.set_password("client_secret", defaults["client_secret"])
	doc.enabled = 0
	doc.local_gateway_enabled = 0
	doc.employee_gateway_scopes = doc.get("employee_gateway_scopes") or "profile\nattendance"
	doc.server_deployment_note = (
		"当前方案：管理后台仍在公司人资系统；钉钉只作为员工入口和数据源。"
		"公网小网关只暴露员工本人查询接口，不暴露 Desk 后台、薪资管理、规则配置和批量数据。"
	)
	doc.save(ignore_permissions=False)
	return get_dingtalk_connection_status()


@frappe.whitelist()
def fetch_dingtalk_departments(parent_dept_id: str = "1"):
	"""Fetch one level of DingTalk departments.

	官方接口只返回当前部门的下一级部门，因此全量同步会从根部门逐层拉取。
	"""
	return _dingtalk_api_request("GET", DINGTALK_DEPARTMENT_LIST_PATH, params={"deptId": str(parent_dept_id or "1")})


@frappe.whitelist()
def sync_departments_from_dingtalk(root_dept_id: str = "1", max_depth: int = 20):
	log = _new_sync_log("部门同步")
	queue = [(str(root_dept_id or "1"), 0)]
	seen = set()
	received = 0
	failed = 0
	try:
		while queue:
			parent_id, depth = queue.pop(0)
			if parent_id in seen or depth > int(max_depth or 20):
				continue
			seen.add(parent_id)
			payload = fetch_dingtalk_departments(parent_id)
			departments = _extract_result_list(payload, "departments", "dept_infos", "deptInfos", "result")
			for item in departments:
				try:
					department = normalize_dingtalk_department(item)
					if not department["parent_id"]:
						department["raw"]["parent_id"] = parent_id
						department = normalize_dingtalk_department(department["raw"])
					upsert_raw_record("department", department["external_id"], department["raw"], log.name)
					received += 1
					if department["external_id"] and department["external_id"] not in seen:
						queue.append((department["external_id"], depth + 1))
				except Exception:
					failed += 1
		_settings_doc().db_set("last_department_sync_at", now_datetime())
		_finish_sync_log(log, "已完成" if not failed else "部分失败", received, 0, received - failed, failed)
		return {"received": received, "failed": failed, "root_dept_id": root_dept_id}
	except Exception as exc:
		_finish_sync_log(log, "失败", received, 0, received - failed, failed + 1, str(exc))
		raise


@frappe.whitelist()
def fetch_dingtalk_department_users(dept_id: str, cursor: int = 0, size: int = 100):
	path = DINGTALK_DEPARTMENT_USERS_PATH.format(dept_id=str(dept_id))
	return _dingtalk_api_request("GET", path, params={"cursor": cursor or 0, "size": min(int(size or 100), 100)})


def _department_ids_for_user_sync(department_ids_json=None):
	if department_ids_json:
		department_ids = _json_loads(department_ids_json)
		if isinstance(department_ids, str):
			return [department_ids]
		return [str(item) for item in department_ids if item not in (None, "")]

	rows = frappe.get_all(
		DINGTALK_RAW_RECORD_DOCTYPE,
		filters={"source_type": "department"},
		fields=["external_id"],
		limit_page_length=0,
	)
	department_ids = [str(row.external_id) for row in rows if row.external_id]
	return department_ids or ["1"]


@frappe.whitelist()
def sync_users_from_dingtalk(department_ids_json: str | list | None = None, size: int = 100):
	log = _new_sync_log("员工同步")
	department_ids = _department_ids_for_user_sync(department_ids_json)
	received = 0
	failed = 0
	try:
		for dept_id in department_ids:
			cursor = 0
			while True:
				payload = fetch_dingtalk_department_users(dept_id, cursor=cursor, size=size)
				users = _extract_result_list(payload, "users", "user_list", "userList", "result")
				for item in users:
					try:
						if not _first(item, "dept_id_list", "deptIdList", "department", "departmentIds"):
							item["department_id"] = dept_id
						user = normalize_dingtalk_user(item)
						upsert_raw_record("user", user["external_id"], user["raw"], log.name)
						upsert_user_mapping(user)
						received += 1
					except Exception:
						failed += 1
				next_cursor = _next_cursor(payload)
				if next_cursor in (None, "", cursor):
					break
				cursor = next_cursor
		_settings_doc().db_set("last_user_sync_at", now_datetime())
		_finish_sync_log(log, "已完成" if not failed else "部分失败", received, 0, received - failed, failed)
		return {"received": received, "failed": failed, "department_count": len(department_ids)}
	except Exception as exc:
		_finish_sync_log(log, "失败", received, 0, received - failed, failed + 1, str(exc))
		raise


@frappe.whitelist()
def fetch_dingtalk_attendance_update_data(userid: str, work_date: str):
	work_date = f"{getdate(work_date)} 00:00:00"
	return _dingtalk_api_request(
		"POST",
		DINGTALK_ATTENDANCE_UPDATEDATA_PATH,
		use_oapi=True,
		form_body={"userid": userid, "work_date": work_date},
	)


def _userids_for_attendance_sync(userids_json=None, limit=0):
	if userids_json:
		userids = _json_loads(userids_json)
		if isinstance(userids, str):
			return [userids]
		return [str(item) for item in userids if item not in (None, "")]
	rows = frappe.get_all(
		DINGTALK_USER_MAP_DOCTYPE,
		fields=["dingtalk_userid"],
		limit_page_length=int(limit or 0) or 0,
	)
	return [row.dingtalk_userid for row in rows if row.dingtalk_userid]


@frappe.whitelist()
def sync_attendance_from_dingtalk(work_date: str, userids_json: str | list | None = None, limit: int = 0):
	log = _new_sync_log("考勤同步")
	userids = _userids_for_attendance_sync(userids_json, limit=limit)
	received = 0
	failed = 0
	try:
		for userid in userids:
			try:
				payload = fetch_dingtalk_attendance_update_data(userid, work_date)
				upsert_raw_record("attendance", f"{userid}:{getdate(work_date)}", payload, log.name)
				received += 1
			except Exception:
				failed += 1
		_settings_doc().db_set("last_attendance_sync_at", now_datetime())
		_finish_sync_log(log, "已完成" if not failed else "部分失败", received, 0, received - failed, failed)
		return {"received": received, "failed": failed, "work_date": str(getdate(work_date))}
	except Exception as exc:
		_finish_sync_log(log, "失败", received, 0, received - failed, failed + 1, str(exc))
		raise


@frappe.whitelist()
def fetch_dingtalk_process_instance_ids(start_time: int | str, end_time: int | str, process_code: str | None = None, cursor: int = 0, size: int = 20):
	payload = {
		"start_time": int(start_time),
		"end_time": int(end_time),
		"cursor": cursor or 0,
		"size": min(int(size or 20), 20),
	}
	if process_code:
		payload["process_code"] = process_code
	return _dingtalk_api_request("POST", DINGTALK_PROCESS_INSTANCE_IDS_PATH, use_oapi=True, json_body=payload)


@frappe.whitelist()
def fetch_dingtalk_process_instance_detail(process_instance_id: str):
	return _dingtalk_api_request(
		"POST",
		DINGTALK_PROCESS_INSTANCE_DETAIL_PATH,
		use_oapi=True,
		json_body={"process_instance_id": process_instance_id},
	)


@frappe.whitelist()
def sync_approval_instance_details_from_payload(instance_ids_json: str | list):
	"""Store approval details for a known list of instance IDs.

	OA审批列表接口在部分版本下有历史范围/版本限制，先支持用实例ID列表验证详情读取。
	"""
	log = _new_sync_log("审批同步")
	instance_ids = _json_loads(instance_ids_json)
	if isinstance(instance_ids, str):
		instance_ids = [instance_ids]
	received = 0
	failed = 0
	try:
		for instance_id in instance_ids:
			try:
				payload = fetch_dingtalk_process_instance_detail(instance_id)
				upsert_raw_record("approval", instance_id, payload, log.name)
				received += 1
			except Exception:
				failed += 1
		_settings_doc().db_set("last_approval_sync_at", now_datetime())
		_finish_sync_log(log, "已完成" if not failed else "部分失败", received, 0, received - failed, failed)
		return {"received": received, "failed": failed}
	except Exception as exc:
		_finish_sync_log(log, "失败", received, 0, received - failed, failed + 1, str(exc))
		raise


def normalize_dingtalk_department(payload):
	payload = _json_loads(payload)
	return {
		"source_type": "department",
		"external_id": str(_first(payload, "dept_id", "deptId", "department_id", "id")),
		"department_name": _first(payload, "name", "deptName", "department_name"),
		"parent_id": str(_first(payload, "parent_id", "parentId", "parentDeptId")),
		"raw": payload,
	}


def normalize_dingtalk_user(payload):
	payload = _json_loads(payload)
	department_ids = _first(payload, "dept_id_list", "deptIdList", "department", "departmentIds")
	if isinstance(department_ids, list):
		department_id = ",".join(str(item) for item in department_ids)
	else:
		department_id = str(department_ids or "")
	return {
		"source_type": "user",
		"external_id": str(_first(payload, "userid", "userId", "user_id", "id")),
		"dingtalk_userid": str(_first(payload, "userid", "userId", "user_id", "id")),
		"employee_name": _first(payload, "name", "employeeName", "username"),
		"mobile": _first(payload, "mobile", "phone", "telephone"),
		"employee_code": _first(payload, "job_number", "jobNumber", "employeeNo", "employee_code"),
		"title": _first(payload, "title", "position", "jobTitle"),
		"department_id": department_id,
		"department_name": _first(payload, "department_name", "deptName"),
		"raw": payload,
	}


def upsert_raw_record(source_type, external_id, payload, sync_batch=None, sync_status="已接收"):
	payload = _json_loads(payload)
	external_id = str(external_id or _payload_hash(payload))
	name = frappe.db.exists(DINGTALK_RAW_RECORD_DOCTYPE, {"source_type": source_type, "external_id": external_id})
	doc = frappe.get_doc(DINGTALK_RAW_RECORD_DOCTYPE, name) if name else frappe.new_doc(DINGTALK_RAW_RECORD_DOCTYPE)
	doc.update(
		{
			"source_type": source_type,
			"external_id": external_id,
			"sync_batch": sync_batch,
			"payload_json": _json_dumps(payload),
			"payload_hash": _payload_hash(payload),
			"sync_status": sync_status,
			"received_at": now_datetime(),
		}
	)
	doc.save(ignore_permissions=False)
	return doc


def upsert_user_mapping(user):
	user = normalize_dingtalk_user(user)
	if not user["dingtalk_userid"]:
		frappe.throw(_("钉钉用户缺少 userid，无法建立映射"))
	name = frappe.db.exists(DINGTALK_USER_MAP_DOCTYPE, {"dingtalk_userid": user["dingtalk_userid"]})
	doc = frappe.get_doc(DINGTALK_USER_MAP_DOCTYPE, name) if name else frappe.new_doc(DINGTALK_USER_MAP_DOCTYPE)
	doc.update(
		{
			"dingtalk_userid": user["dingtalk_userid"],
			"employee_code": user["employee_code"],
			"employee_name": user["employee_name"],
			"mobile": user["mobile"],
			"department_id": user["department_id"],
			"department_name": user["department_name"],
			"sync_status": "已同步",
			"last_synced_at": now_datetime(),
		}
	)
	if not doc.get("employee") and user["employee_code"]:
		employee = frappe.db.get_value("Employee", {"custom_employee_code": user["employee_code"]}, "name")
		if employee:
			doc.employee = employee
	doc.save(ignore_permissions=False)
	return doc


def _new_sync_log(sync_type, sync_direction="钉钉到人资系统"):
	doc = frappe.new_doc(DINGTALK_SYNC_LOG_DOCTYPE)
	doc.update({"sync_type": sync_type, "sync_direction": sync_direction, "status": "运行中", "started_at": now_datetime()})
	doc.insert(ignore_permissions=False)
	return doc


def _finish_sync_log(doc, status, received=0, created=0, updated=0, failed=0, error_message=""):
	doc.update(
		{
			"status": status,
			"finished_at": now_datetime(),
			"records_received": received,
			"records_created": created,
			"records_updated": updated,
			"records_failed": failed,
			"error_message": error_message,
		}
	)
	doc.save(ignore_permissions=False)
	return doc


@frappe.whitelist()
def preview_sync_payload(source_type: str, payload_json: str | dict | list):
	items = _items_from_payload(payload_json)
	if source_type == "department":
		return [normalize_dingtalk_department(item) for item in items[:20]]
	if source_type == "user":
		return [normalize_dingtalk_user(item) for item in items[:20]]
	return items[:20]


@frappe.whitelist()
def sync_departments_from_payload(payload_json: str | dict | list, sync_batch: str | None = None):
	log = _new_sync_log("部门同步")
	items = _items_from_payload(payload_json)
	failed = 0
	for item in items:
		try:
			department = normalize_dingtalk_department(item)
			upsert_raw_record("department", department["external_id"], department["raw"], sync_batch)
		except Exception:
			failed += 1
	_settings_doc().db_set("last_department_sync_at", now_datetime())
	_finish_sync_log(log, "已完成" if not failed else "部分失败", len(items), 0, len(items) - failed, failed)
	return {"received": len(items), "failed": failed}


@frappe.whitelist()
def sync_users_from_payload(payload_json: str | dict | list, sync_batch: str | None = None):
	log = _new_sync_log("员工同步")
	items = _items_from_payload(payload_json)
	failed = 0
	for item in items:
		try:
			user = normalize_dingtalk_user(item)
			upsert_raw_record("user", user["external_id"], user["raw"], sync_batch)
			upsert_user_mapping(user)
		except Exception:
			failed += 1
	_settings_doc().db_set("last_user_sync_at", now_datetime())
	_finish_sync_log(log, "已完成" if not failed else "部分失败", len(items), 0, len(items) - failed, failed)
	return {"received": len(items), "failed": failed}
