import hashlib
import json
import os
from datetime import date, datetime, time, timedelta

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
# Application identifiers are environment-specific operational configuration.
# Keep source code portable and never ship a real enterprise identifier in Git.
DINGTALK_DEFAULT_APP_ID = ""
DINGTALK_DEFAULT_CORP_ID = ""
DINGTALK_DEFAULT_AGENT_ID = ""
DINGTALK_DEFAULT_CLIENT_ID = ""
DINGTALK_API_SYNC_MODE = "内网服务器主动拉取API"
DINGTALK_ATTENDANCE_SOURCE_TYPE = "attendance"
DINGTALK_APPROVAL_SOURCE_TYPE = "approval"
DINGTALK_LEGACY_DEPLOYMENT_NOTE = (
	"当前方案：管理后台仍在公司人资系统；钉钉只作为员工入口和数据源。"
	"公网小网关只暴露员工本人查询接口，不暴露 Desk 后台、薪资管理、规则配置和批量数据。"
)
DINGTALK_PHASE_ONE_DEPLOYMENT_NOTE = (
	"第一期：服务器主动拉取钉钉考勤与审批，先写入原始记录和考勤草稿，"
	"经过人事确认后才影响月度汇总与薪资。员工端和公网小网关属于后续阶段。"
)


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


def _require_dingtalk_manager():
	"""Restrict operational integrations to the HR administrators who own them."""
	frappe.only_for(("System Manager", "HR Manager"))


def _require_sync_company(company: str | None = None) -> str:
	settings = _settings_doc()
	company = str(company or settings.get("company") or "").strip()
	if not company:
		frappe.throw(_("请先在钉钉集成设置中选择同步公司。"))
	if not frappe.db.exists("Company", company):
		frappe.throw(_("同步公司不存在：{0}").format(company))
	if settings.get("company") and settings.company != company:
		frappe.throw(_("当前钉钉集成仅允许同步设置中的公司：{0}").format(settings.company))
	return company


