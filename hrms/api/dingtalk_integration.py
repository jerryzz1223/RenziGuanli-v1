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
ATTENDANCE_BATCH_DOCTYPE = "HRMS Attendance Import Batch"
DINGTALK_API_BASE_URL = "https://api.dingtalk.com"
DINGTALK_OAPI_BASE_URL = "https://oapi.dingtalk.com"
DINGTALK_ACCESS_TOKEN_URL = "https://api.dingtalk.com/v1.0/oauth2/accessToken"
# DingTalk's current enterprise address-book read endpoints are served by the
# OAPI host.  The previous v1.0 paths returned HTTP 404 before a permission
# check could occur, which made a valid application appear misconfigured.
DINGTALK_DEPARTMENT_LIST_PATH = "/topapi/v2/department/listsub"
DINGTALK_DEPARTMENT_USERS_PATH = "/topapi/v2/user/list"
# ``getupdatedata`` is an incremental user/day endpoint.  It can legitimately
# return an empty envelope even when the user has historical attendance.  The
# attendance-list endpoint is the primary batch result feed for HR review.
DINGTALK_ATTENDANCE_LIST_PATH = "/attendance/list"
DINGTALK_ATTENDANCE_LIST_RECORD_PATH = "/attendance/listRecord"
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
		# Password fields are encrypted by Frappe during ``doc.save()``. Document
		# does not expose a ``set_password`` method on the supported version.
		doc.set("client_secret", payload.get("client_secret"))
	if payload.get("access_token"):
		doc.set("access_token", payload.get("access_token"))
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
	if not response.ok:
		# Do not call ``raise_for_status`` here: its exception string includes the
		# full OAPI URL and would expose the access token in the query string.
		frappe.throw(_("钉钉接口请求失败（HTTP {0}）。").format(response.status_code))
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
	# Let Frappe save the token into its encrypted Password store.
	settings.set("access_token", access_token)
	settings.token_expires_at = now_datetime() + timedelta(seconds=max(expire_in - 300, 60))
	settings.save(ignore_permissions=False)
	return access_token


def _dingtalk_api_request(method, path, params=None, json_body=None, use_oapi=False, form_body=None):
	import requests
	from requests.adapters import HTTPAdapter
	from urllib3.util.retry import Retry

	access_token = get_dingtalk_access_token_value()
	retry = Retry(
		total=3,
		connect=3,
		read=3,
		backoff_factor=0.5,
		status_forcelist=(429, 500, 502, 503, 504),
		allowed_methods=frozenset(("GET", "POST")),
		raise_on_status=False,
	)
	session = requests.Session()
	session.mount("https://", HTTPAdapter(max_retries=retry))
	if use_oapi:
		url = f"{DINGTALK_OAPI_BASE_URL}{path}"
		request_params = dict(params or {})
		request_params["access_token"] = access_token
	else:
		url = f"{DINGTALK_API_BASE_URL}{path}"
		request_params = params

	try:
		response = session.request(
			method,
			url,
			params=request_params,
			json=json_body if use_oapi and form_body is None else json_body,
			data=form_body if use_oapi else None,
			headers={} if use_oapi else {"x-acs-dingtalk-access-token": access_token},
			timeout=30,
		)
	except requests.RequestException as exc:
		# Never return the request URL: the OAPI access token is carried in its
		# query string and must not leak into Desk messages or terminal output.
		frappe.throw(_("钉钉网络连接失败，系统已重试 3 次；请稍后重试。原因：{0}").format(type(exc).__name__))
	if not response.ok:
		# ``requests.raise_for_status`` includes the URL in its exception text.
		# OAPI puts the short-lived access token in the query string, so returning
		# that exception would leak it to Desk and to terminal history.
		frappe.throw(_("钉钉接口请求失败（HTTP {0}）。").format(response.status_code))
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
		doc.set("client_secret", defaults["client_secret"])
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
	return _dingtalk_api_request(
		"POST",
		DINGTALK_DEPARTMENT_LIST_PATH,
		use_oapi=True,
		json_body={"dept_id": int(parent_dept_id or 1), "language": "zh_CN"},
	)


@frappe.whitelist()
def sync_departments_from_dingtalk(root_dept_id: str = "1", max_depth: int = 20, company: str = ""):
	_require_dingtalk_manager()
	company = _require_api_sync_enabled(company)
	log = _new_sync_log("部门同步", company=company)
	queue = [(str(root_dept_id or "1"), 0)]
	seen = set()
	received = 0
	failed = 0
	errors = []
	try:
		while queue:
			parent_id, depth = queue.pop(0)
			if parent_id in seen or depth > int(max_depth or 20):
				continue
			seen.add(parent_id)
			payload = _dingtalk_api_request(
				"POST",
				DINGTALK_DEPARTMENT_LIST_PATH,
				use_oapi=True,
				json_body={"dept_id": int(parent_id), "language": "zh_CN"},
			)
			departments = _extract_result_list(payload, "departments", "dept_infos", "deptInfos", "result")
			for item in departments:
				received += 1
				try:
					department = normalize_dingtalk_department(item)
					if not department["parent_id"]:
						department["raw"]["parent_id"] = parent_id
						department = normalize_dingtalk_department(department["raw"])
					upsert_raw_record("department", department["external_id"], department["raw"], log.name, company=company)
					if department["external_id"] and department["external_id"] not in seen:
						queue.append((department["external_id"], depth + 1))
				except Exception as exc:
					failed += 1
					if len(errors) < 10:
						errors.append("部门 {0}: {1}".format(parent_id, str(exc)))
		_settings_doc().db_set("last_department_sync_at", now_datetime())
		error_message = "\n".join(errors)
		_finish_sync_log(log, "已完成" if not failed else "部分失败", received, 0, received - failed, failed, error_message)
		return {"received": received, "failed": failed, "root_dept_id": root_dept_id, "error_message": error_message}
	except Exception as exc:
		_finish_sync_log(log, "失败", received, 0, received - failed, failed + 1, str(exc))
		raise


@frappe.whitelist()
def fetch_dingtalk_department_users(dept_id: str, cursor: int = 0, size: int = 100):
	_require_dingtalk_manager()
	_require_api_sync_enabled()
	return _dingtalk_api_request(
		"POST",
		DINGTALK_DEPARTMENT_USERS_PATH,
		use_oapi=True,
		json_body={
			"dept_id": int(dept_id),
			"cursor": int(cursor or 0),
			"size": min(int(size or 100), 100),
			"order_field": "modify_desc",
			"contain_access_limit": True,
		},
	)


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
	errors = []
	try:
		for dept_id in department_ids:
			cursor = 0
			while True:
				payload = _dingtalk_api_request(
					"POST",
					DINGTALK_DEPARTMENT_USERS_PATH,
					use_oapi=True,
					json_body={
						"dept_id": int(dept_id),
						"cursor": int(cursor or 0),
						"size": min(int(size or 100), 100),
						"order_field": "modify_desc",
						"contain_access_limit": True,
					},
				)
				users = _extract_result_list(payload, "users", "user_list", "userList", "result")
				for item in users:
					received += 1
					try:
						if not _first(item, "dept_id_list", "deptIdList", "department", "departmentIds"):
							item["department_id"] = dept_id
						user = normalize_dingtalk_user(item)
						upsert_raw_record("user", user["external_id"], user["raw"], log.name, company=company, dingtalk_userid=user["dingtalk_userid"])
						upsert_user_mapping(user, company)
					except Exception as exc:
						failed += 1
						if len(errors) < 10:
							user_id = _first(item, "userid", "userId", "user_id", "id") or "未知用户"
							errors.append("员工 {0}: {1}".format(user_id, str(exc)))
				next_cursor = _next_cursor(payload)
				if next_cursor in (None, "", cursor):
					break
				cursor = next_cursor
		_settings_doc().db_set("last_user_sync_at", now_datetime())
		error_message = "\n".join(errors)
		_finish_sync_log(log, "已完成" if not failed else "部分失败", received, 0, received - failed, failed, error_message)
		return {"received": received, "failed": failed, "department_count": len(department_ids), "error_message": error_message}
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


def _chunks(values, size):
	for index in range(0, len(values), size):
		yield values[index : index + size]