def _require_api_sync_enabled(company: str | None = None) -> str:
	company = _require_sync_company(company)
	settings = _settings_doc()
	if not settings.get("enabled") or settings.get("sync_mode") != DINGTALK_API_SYNC_MODE:
		frappe.throw(_("钉钉 API 同步未启用；请先选择“内网服务器主动拉取API”并启用集成。"))
	return company


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
		"company": doc.get("company"),
		"enabled": doc.get("enabled"),
		"sync_mode": doc.get("sync_mode"),
		"daily_sync_enabled": doc.get("daily_sync_enabled"),
		"sync_lookback_days": doc.get("sync_lookback_days"),
		"approval_process_codes": doc.get("approval_process_codes"),
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
	_require_dingtalk_manager()
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
	_require_dingtalk_manager()
	payload = _json_loads(settings_json) if settings_json else kwargs
	doc = _settings_doc()
	for fieldname in (
		"company",
		"enabled",
		"sync_mode",
		"daily_sync_enabled",
		"sync_lookback_days",
		"approval_process_codes",
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
	_require_dingtalk_manager()
	_require_api_sync_enabled()
	access_token = get_dingtalk_access_token_value()
	settings = _settings_doc()
	return {"access_token": "已刷新" if access_token else "", "token_expires_at": settings.token_expires_at}


@frappe.whitelist()
def apply_dingtalk_default_settings():
	"""Apply safe defaults without storing enterprise credentials in source code."""
	_require_dingtalk_manager()
	defaults = get_dingtalk_default_settings()
	doc = _settings_doc()
	for fieldname in ("app_id", "corp_id", "agent_id", "client_id", "sync_mode", "public_gateway_enabled"):
		if fieldname in defaults:
			doc.set(fieldname, defaults[fieldname])
	if defaults.get("client_secret"):
		doc.set_password("client_secret", defaults["client_secret"])
	doc.enabled = 0
	doc.daily_sync_enabled = 0
	doc.sync_lookback_days = doc.get("sync_lookback_days") or 7
	doc.local_gateway_enabled = 0
	doc.employee_gateway_scopes = doc.get("employee_gateway_scopes") or "profile\nattendance"
	doc.server_deployment_note = DINGTALK_PHASE_ONE_DEPLOYMENT_NOTE
	doc.save(ignore_permissions=False)
	return get_dingtalk_connection_status()


@frappe.whitelist()
def fetch_dingtalk_departments(parent_dept_id: str = "1"):
	"""Fetch one level of DingTalk departments.

	官方接口只返回当前部门的下一级部门，因此全量同步会从根部门逐层拉取。
	"""
	_require_dingtalk_manager()
	_require_api_sync_enabled()
	return _dingtalk_api_request("GET", DINGTALK_DEPARTMENT_LIST_PATH, params={"deptId": str(parent_dept_id or "1")})


@frappe.whitelist()
def sync_departments_from_dingtalk(root_dept_id: str = "1", max_depth: int = 20, company: str = ""):
	_require_dingtalk_manager()
	company = _require_api_sync_enabled(company)
	log = _new_sync_log("部门同步", company=company)
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
			payload = _dingtalk_api_request("GET", DINGTALK_DEPARTMENT_LIST_PATH, params={"deptId": parent_id})
			departments = _extract_result_list(payload, "departments", "dept_infos", "deptInfos", "result")
			for item in departments:
				try:
					department = normalize_dingtalk_department(item)
					if not department["parent_id"]:
						department["raw"]["parent_id"] = parent_id
						department = normalize_dingtalk_department(department["raw"])
					upsert_raw_record("department", department["external_id"], department["raw"], log.name, company=company)
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
	_require_dingtalk_manager()
	_require_api_sync_enabled()
	path = DINGTALK_DEPARTMENT_USERS_PATH.format(dept_id=str(dept_id))
	return _dingtalk_api_request("GET", path, params={"cursor": cursor or 0, "size": min(int(size or 100), 100)})


def _department_ids_for_user_sync(department_ids_json=None, company: str = ""):
	if department_ids_json:
		department_ids = _json_loads(department_ids_json)
		if isinstance(department_ids, str):
			return [department_ids]
		return [str(item) for item in department_ids if item not in (None, "")]

	rows = frappe.get_all(
		DINGTALK_RAW_RECORD_DOCTYPE,
		filters={"source_type": "department", "company": company},
		fields=["external_id"],
		limit_page_length=0,
	)
	department_ids = [str(row.external_id) for row in rows if row.external_id]
	return department_ids or ["1"]


@frappe.whitelist()
def sync_users_from_dingtalk(department_ids_json: str | list | None = None, size: int = 100, company: str = ""):
	_require_dingtalk_manager()
	company = _require_api_sync_enabled(company)
	log = _new_sync_log("员工同步", company=company)
	department_ids = _department_ids_for_user_sync(department_ids_json, company)
	received = 0
	failed = 0
	try:
		for dept_id in department_ids:
			cursor = 0
			while True:
				path = DINGTALK_DEPARTMENT_USERS_PATH.format(dept_id=str(dept_id))
				payload = _dingtalk_api_request("GET", path, params={"cursor": cursor or 0, "size": min(int(size or 100), 100)})
				users = _extract_result_list(payload, "users", "user_list", "userList", "result")
				for item in users:
					try:
						if not _first(item, "dept_id_list", "deptIdList", "department", "departmentIds"):
							item["department_id"] = dept_id
						user = normalize_dingtalk_user(item)
						upsert_raw_record("user", user["external_id"], user["raw"], log.name, company=company, dingtalk_userid=user["dingtalk_userid"])
						upsert_user_mapping(user, company)
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
	_require_dingtalk_manager()
	_require_api_sync_enabled()
	work_date = f"{getdate(work_date)} 00:00:00"
	return _dingtalk_api_request(
		"POST",
		DINGTALK_ATTENDANCE_UPDATEDATA_PATH,
		use_oapi=True,
		form_body={"userid": userid, "work_date": work_date},
	)


def _userids_for_attendance_sync(userids_json=None, limit=0, company: str = ""):
	if userids_json:
		userids = _json_loads(userids_json)
		if isinstance(userids, str):
			return [userids]
		return [str(item) for item in userids if item not in (None, "")]
	rows = frappe.get_all(
		DINGTALK_USER_MAP_DOCTYPE,
		filters={"company": company, "sync_status": "已同步"},
		fields=["dingtalk_userid"],
		limit_page_length=int(limit or 0) or 0,
	)
	return [row.dingtalk_userid for row in rows if row.dingtalk_userid]


@frappe.whitelist()
def sync_attendance_from_dingtalk(
	work_date: str,
	userids_json: str | list | None = None,
	limit: int = 0,
	company: str = "",
	convert_to_draft: bool = True,
):
	"""Read one business date into raw storage, then build draft daily checks only."""
	_require_dingtalk_manager()
	company = _require_api_sync_enabled(company)
	business_date = getdate(work_date)
	log = _new_sync_log("考勤同步", company=company, business_date=business_date)
	userids = _userids_for_attendance_sync(userids_json, limit=limit, company=company)
	received = 0
	failed = 0
	try:
		for userid in userids:
			try:
				payload = _dingtalk_api_request(
					"POST",
					DINGTALK_ATTENDANCE_UPDATEDATA_PATH,
					use_oapi=True,
					form_body={"userid": userid, "work_date": f"{business_date} 00:00:00"},
				)
				upsert_raw_record(
					DINGTALK_ATTENDANCE_SOURCE_TYPE,
					f"{userid}:{business_date}",
					payload,
					log.name,
					company=company,
					business_date=business_date,
					dingtalk_userid=userid,
				)
				received += 1
			except Exception:
				failed += 1
		_settings_doc().db_set("last_attendance_sync_at", now_datetime())
		conversion = {}
		if convert_to_draft:
			from hrms.api.dingtalk_attendance_sync import convert_dingtalk_raw_attendance_to_daily_checks

			conversion = convert_dingtalk_raw_attendance_to_daily_checks(company, str(business_date), log.name, enforce_role=False)
		_finish_sync_log(log, "已完成" if not failed else "部分失败", received, conversion.get("created", 0), conversion.get("updated", 0), failed)
		return {"received": received, "failed": failed, "work_date": str(business_date), "conversion": conversion}
	except Exception as exc:
		_finish_sync_log(log, "失败", received, 0, received - failed, failed + 1, str(exc))
		raise


@frappe.whitelist()
def fetch_dingtalk_process_instance_ids(start_time: int | str, end_time: int | str, process_code: str | None = None, cursor: int = 0, size: int = 20):
	_require_dingtalk_manager()
	_require_api_sync_enabled()
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
	_require_dingtalk_manager()
	_require_api_sync_enabled()
	return _dingtalk_api_request(
		"POST",
		DINGTALK_PROCESS_INSTANCE_DETAIL_PATH,
		use_oapi=True,
		json_body={"process_instance_id": process_instance_id},
	)


@frappe.whitelist()
def sync_approval_instance_details_from_payload(instance_ids_json: str | list, company: str = "", business_date: str = ""):
	"""Store approval details for a known list of instance IDs.

	OA审批列表接口在部分版本下有历史范围/版本限制，先支持用实例ID列表验证详情读取。
	"""
	_require_dingtalk_manager()
	company = _require_api_sync_enabled(company)
	log = _new_sync_log("审批同步", company=company, business_date=getdate(business_date) if business_date else None)
	instance_ids = _json_loads(instance_ids_json)
	if isinstance(instance_ids, str):
		instance_ids = [instance_ids]
	received = 0
	failed = 0
	try:
		for instance_id in instance_ids:
			try:
				payload = _dingtalk_api_request(
					"POST", DINGTALK_PROCESS_INSTANCE_DETAIL_PATH, use_oapi=True, json_body={"process_instance_id": instance_id}
				)
				upsert_raw_record(
					DINGTALK_APPROVAL_SOURCE_TYPE,
					instance_id,
					payload,
					log.name,
					company=company,
					business_date=getdate(business_date) if business_date else None,
					dingtalk_userid=_approval_originator_userid(payload),
				)
				received += 1
			except Exception:
				failed += 1
		_settings_doc().db_set("last_approval_sync_at", now_datetime())
		_finish_sync_log(log, "已完成" if not failed else "部分失败", received, 0, received - failed, failed)
		return {"received": received, "failed": failed}
	except Exception as exc:
		_finish_sync_log(log, "失败", received, 0, received - failed, failed + 1, str(exc))
		raise


def _approval_originator_userid(payload) -> str:
	"""Best-effort extraction across legacy and v1.0 approval payload shapes."""
	payload = _json_loads(payload)
	for item in (payload, payload.get("result") or {}, payload.get("data") or {}):
		if isinstance(item, dict):
			value = _first(item, "originator_userid", "originatorUserId", "userid", "userId", "user_id")
			if value:
				return str(value)
	return ""


def _attendance_payload_userid(payload) -> str:
	payload = _json_loads(payload)
	for item in (payload, payload.get("result") or {}, payload.get("data") or {}):
		if isinstance(item, dict):
			value = _first(item, "userid", "userId", "user_id")
			if value:
				return str(value)
	return ""


def _configured_approval_processes() -> dict[str, str]:
	"""Read editable approval mappings in the form ``请假=process-code``."""
	configured = {}
	for line in str(_settings_doc().get("approval_process_codes") or "").replace("；", "\n").splitlines():
		label, separator, process_code = line.partition("=")
		if separator and label.strip() and process_code.strip():
			configured[label.strip()] = process_code.strip()
	return configured


def _epoch_milliseconds(value: date | str, end_of_day: bool = False) -> int:
	day = getdate(value)
	dt = datetime.combine(day, time.max if end_of_day else time.min)
	return int(dt.timestamp() * 1000)


def sync_approvals_from_dingtalk(company: str, business_date: str) -> dict:
	"""Synchronize configured approval process details into raw storage only."""
	company = _require_api_sync_enabled(company)
	processes = _configured_approval_processes()
	if not processes:
		return {"received": 0, "failed": 0, "skipped": "未配置审批流程编码"}

	day = getdate(business_date)
	log = _new_sync_log("审批同步", company=company, business_date=day)
	received = failed = 0
	try:
		for _label, process_code in processes.items():
			cursor = 0
			while True:
				payload = _dingtalk_api_request(
					"POST",
					DINGTALK_PROCESS_INSTANCE_IDS_PATH,
					use_oapi=True,
					json_body={
						"start_time": _epoch_milliseconds(day),
						"end_time": _epoch_milliseconds(day, end_of_day=True),
						"cursor": cursor,
						"size": 20,
						"process_code": process_code,
					},
				)
				instance_ids = _extract_result_list(payload, "list", "result", "process_instance_ids")
				for instance_id in instance_ids:
					try:
						detail = _dingtalk_api_request(
							"POST", DINGTALK_PROCESS_INSTANCE_DETAIL_PATH, use_oapi=True, json_body={"process_instance_id": str(instance_id)}
						)
						upsert_raw_record(
							DINGTALK_APPROVAL_SOURCE_TYPE,
							str(instance_id),
							detail,
							log.name,
							company=company,
							business_date=day,
							dingtalk_userid=_approval_originator_userid(detail),
						)
						received += 1
					except Exception:
						failed += 1
				next_cursor = _next_cursor(payload)
				if next_cursor in (None, "", cursor):
					break
				cursor = next_cursor
		_settings_doc().db_set("last_approval_sync_at", now_datetime())
		_finish_sync_log(log, "已完成" if not failed else "部分失败", received, 0, received - failed, failed)
		return {"received": received, "failed": failed, "log": log.name}
	except Exception as exc:
		_finish_sync_log(log, "失败", received, 0, received - failed, failed + 1, str(exc))
		raise


def run_scheduled_dingtalk_attendance_sync() -> dict:
	"""T+1 sync with configurable seven-day backfill; disabled settings perform no IO."""
	settings = _settings_doc()
	if not settings.get("enabled") or settings.get("sync_mode") != DINGTALK_API_SYNC_MODE or not settings.get("daily_sync_enabled"):
		return {"status": "skipped", "reason": "钉钉每日同步未启用"}
	company = _require_sync_company(settings.get("company"))
	lookback_days = max(1, min(int(settings.get("sync_lookback_days") or 7), 31))
	end_day = getdate(now_datetime()) - timedelta(days=1)
	results = []
	for offset in range(lookback_days - 1, -1, -1):
		business_date = end_day - timedelta(days=offset)
		attendance = sync_attendance_from_dingtalk(str(business_date), company=company)
		approvals = sync_approvals_from_dingtalk(company, str(business_date))
		results.append({"business_date": str(business_date), "attendance": attendance, "approvals": approvals})
	return {"status": "completed", "company": company, "lookback_days": lookback_days, "results": results}


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


def upsert_raw_record(
	source_type: str,
	external_id: str,
	payload: dict | list | str,
	sync_batch: str | None = None,
	sync_status: str = "已接收",
	company: str = "",
	business_date: date | str | None = None,
	dingtalk_userid: str = "",
):
	payload = _json_loads(payload)
	company = _require_sync_company(company)
	external_id = str(external_id or _payload_hash(payload))
	name = frappe.db.exists(DINGTALK_RAW_RECORD_DOCTYPE, {"company": company, "source_type": source_type, "external_id": external_id})
	doc = frappe.get_doc(DINGTALK_RAW_RECORD_DOCTYPE, name) if name else frappe.new_doc(DINGTALK_RAW_RECORD_DOCTYPE)
	doc.update(
		{
			"company": company,
			"source_type": source_type,
			"external_id": external_id,
			"dingtalk_userid": dingtalk_userid or _attendance_payload_userid(payload),
			"business_date": getdate(business_date) if business_date else None,
			"sync_batch": sync_batch,
			"payload_json": _json_dumps(payload),
			"payload_hash": _payload_hash(payload),
			"sync_status": sync_status,
			"received_at": now_datetime(),
		}
	)
	doc.save(ignore_permissions=False)
	return doc


def upsert_user_mapping(user: dict, company: str = ""):
	user = normalize_dingtalk_user(user)
	company = _require_sync_company(company)
	if not user["dingtalk_userid"]:
		frappe.throw(_("钉钉用户缺少 userid，无法建立映射"))
	name = frappe.db.exists(DINGTALK_USER_MAP_DOCTYPE, {"company": company, "dingtalk_userid": user["dingtalk_userid"]})
	doc = frappe.get_doc(DINGTALK_USER_MAP_DOCTYPE, name) if name else frappe.new_doc(DINGTALK_USER_MAP_DOCTYPE)
	doc.update(
		{
			"company": company,
			"dingtalk_userid": user["dingtalk_userid"],
			"employee_code": user["employee_code"],
			"employee_name": user["employee_name"],
			"mobile": user["mobile"],
			"department_id": user["department_id"],
			"department_name": user["department_name"],
			"sync_status": "待匹配",
			"last_synced_at": now_datetime(),
		}
	)
	if user["employee_code"]:
		employee = frappe.db.get_value("Employee", {"custom_employee_code": user["employee_code"]}, "name")
		if employee and frappe.db.get_value("Employee", employee, "company") == company:
			doc.employee = employee
			doc.sync_status = "已同步"
	elif doc.get("employee") and frappe.db.get_value("Employee", doc.employee, "company") != company:
		doc.employee = None
		doc.sync_status = "冲突"
	doc.save(ignore_permissions=False)
	return doc


def _new_sync_log(sync_type: str, sync_direction: str = "钉钉到人资系统", company: str = "", business_date: date | str | None = None):
	doc = frappe.new_doc(DINGTALK_SYNC_LOG_DOCTYPE)
	doc.update(
		{
			"company": _require_sync_company(company),
			"business_date": getdate(business_date) if business_date else None,
			"sync_type": sync_type,
			"sync_direction": sync_direction,
			"status": "运行中",
			"started_at": now_datetime(),
		}
	)
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
	_require_dingtalk_manager()
	items = _items_from_payload(payload_json)
	if source_type == "department":
		return [normalize_dingtalk_department(item) for item in items[:20]]
	if source_type == "user":
		return [normalize_dingtalk_user(item) for item in items[:20]]
	return items[:20]


@frappe.whitelist()
def sync_departments_from_payload(payload_json: str | dict | list, sync_batch: str | None = None, company: str = ""):
	_require_dingtalk_manager()
	company = _require_sync_company(company)
	log = _new_sync_log("部门同步", company=company)
	items = _items_from_payload(payload_json)
	failed = 0
	for item in items:
		try:
			department = normalize_dingtalk_department(item)
			upsert_raw_record("department", department["external_id"], department["raw"], sync_batch or log.name, company=company)
		except Exception:
			failed += 1
	_settings_doc().db_set("last_department_sync_at", now_datetime())
	_finish_sync_log(log, "已完成" if not failed else "部分失败", len(items), 0, len(items) - failed, failed)
	return {"received": len(items), "failed": failed}


@frappe.whitelist()
def sync_users_from_payload(payload_json: str | dict | list, sync_batch: str | None = None, company: str = ""):
	_require_dingtalk_manager()
	company = _require_sync_company(company)
	log = _new_sync_log("员工同步", company=company)
	items = _items_from_payload(payload_json)
	failed = 0
	for item in items:
		try:
			user = normalize_dingtalk_user(item)
			upsert_raw_record("user", user["external_id"], user["raw"], sync_batch or log.name, company=company, dingtalk_userid=user["dingtalk_userid"])
			upsert_user_mapping(user, company)
		except Exception:
			failed += 1
	_settings_doc().db_set("last_user_sync_at", now_datetime())
	_finish_sync_log(log, "已完成" if not failed else "部分失败", len(items), 0, len(items) - failed, failed)
	return {"received": len(items), "failed": failed}


def ensure_dingtalk_company_scope(default_company: str = "永新") -> None:
	"""Backfill pre-isolation integration records once after schema migration.

	The existing deployment is currently single-company (永新). New records always
	require an explicit company through the settings; this compatibility backfill
	keeps old raw evidence and mapping records visible after the new filters ship.
	"""
	if not frappe.db.exists("Company", default_company):
		return
	settings = _settings_doc()
	# ``1`` is the legacy placeholder created by earlier local tests.  The
	# approved first production scope is 永新, so never leave the integration on
	# that empty shell company after a migration.
	if settings.get("company") in (None, "", "1"):
		settings.company = default_company
	if not settings.get("sync_lookback_days"):
		settings.sync_lookback_days = 7
	if settings.get("server_deployment_note") in (None, "", DINGTALK_LEGACY_DEPLOYMENT_NOTE):
		settings.server_deployment_note = DINGTALK_PHASE_ONE_DEPLOYMENT_NOTE
	settings.save(ignore_permissions=True)
	for doctype in (DINGTALK_RAW_RECORD_DOCTYPE, DINGTALK_USER_MAP_DOCTYPE, DINGTALK_SYNC_LOG_DOCTYPE):
		frappe.db.sql(f"UPDATE `tab{doctype}` SET company = %s WHERE IFNULL(company, '') = ''", default_company)