def _fetch_dingtalk_attendance_results(userids: list[str], business_date: date) -> tuple[dict[str, list], int, dict[str, str]]:
	"""Fetch actual attendance results in documented batches of at most 50 users."""
	results_by_user = {str(user_id): [] for user_id in userids}
	endpoint_by_user = {str(user_id): "attendance/list" for user_id in userids}
	request_count = 0
	date_text = f"{business_date} 00:00:00"
	for user_chunk in _chunks(userids, 50):
		offset = 0
		while True:
			payload = _dingtalk_api_request(
				"POST",
				DINGTALK_ATTENDANCE_LIST_PATH,
				use_oapi=True,
				json_body={
					"workDateFrom": date_text,
					"workDateTo": date_text,
					"userIdList": user_chunk,
					"offset": offset,
					"limit": 50,
					"isI18n": False,
				},
			)
			request_count += 1
			for record in payload.get("recordresult") or []:
				user_id = str(_first(record, "userId", "userid", "user_id") or "")
				if user_id:
					results_by_user.setdefault(user_id, []).append(record)
			if not payload.get("hasMore"):
				break
			offset += 1
		# Some enterprises return an empty result feed but do expose the detailed
		# record endpoint.  Use it only as a fallback for this chunk so we neither
		# duplicate records nor confuse an empty result with an absence.
		if not any(results_by_user.get(str(user_id)) for user_id in user_chunk):
			detail_payload = _dingtalk_api_request(
				"POST",
				DINGTALK_ATTENDANCE_LIST_RECORD_PATH,
				use_oapi=True,
				json_body={
					"userIds": user_chunk,
					"checkDateFrom": date_text,
					"checkDateTo": date_text,
					"isI18n": False,
				},
			)
			request_count += 1
			for record in detail_payload.get("recordresult") or []:
				user_id = str(_first(record, "userId", "userid", "user_id") or "")
				if user_id:
					results_by_user.setdefault(user_id, []).append(record)
					endpoint_by_user[user_id] = "attendance/listRecord"
	return results_by_user, request_count, endpoint_by_user


@frappe.whitelist()
def sync_attendance_from_dingtalk(
	work_date: str,
	userids_json: str | list | None = None,
	limit: int = 0,
	company: str = "",
	convert_to_draft: bool = True,
	sync_log: str = "",
	finalize_log: bool = True,
):
	"""Read one business date into raw storage, then build draft daily checks only."""
	_require_dingtalk_manager()
	company = _require_api_sync_enabled(company)
	business_date = getdate(work_date)
	log = _get_or_start_attendance_sync_log(sync_log, company, business_date)
	if _sync_cancel_requested(log.name):
		if finalize_log:
			_finish_sync_log(log, "已撤销", error_message="同步任务在开始前已取消；未写入考勤草稿。")
		return {"sync_log": log.name, "received": 0, "failed": 0, "work_date": str(business_date), "cancelled": True}
	userids = _userids_for_attendance_sync(userids_json, limit=limit, company=company)
	received = 0
	failed = 0
	errors = []
	try:
		try:
			results_by_user, request_count, endpoint_by_user = _fetch_dingtalk_attendance_results(userids, business_date)
			if _sync_cancel_requested(log.name):
				if finalize_log:
					_finish_sync_log(log, "已撤销", error_message="同步任务已取消；未写入考勤草稿。")
				return {"sync_log": log.name, "received": 0, "failed": 0, "work_date": str(business_date), "cancelled": True}
			for userid in userids:
				if _sync_cancel_requested(log.name):
					break
				# Normalize the batch response to the same immutable raw-payload shape
				# used by the daily converter and raw-record viewer.
				payload = {
					"errcode": 0,
					"errmsg": "ok",
					"source_endpoint": endpoint_by_user.get(str(userid), "attendance/list"),
					"request_count": request_count,
					"result": {
						"userid": userid,
						"work_date": f"{business_date} 00:00:00",
						"check_record_list": results_by_user.get(str(userid), []),
						"attendance_result_list": results_by_user.get(str(userid), []),
						"approve_list": [],
					},
				}
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
			if _sync_cancel_requested(log.name):
				if finalize_log:
					_finish_sync_log(log, "已撤销", received, 0, 0, 0, "同步任务已取消；原始响应可能已保留，但未生成考勤草稿。")
				return {"sync_log": log.name, "received": received, "failed": 0, "work_date": str(business_date), "cancelled": True}
		except Exception as exc:
			# Keep an explicit failure rather than silently treating a failed batch as
			# an employee with no punch.  The previous raw data remains auditable.
			failed = len(userids)
			errors.append("批量获取打卡结果失败：{0}".format(str(exc)))
		_settings_doc().db_set("last_attendance_sync_at", now_datetime())
		conversion = {}
		if convert_to_draft and not failed:
			from hrms.api.dingtalk_attendance_sync import convert_dingtalk_raw_attendance_to_daily_checks

			conversion = convert_dingtalk_raw_attendance_to_daily_checks(company, str(business_date), log.name, enforce_role=False)
		error_message = "\n".join(errors)
		if finalize_log:
			_finish_sync_log(log, "已完成" if not failed else "部分失败", received, conversion.get("created", 0), conversion.get("updated", 0), failed, error_message)
		return {"sync_log": log.name, "received": received, "failed": failed, "work_date": str(business_date), "conversion": conversion, "error_message": error_message}
	except Exception as exc:
		if finalize_log:
			_finish_sync_log(log, "失败", received, 0, received - failed, failed + 1, str(exc))
		raise


def _sync_cancel_requested(sync_log: str) -> bool:
	return frappe.db.get_value(DINGTALK_SYNC_LOG_DOCTYPE, sync_log, "status") in {"取消请求", "已撤销"}


def _get_or_start_attendance_sync_log(sync_log: str, company: str, business_date: date):
	if not sync_log:
		return _new_sync_log("考勤同步", company=company, business_date=business_date)
	log = frappe.get_doc(DINGTALK_SYNC_LOG_DOCTYPE, sync_log)
	if log.company != company or log.sync_type != "考勤同步" or getdate(log.business_date) != business_date:
		frappe.throw(_("同步任务与当前公司或日期不匹配。"))
	if log.status not in {"取消请求", "已撤销"}:
		log.status = "运行中"
		log.started_at = now_datetime()
		log.error_message = ""
		log.save(ignore_permissions=False)
	return log


@frappe.whitelist()
def queue_dingtalk_attendance_sync(work_date: str, company: str = ""):
	"""Queue a one-day pull so closing the browser does not interrupt the import."""
	_require_dingtalk_manager()
	company = _require_api_sync_enabled(company)
	business_date = getdate(work_date)
	log = _new_sync_log("考勤同步", company=company, business_date=business_date)
	log.status = "已排队"
	log.error_message = "已提交后台任务；可在“钉钉同步记录”查看进度或撤销。"
	log.save(ignore_permissions=False)
	frappe.enqueue(
		"hrms.api.dingtalk_integration.run_queued_dingtalk_attendance_sync",
		queue="long",
		timeout=1800,
		enqueue_after_commit=True,
		company=company,
		work_date=str(business_date),
		sync_log=log.name,
	)
	return {"sync_log": log.name, "status": log.status, "business_date": str(business_date)}


def run_queued_dingtalk_attendance_sync(company: str, work_date: str, sync_log: str):
	"""Worker entrypoint: raw evidence first, then replaceable daily drafts."""
	log = frappe.get_doc(DINGTALK_SYNC_LOG_DOCTYPE, sync_log)
	if _sync_cancel_requested(log.name):
		_finish_sync_log(log, "已撤销", error_message="后台任务启动前已取消。")
		return {"sync_log": log.name, "cancelled": True}
	try:
		raw = sync_attendance_from_dingtalk(
			work_date,
			company=company,
			convert_to_draft=False,
			sync_log=log.name,
			finalize_log=False,
		)
		if raw.get("cancelled") or _sync_cancel_requested(log.name):
			_finish_sync_log(log, "已撤销", raw.get("received", 0), error_message="后台同步已取消；没有生成每日考勤草稿。")
			return {"sync_log": log.name, "cancelled": True}
		if raw.get("failed"):
			_finish_sync_log(log, "部分失败", raw.get("received", 0), 0, 0, raw.get("failed", 0), raw.get("error_message", ""))
			return raw
		from hrms.api.dingtalk_attendance_sync import convert_dingtalk_raw_attendance_to_daily_checks

		converted = convert_dingtalk_raw_attendance_to_daily_checks(company, work_date, log.name, enforce_role=False)
		if _sync_cancel_requested(log.name):
			from hrms.api.attendance_import import revoke_attendance_import_batch

			revoke_attendance_import_batch(converted["batch"], reason="人事在同步执行中请求撤销", enforce_role=False)
			_finish_sync_log(log, "已撤销", raw.get("received", 0), error_message="已撤销本次同步生成的每日草稿。")
			return {"sync_log": log.name, "cancelled": True}
		_finish_sync_log(log, "已完成", raw.get("received", 0), converted.get("created", 0), converted.get("updated", 0), raw.get("failed", 0), raw.get("error_message", ""))
		return {**raw, "conversion": converted}
	except Exception as exc:
		_finish_sync_log(log, "失败", error_message=str(exc))
		raise


@frappe.whitelist()
def cancel_dingtalk_attendance_sync(sync_log: str):
	"""Cancel a queued/running task, or withdraw its completed draft batch."""
	_require_dingtalk_manager()
	log = frappe.get_doc(DINGTALK_SYNC_LOG_DOCTYPE, sync_log)
	if log.sync_type != "考勤同步":
		frappe.throw(_("只能撤销考勤同步任务。"))
	if log.status == "已排队":
		_finish_sync_log(log, "已撤销", error_message="人事已在任务启动前撤销。")
		return {"sync_log": log.name, "status": "已撤销", "message": "已取消后台任务。"}
	if log.status in {"运行中", "取消请求"}:
		log.status = "取消请求"
		log.error_message = "人事已请求取消；系统将停止后续草稿生成并保留原始审计记录。"
		log.save(ignore_permissions=False)
		return {"sync_log": log.name, "status": "取消请求", "message": "已请求取消，正在等待当前接口请求结束。"}
	batch_name = frappe.db.get_value(ATTENDANCE_BATCH_DOCTYPE, {"dingtalk_sync_log": log.name}, "name")
	if batch_name:
		from hrms.api.attendance_import import revoke_attendance_import_batch

		result = revoke_attendance_import_batch(batch_name, reason="人事撤销钉钉同步", enforce_role=False)
		return {"sync_log": log.name, "status": "已撤销", "batch": batch_name, **result}
	return {"sync_log": log.name, "status": log.status, "message": "该任务未生成可撤销的考勤草稿。"}


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
		# Accept both the live DingTalk response and a previously normalized value.
		# ``upsert_user_mapping`` intentionally normalizes defensively, so the
		# latter form must retain its UserId instead of being treated as blank.
		"external_id": str(_first(payload, "external_id", "dingtalk_userid", "userid", "userId", "user_id", "id")),
		"dingtalk_userid": str(_first(payload, "dingtalk_userid", "userid", "userId", "user_id", "id")),
		"employee_name": _first(payload, "employee_name", "name", "employeeName", "username"),
		"mobile": _first(payload, "mobile", "phone", "telephone"),
		"employee_code": _first(payload, "employee_code", "job_number", "jobNumber", "employeeNo"),
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


def _month_date_range(attendance_month: str):
	"""Return an inclusive/exclusive date range for a YYYY-MM value."""
	month = str(attendance_month or "").strip()
	if len(month) != 7 or month[4] != "-":
		month = str(getdate(now_datetime()))[:7]
	year, number = (int(value) for value in month.split("-"))
	start = date(year, number, 1)
	end = date(year + 1, 1, 1) if number == 12 else date(year, number + 1, 1)
	return start, end


def _count_dingtalk_mappings(company: str):
	rows = frappe.get_all(
		DINGTALK_USER_MAP_DOCTYPE,
		filters={"company": company},
		fields=["sync_status"],
		limit_page_length=0,
	)
	counts = {"total": len(rows), "matched": 0, "pending": 0, "conflict": 0, "ignored": 0}
	for row in rows:
		status = row.get("sync_status")
		if status == "已同步":
			counts["matched"] += 1
		elif status == "冲突":
			counts["conflict"] += 1
		elif status == "忽略":
			counts["ignored"] += 1
		else:
			counts["pending"] += 1
	return counts


def _raw_record_counts(company: str):
	return {
		source_type: frappe.db.count(DINGTALK_RAW_RECORD_DOCTYPE, {"company": company, "source_type": source_type})
		for source_type in ("department", "user", DINGTALK_ATTENDANCE_SOURCE_TYPE, DINGTALK_APPROVAL_SOURCE_TYPE)
	}


@frappe.whitelist()
def get_dingtalk_attendance_hub_status(company: str = "", attendance_month: str = ""):
	"""A safe operational summary for the attendance workbench, without raw payloads."""
	_require_dingtalk_manager()
	company = _require_sync_company(company)
	start, end = _month_date_range(attendance_month)
	day_checks = frappe.get_all(
		"HRMS Attendance Day Check",
		filters=[
			["company", "=", company],
			["source_kind", "=", "钉钉API同步"],
			["attendance_date", ">=", start],
			["attendance_date", "<", end],
		],
		fields=["name", "import_batch"],
		limit_page_length=0,
	)
	batch_names = sorted({row.import_batch for row in day_checks if row.import_batch})
	exception_count = (
		frappe.db.count("HRMS Attendance Exception", {"import_batch": ["in", batch_names]}) if batch_names else 0
	)
	logs = frappe.get_all(
		DINGTALK_SYNC_LOG_DOCTYPE,
		filters={"company": company},
		fields=[
			"name", "sync_type", "business_date", "status", "started_at", "finished_at",
			"records_received", "records_created", "records_updated", "records_failed", "error_message",
		],
		order_by="modified desc",
		limit_page_length=8,
	)
	settings = _settings_doc()
	return {
		"company": company,
		"attendance_month": str(start)[:7],
		"connection": {
			"configured": bool(settings.get("client_id") and settings.get_password("client_secret", raise_exception=False)),
			"enabled": bool(settings.get("enabled")),
			"api_mode": settings.get("sync_mode") == DINGTALK_API_SYNC_MODE,
			"daily_sync_enabled": bool(settings.get("daily_sync_enabled")),
			"last_department_sync_at": settings.get("last_department_sync_at"),
			"last_user_sync_at": settings.get("last_user_sync_at"),
			"last_attendance_sync_at": settings.get("last_attendance_sync_at"),
			"last_approval_sync_at": settings.get("last_approval_sync_at"),
		},
		"raw_records": _raw_record_counts(company),
		"mappings": _count_dingtalk_mappings(company),
		"attendance": {"daily_drafts": len(day_checks), "exceptions": exception_count},
		"logs": logs,
	}


@frappe.whitelist()
def list_dingtalk_attendance_sync_runs(company: str = "", attendance_month: str = "", work_date: str = "", page_length: int = 50):
	"""List operational sync runs with their replaceable attendance draft batch."""
	_require_dingtalk_manager()
	company = _require_sync_company(company)
	filters = [["company", "=", company], ["sync_type", "=", "考勤同步"]]
	if work_date:
		filters.append(["business_date", "=", getdate(work_date)])
	else:
		start, end = _month_date_range(attendance_month)
		filters.extend([["business_date", ">=", start], ["business_date", "<", end]])
	logs = frappe.get_all(
		DINGTALK_SYNC_LOG_DOCTYPE,
		filters=filters,
		fields=[
			"name", "business_date", "status", "started_at", "finished_at", "records_received",
			"records_created", "records_updated", "records_failed", "error_message",
		],
		order_by="modified desc",
		limit_page_length=max(int(page_length or 50), 1),
	)
	log_names = [row.name for row in logs]
	batches = frappe.get_all(
		ATTENDANCE_BATCH_DOCTYPE,
		filters={"company": company, "dingtalk_sync_log": ["in", log_names or ["__none__"]]},
		fields=["name", "dingtalk_sync_log", "status", "attendance_month", "daily_sheet_rows", "imported_on"],
		limit_page_length=0,
	)
	batch_by_log = {row.dingtalk_sync_log: row for row in batches}
	for row in logs:
		batch = batch_by_log.get(row.name)
		row["batch"] = batch.name if batch else ""
		row["batch_status"] = batch.status if batch else ""
		row["daily_drafts"] = batch.daily_sheet_rows if batch else 0
		row["can_cancel"] = row.status in {"已排队", "运行中", "取消请求"} or bool(batch and batch.status not in {"已撤销", "已生成月度终稿"})
	return logs


@frappe.whitelist()
def sync_dingtalk_directory(company: str = ""):
	"""Sync departments followed by users; mappings remain reviewable drafts."""
	_require_dingtalk_manager()
	company = _require_api_sync_enabled(company)
	departments = sync_departments_from_dingtalk(company=company)
	users = sync_users_from_dingtalk(company=company)
	return {"company": company, "departments": departments, "users": users, "mappings": _count_dingtalk_mappings(company)}


def _event_value(event, *keys):
	return _first(event, *keys) if isinstance(event, dict) else ""


@frappe.whitelist()
def list_dingtalk_clock_records(company: str = "", attendance_month: str = "", work_date: str = "", page_length: int = 200):
	"""Present stored DingTalk attendance evidence as usable clock-record rows.

	The API deliberately returns parsed, minimum-needed fields rather than the raw
	payload; the full payload remains restricted to the raw-record DocType.
	"""
	_require_dingtalk_manager()
	company = _require_sync_company(company)
	filters = [["company", "=", company], ["source_type", "=", DINGTALK_ATTENDANCE_SOURCE_TYPE]]
	if work_date:
		filters.append(["business_date", "=", getdate(work_date)])
	else:
		start, end = _month_date_range(attendance_month)
		filters.extend([["business_date", ">=", start], ["business_date", "<", end]])
	raw_rows = frappe.get_all(
		DINGTALK_RAW_RECORD_DOCTYPE,
		filters=filters,
		fields=["name", "dingtalk_userid", "business_date", "payload_json", "received_at"],
		order_by="business_date desc, modified desc",
		limit_page_length=max(int(page_length or 200), 1),
	)
	mapping_rows = frappe.get_all(
		DINGTALK_USER_MAP_DOCTYPE,
		filters={"company": company},
		fields=["dingtalk_userid", "employee", "employee_code", "employee_name", "department_name", "sync_status"],
		limit_page_length=0,
	)
	mappings = {row.dingtalk_userid: row for row in mapping_rows}
	from hrms.api.dingtalk_attendance_sync import _event_datetime, _is_usable_attendance_event, _nested_items, _payload

	records = []
	for raw in raw_rows:
		# Do not render a successful-but-empty API envelope as a clock record.
		# It is visible in the data-quality summary instead and cannot be used for payroll.
		items = [event for event in _nested_items(_payload(raw.payload_json)) if _is_usable_attendance_event(event)]
		for event in items:
			user_id = str(_event_value(event, "userId", "userid", "user_id") or raw.dingtalk_userid or "")
			mapping = mappings.get(user_id)
			check_time = _event_datetime(_event_value(event, "userCheckTime", "user_check_time", "checkTime", "check_time", "baseCheckTime"))
			records.append(
				{
					"employee_name": mapping.employee_name if mapping else _event_value(event, "name", "employeeName") or "未匹配员工",
					"employee_code": mapping.employee_code if mapping else _event_value(event, "jobNumber", "job_number", "employeeNo"),
					"department": mapping.department_name if mapping else _event_value(event, "departmentName", "deptName"),
					"mapping_status": mapping.sync_status if mapping else "待匹配",
					"attendance_date": str(raw.business_date or ""),
					"check_time": check_time.strftime("%H:%M:%S") if check_time else "",
					"check_type": _event_value(event, "checkType", "check_type", "type"),
					"time_result": _event_value(event, "timeResult", "time_result", "attendanceResult", "attendance_result", "result"),
					"location": _event_value(event, "userAddress", "user_address", "address", "location"),
					"device": _event_value(event, "deviceId", "device_id", "deviceName", "device_name"),
					"source": "钉钉 API",
					"raw_record": raw.name,
				}
			)
	records.sort(key=lambda row: (row["attendance_date"], row["check_time"]), reverse=True)
	return records[: max(int(page_length or 200), 1)]


@frappe.whitelist()
def get_dingtalk_clock_record_summary(company: str = "", attendance_month: str = "", work_date: str = ""):
	"""Explain whether stored API attendance evidence contains usable punch detail."""
	_require_dingtalk_manager()
	company = _require_sync_company(company)
	filters = [["company", "=", company], ["source_type", "=", DINGTALK_ATTENDANCE_SOURCE_TYPE]]
	if work_date:
		filters.append(["business_date", "=", getdate(work_date)])
	else:
		start, end = _month_date_range(attendance_month)
		filters.extend([["business_date", ">=", start], ["business_date", "<", end]])
	rows = frappe.get_all(DINGTALK_RAW_RECORD_DOCTYPE, filters=filters, fields=["name", "payload_json", "business_date"], limit_page_length=0)
	from hrms.api.dingtalk_attendance_sync import _is_usable_attendance_event, _nested_items, _payload

	usable_records = 0
	punch_events = 0
	for row in rows:
		events = [event for event in _nested_items(_payload(row.payload_json)) if _is_usable_attendance_event(event)]
		if events:
			usable_records += 1
			punch_events += len(events)
	return {
		"raw_records": len(rows),
		"usable_records": usable_records,
		"empty_detail_records": len(rows) - usable_records,
		"punch_events": punch_events,
		"usable_for_daily_review": bool(usable_records),
		"message": (
			"已获取可用打卡明细，可生成每日考勤草稿。"
			if usable_records
			else "钉钉接口已响应，但未返回可用上下班打卡明细；系统不会据此生成旷工或缺卡扣款。请检查应用考勤权限、考勤数据可见范围和所选日期。"
		),
	}


@frappe.whitelist()
def list_dingtalk_approval_records(company: str = "", attendance_month: str = "", approval_type: str = "", page_length: int = 200):
	"""Expose approval evidence to detailed attendance tabs once process codes are configured."""
	_require_dingtalk_manager()
	company = _require_sync_company(company)
	start, end = _month_date_range(attendance_month)
	rows = frappe.get_all(
		DINGTALK_RAW_RECORD_DOCTYPE,
		filters=[["company", "=", company], ["source_type", "=", DINGTALK_APPROVAL_SOURCE_TYPE], ["business_date", ">=", start], ["business_date", "<", end]],
		fields=["name", "external_id", "dingtalk_userid", "business_date", "payload_json", "sync_status", "received_at"],
		order_by="business_date desc, modified desc",
		limit_page_length=max(int(page_length or 200), 1),
	)
	mappings = {
		row.dingtalk_userid: row
		for row in frappe.get_all(DINGTALK_USER_MAP_DOCTYPE, filters={"company": company}, fields=["dingtalk_userid", "employee_code", "employee_name", "department_name", "sync_status"], limit_page_length=0)
	}
	configured = {value: key for key, value in _configured_approval_processes().items()}
	records = []
	for row in rows:
		payload = _json_loads(row.payload_json)
		body = payload.get("result") if isinstance(payload, dict) and isinstance(payload.get("result"), dict) else payload
		process_code = _event_value(body, "process_code", "processCode")
		label = configured.get(str(process_code), "未分类审批")
		if approval_type and label != approval_type:
			continue
		mapping = mappings.get(row.dingtalk_userid)
		records.append(
			{
				"employee_name": mapping.employee_name if mapping else "未匹配员工",
				"employee_code": mapping.employee_code if mapping else "",
				"department": mapping.department_name if mapping else "",
				"approval_type": label,
				"business_date": str(row.business_date or ""),
				"approval_status": _event_value(body, "status", "result", "approval_status"),
				"process_code": process_code,
				"approval_no": row.external_id,
				"mapping_status": mapping.sync_status if mapping else "待匹配",
				"raw_record": row.name,
			}
		)
	return records


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
