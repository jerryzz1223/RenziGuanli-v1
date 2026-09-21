import hashlib
import json
import os
import re
import threading
import time as time_module
from datetime import date, datetime, time, timedelta
from urllib.parse import quote, unquote, urlparse

import frappe
from frappe import _
from frappe.utils import get_datetime, getdate, now_datetime


DINGTALK_SETTINGS_DOCTYPE = "HRMS DingTalk Settings"
DINGTALK_RAW_RECORD_DOCTYPE = "HRMS DingTalk Raw Record"
DINGTALK_USER_MAP_DOCTYPE = "HRMS DingTalk User Map"
DINGTALK_SYNC_LOG_DOCTYPE = "HRMS DingTalk Sync Log"
DINGTALK_EMPLOYEE_IMPORT_DOCTYPE = "HRMS DingTalk Employee Import"
ATTENDANCE_BATCH_DOCTYPE = "HRMS Attendance Import Batch"
ATTENDANCE_DAY_CHECK_DOCTYPE = "HRMS Attendance Day Check"
ATTENDANCE_DAILY_CLOSURE_DOCTYPE = "HRMS Attendance Daily Closure"
ATTENDANCE_MONTH_LOCK_DOCTYPE = "HRMS Attendance Month Lock"
DINGTALK_RAW_SNAPSHOT_SOURCE_TYPE = "snapshot"
ATTENDANCE_SYNC_DELAY_DAYS = 2
DINGTALK_API_BASE_URL = "https://api.dingtalk.com"
DINGTALK_OAPI_BASE_URL = "https://oapi.dingtalk.com"
DINGTALK_ACCESS_TOKEN_URL = "https://api.dingtalk.com/v1.0/oauth2/accessToken"
# DingTalk's current enterprise address-book read endpoints are served by the
# OAPI host.  The previous v1.0 paths returned HTTP 404 before a permission
# check could occur, which made a valid application appear misconfigured.
DINGTALK_DEPARTMENT_LIST_PATH = "/topapi/v2/department/listsub"
DINGTALK_DEPARTMENT_USERS_PATH = "/topapi/v2/user/list"
DINGTALK_PREENTRY_LIST_PATH = "/topapi/smartwork/hrm/employee/querypreentry"
DINGTALK_ONJOB_LIST_PATH = "/topapi/smartwork/hrm/employee/queryonjob"
DINGTALK_USER_DETAIL_PATH = "/user/get"
# Smart HR pre-entry IDs are not necessarily address-book user IDs. The roster
# endpoint is the supported read path for fields submitted by the onboarding form.
DINGTALK_PREENTRY_DETAIL_PATH = "/v1.0/hrm/rosters/lists/query"
DINGTALK_DRIVE_SPACES_PATH = "/v1.0/drive/spaces"
DINGTALK_DRIVE_FILE_INFO_PATH = "/v1.0/drive/spaces/{space_id}/files/{file_id}"
DINGTALK_DRIVE_DOWNLOAD_INFO_PATH = "/v1.0/drive/spaces/{space_id}/files/{file_id}/downloadInfos"
DINGTALK_STORAGE_FILE_INFO_PATH = "/v1.0/storage/spaces/{space_id}/dentries/{file_id}/query"
DINGTALK_STORAGE_DOWNLOAD_INFO_PATH = "/v1.0/storage/spaces/{space_id}/dentries/{file_id}/downloadInfos/query"
DINGTALK_EMPLOYEE_ROSTER_SOURCE_TYPE = "employee_roster"
DINGTALK_ATTACHMENT_MATERIAL_MAP = {
	"sys08-forntIDcard": "identity_card_photo",
	"sys08-rearIDcard": "identity_card_photo",
	"sys08-academicCertificate": "education_certificate",
	"sys08-diplomaCertificate": "education_certificate",
	"sys08-personalPhoto": "personal_id_photo",
	"sys08-releaseLetter": "onboarding_record",
}
DINGTALK_EMPLOYEE_FIELD_MAP = {
	"sys00-name": ("employee_name", "first_name"),
	"sys00-jobNumber": ("custom_employee_code",),
	"sys00-dept": ("department",),
	"sys00-position": ("designation",),
	"sys00-mobile": ("cell_number",),
	"sys00-confirmJoinTime": ("date_of_joining",),
	"sys01-employeeType": ("employment_type",),
	"sys01-regularTime": ("final_confirmation_date", "confirmation_date"),
	"sys02-certNo": ("passport_number",),
	"sys02-birthTime": ("date_of_birth",),
	"sys02-sexType": ("gender",),
	"sys02-nationType": ("custom_ethnicity",),
	"sys02-certAddress": ("permanent_address",),
	"sys02-address": ("current_address",),
	"sys03-highestEdu": ("custom_education_level", "education", "educational_qualification"),
	"sys03-graduateSchool": ("custom_graduation_school",),
	"sys03-graduationTime": ("custom_graduation_date",),
	"sys03-major": ("custom_major",),
	"sys04-bankAccountNo": ("bank_ac_no",),
	"sys04-accountBank": ("bank_name",),
	"sys05-contractType": ("custom_contract_type",),
	"sys05-firstContractStartTime": ("contract_start_date", "custom_contract_sign_date"),
	"sys05-firstContractEndTime": ("contract_end_date",),
	"sys05-nowContractStartTime": ("contract_start_date",),
	"sys05-nowContractEndTime": ("contract_end_date",),
	"sys05-contractRenewCount": ("custom_contract_sign_count",),
	"sys06-urgentContactsName": ("person_to_be_contacted",),
	"sys06-urgentContactsRelation": ("relation",),
	"sys06-urgentContactsPhone": ("emergency_phone_number",),
}
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
DINGTALK_PREENTRY_SOURCE_TYPE = "preentry"
DINGTALK_DIRECTORY_SYNC_TYPE = "组织员工同步"
LOCAL_PILOT_MAX_USERS = 5
DINGTALK_LEGACY_DEPLOYMENT_NOTE = (
	"当前方案：管理后台仍在公司人资系统；钉钉只作为员工入口和数据源。"
	"公网小网关只暴露员工本人查询接口，不暴露 Desk 后台、薪资管理、规则配置和批量数据。"
)
DINGTALK_PHASE_ONE_DEPLOYMENT_NOTE = (
	"第一期：服务器主动拉取钉钉考勤与审批，先写入原始记录和考勤草稿，"
	"经过人事确认后才影响月度汇总与薪资。员工端和公网小网关属于后续阶段。"
)

# ``department/listsub`` and ``user/list`` are paginated one-parent-at-a-time
# endpoints.  A full directory can therefore generate hundreds of requests.
# Keep a small process-local guard in addition to the queued job below; this
# prevents a single worker from bursting through DingTalk's shared QPS bucket.
_DINGTALK_REQUEST_RATE_LOCK = threading.Lock()
_DINGTALK_LAST_REQUEST_AT = {}
DINGTALK_DIRECTORY_REQUEST_INTERVAL = 0.12


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


def _require_dingtalk_employee_import_approver():
	"""Allow the dedicated approver role plus the existing HR Manager role."""
	from hrms.access_control import require_hrms_capability

	require_hrms_capability(
		"dingtalk_employee_import_approve",
		legacy_roles=("HR Manager",),
		message=_("当前账户没有“钉钉员工导入审批”权限。"),
	)


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


def _parse_local_pilot_userids(userids_json: str | list | None) -> list[str]:
	"""Accept a small, explicit set of DingTalk user IDs for a manual local pilot."""
	if isinstance(userids_json, str):
		try:
			values = json.loads(userids_json)
		except json.JSONDecodeError:
			values = userids_json.replace("，", ",").replace(",", "\n").splitlines()
	else:
		values = userids_json or []
	if isinstance(values, str):
		values = [values]
	if not isinstance(values, list):
		frappe.throw(_("本地试运行的钉钉 UserId 必须按行填写。"))

	userids = []
	for value in values:
		userid = str(value or "").strip()
		if userid and userid not in userids:
			userids.append(userid)
	if not userids:
		frappe.throw(_("请至少填写 1 名员工的钉钉 UserId。"))
	if len(userids) > LOCAL_PILOT_MAX_USERS:
		frappe.throw(_("本地试运行最多只能同步 {0} 名员工。").format(LOCAL_PILOT_MAX_USERS))
	return userids


def _payload_hash(payload):
	return hashlib.sha256(_json_dumps(payload).encode()).hexdigest()


def _raw_payload_hash(source_type: str, payload) -> str:
	"""Ignore request metadata that cannot change an employee's attendance facts."""
	payload = _json_loads(payload)
	if source_type == DINGTALK_ATTENDANCE_SOURCE_TYPE and isinstance(payload, dict):
		payload = {key: value for key, value in payload.items() if key not in {"request_count", "source_endpoint"}}
	return _payload_hash(payload)


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


def _attendance_sync_cutoff(today_value: date | str | None = None) -> date:
	today_date = getdate(today_value or now_datetime())
	return today_date - timedelta(days=ATTENDANCE_SYNC_DELAY_DAYS)


def _validate_attendance_sync_date(work_date: date | str) -> date:
	business_date = getdate(work_date)
	cutoff = _attendance_sync_cutoff()
	if business_date > cutoff:
		frappe.throw(
			_("考勤日期 {0} 尚未达到同步条件；当前最多只能同步到 {1}（目标日期两日后）。").format(
				business_date, cutoff
			)
		)
	return business_date


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


def _dingtalk_request_interval(path: str) -> float:
	"""Return the minimum gap for DingTalk endpoints with shared QPS limits."""
	if path in {DINGTALK_DEPARTMENT_LIST_PATH, DINGTALK_DEPARTMENT_USERS_PATH}:
		return DINGTALK_DIRECTORY_REQUEST_INTERVAL
	return 0.0


def _wait_for_dingtalk_request(path: str):
	"""Serialize directory requests inside one worker process."""
	interval = _dingtalk_request_interval(path)
	if not interval:
		return
	with _DINGTALK_REQUEST_RATE_LOCK:
		now = time_module.monotonic()
		last = _DINGTALK_LAST_REQUEST_AT.get(path, 0.0)
		wait_for = max(0.0, interval - (now - last))
		if wait_for:
			time_module.sleep(wait_for)
		_DINGTALK_LAST_REQUEST_AT[path] = time_module.monotonic()


def _dingtalk_error_details(payload):
	"""Normalise both OAPI and v1.0 error envelopes without exposing tokens."""
	if not isinstance(payload, dict):
		return "", ""
	code = payload.get("errcode") or payload.get("code") or payload.get("errorCode") or ""
	message = payload.get("errmsg") or payload.get("message") or payload.get("errorMessage") or ""
	return str(code).strip(), str(message).strip()


def _is_dingtalk_rate_limit(code: str, message: str) -> bool:
	text = f"{code} {message}".lower()
	return any(marker in text for marker in ("90002", "qps", "too many", "rate limit", "429"))


def _dingtalk_api_request(method, path, params=None, json_body=None, use_oapi=False, form_body=None, allow_not_found=False):
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

	_wait_for_dingtalk_request(path)
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
		if allow_not_found and response.status_code == 404:
			return None
		# ``requests.raise_for_status`` includes the URL in its exception text.
		# OAPI puts the short-lived access token in the query string, so returning
		# that exception would leak it to Desk and to terminal history.
		error_code = ""
		error_message = ""
		try:
			error_payload = response.json()
			if isinstance(error_payload, dict):
				error_code = str(error_payload.get("code") or error_payload.get("errcode") or "").strip()
				error_message = str(error_payload.get("message") or error_payload.get("errmsg") or "").strip()
		except ValueError:
			pass
		detail = ""
		if error_code or error_message:
			detail = " {0}{1}".format(error_code, (": " + error_message) if error_message else "")
		frappe.throw(_("钉钉接口请求失败（HTTP {0}）。{1}").format(response.status_code, detail))
	data = response.json()
	errcode = data.get("errcode")
	if errcode not in (None, 0):
		frappe.throw(_("钉钉接口返回错误 {0}: {1}").format(errcode, data.get("errmsg") or frappe.as_json(data)))
	return data


def _drive_result_container(payload):
	payload = _json_loads(payload)
	for container in (payload, payload.get("result") or {}, payload.get("data") or {}):
		if isinstance(container, dict):
			return container
	return {}


def _fetch_dingtalk_drive_union_id():
	"""Get an authorized enterprise-admin unionId for storage read APIs."""
	payload = _dingtalk_api_request(
		"POST",
		DINGTALK_DEPARTMENT_USERS_PATH,
		use_oapi=True,
		json_body={"dept_id": 1, "cursor": 0, "size": 100, "order_field": "modify_desc"},
	)
	result = payload.get("result") or payload.get("data") or {}
	users = result if isinstance(result, list) else result.get("list") or result.get("user_list") or []
	if not isinstance(users, list):
		users = []
	for user in users:
		if isinstance(user, dict) and user.get("admin") and user.get("unionid"):
			return str(user["unionid"]).strip()
	for user in users:
		if isinstance(user, dict) and user.get("unionid"):
			return str(user["unionid"]).strip()
	frappe.throw(_("钉钉通讯录未返回可用于钉盘读取的 unionId。"))


def _dingtalk_drive_union_id(spaces=None):
	for space in spaces or []:
		if isinstance(space, dict) and space.get("_operator_union_id"):
			return str(space["_operator_union_id"]).strip()
	return _fetch_dingtalk_drive_union_id()


def _fetch_dingtalk_drive_spaces():
	"""List spaces visible to the internal app for resolving dingpan URIs."""
	spaces = []
	next_token = ""
	union_id = _fetch_dingtalk_drive_union_id()
	while True:
		# DingTalk rejects oversized pages with param.error.maxresults.
		params = {"spaceType": "org", "maxResults": 20}
		if next_token:
			params["nextToken"] = next_token
		params["unionId"] = union_id
		payload = _dingtalk_api_request("GET", DINGTALK_DRIVE_SPACES_PATH, params=params)
		container = _drive_result_container(payload)
		rows = container.get("spaces") or container.get("items") or []
		if not isinstance(rows, list):
			rows = []
		for row in rows:
			if isinstance(row, dict) and row.get("spaceId"):
				row["_operator_union_id"] = union_id
				spaces.append(row)
		new_token = str(container.get("nextToken") or container.get("next_token") or "")
		if not rows or not new_token or new_token == next_token:
			break
		next_token = new_token
	return spaces


def _dingpan_file_id_from_uri(uri):
	"""Extract the file token from the HRM dingpan://<fileId>.<extension> value."""
	uri = str(uri or "").strip()
	if not uri.startswith("dingpan://"):
		return ""
	value = uri[len("dingpan://") :].split("?", 1)[0].split("#", 1)[0]
	value = value.rsplit("/", 1)[-1]
	file_id = value.rsplit(".", 1)[0] if "." in value else value
	return file_id if re.fullmatch(r"[A-Za-z0-9_-]{8,100}", file_id or "") else ""


def _resolve_dingtalk_drive_file(attachment, spaces=None):
	"""Resolve a HRM dingpan URI to a Drive space and file ID."""
	file_id = str(attachment.get("file_id") or "").strip() or _dingpan_file_id_from_uri(attachment.get("download_url"))
	if not file_id:
		return "", "钉钉钉盘 URI 未包含可识别的 fileId"
	space_id = str(attachment.get("space_id") or "").strip()
	if space_id:
		return space_id, file_id
	spaces = spaces if spaces is not None else _fetch_dingtalk_drive_spaces()
	for space in spaces:
		candidate_space_id = str(space.get("spaceId") or "").strip()
		if not candidate_space_id:
			continue
		if file_id.isdigit():
			method = "POST"
			path = DINGTALK_STORAGE_FILE_INFO_PATH.format(
				space_id=quote(candidate_space_id, safe=""),
				file_id=quote(file_id, safe=""),
			)
			json_body = {}
		else:
			method = "GET"
			path = DINGTALK_DRIVE_FILE_INFO_PATH.format(
				space_id=quote(candidate_space_id, safe=""),
				file_id=quote(file_id, safe=""),
			)
			json_body = None
		info = _dingtalk_api_request(
			method,
			path,
			params={"unionId": _dingtalk_drive_union_id(spaces)},
			json_body=json_body,
			allow_not_found=True,
		)
		if info:
			return candidate_space_id, file_id
	return "", "钉钉钉盘空间中未找到该文件，或应用没有文件读取权限"


def _fetch_dingtalk_drive_download_info(attachment, spaces=None):
	space_id, resolve_error = _resolve_dingtalk_drive_file(attachment, spaces=spaces)
	file_id = str(attachment.get("file_id") or "").strip() or _dingpan_file_id_from_uri(attachment.get("download_url"))
	if not space_id or not file_id:
		return None, {}, resolve_error
	if file_id.isdigit():
		method = "POST"
		path = DINGTALK_STORAGE_DOWNLOAD_INFO_PATH.format(
			space_id=quote(space_id, safe=""),
			file_id=quote(file_id, safe=""),
		)
		json_body = {"option": {}}
	else:
		method = "GET"
		path = DINGTALK_DRIVE_DOWNLOAD_INFO_PATH.format(
			space_id=quote(space_id, safe=""),
			file_id=quote(file_id, safe=""),
		)
		json_body = None
	payload = _dingtalk_api_request(
		method,
		path,
		params={"unionId": _dingtalk_drive_union_id(spaces)},
		json_body=json_body,
	)
	container = _drive_result_container(payload)
	download_info = container.get("downloadInfo") or container.get("download_info") or {}
	signature_info = container.get("headerSignatureInfo") or container.get("header_signature_info") or {}
	resource_urls = signature_info.get("internalResourceUrls") or signature_info.get("internal_resource_urls") or signature_info.get("resourceUrls") or signature_info.get("resource_urls") or []
	resource_url = str(download_info.get("resourceUrl") or download_info.get("resource_url") or (resource_urls[0] if resource_urls else "")).strip()
	headers = download_info.get("headers") or signature_info.get("headers") or {}
	if not resource_url or not isinstance(headers, dict):
		return None, {}, "钉钉文件下载接口未返回有效签名地址"
	attachment["file_id"] = file_id
	attachment["space_id"] = space_id
	attachment["download_source"] = "dingtalk_drive_download_info"
	return resource_url, {str(key): str(value) for key, value in headers.items()}, ""


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


def _fetch_dingtalk_preentry_userids(page_size: int = 50):
	"""Read all pending-onboarding user IDs created by DingTalk Smart HR."""
	userids = []
	offset = 0
	while True:
		payload = _dingtalk_api_request(
			"POST",
			DINGTALK_PREENTRY_LIST_PATH,
			use_oapi=True,
			json_body={"offset": offset, "size": min(max(int(page_size or 50), 1), 50)},
		)
		result = payload.get("result") or payload.get("data") or {}
		if isinstance(result, list):
			items = result
			next_cursor = None
		else:
			items = result.get("data_list") or result.get("dataList") or result.get("userids") or []
			next_cursor = result.get("next_cursor", result.get("nextCursor"))
		for userid in items:
			userid = str(userid or "").strip()
			if userid and userid not in userids:
				userids.append(userid)
		if next_cursor in (None, "", offset) or not items:
			break
		offset = next_cursor
	return userids


def _fetch_dingtalk_user_detail(userid: str):
	"""Fetch the fields needed for a safe company-code match."""
	payload = _dingtalk_api_request(
		"GET",
		DINGTALK_USER_DETAIL_PATH,
		use_oapi=True,
		params={"userid": userid},
	)
	result = payload.get("result")
	return result if isinstance(result, dict) else payload


def _roster_field_value(field_data_list, *field_codes):
	"""Return the first text value for one of the requested roster fields."""
	for field in field_data_list or []:
		field_code = _first(field, "field_code", "fieldCode")
		if field_code not in field_codes:
			continue
		values = _first(field, "field_value_list", "fieldValueList") or []
		if not isinstance(values, list) or not values:
			continue
		value = values[0]
		if isinstance(value, dict):
			return _first(value, "value", "label")
		return value
	return ""


def _roster_attachment_items(field):
	"""Extract attachment objects without discarding the original field value."""
	values = _first(field, "field_value_list", "fieldValueList") or []
	if not isinstance(values, list):
		values = [values]
	items = []
	for value in values:
		candidate = value
		if isinstance(candidate, dict):
			candidate = _first(candidate, "value", "file", "attachment", "attachments") or candidate
		if isinstance(candidate, str):
			try:
				candidate = json.loads(candidate)
			except (TypeError, json.JSONDecodeError):
				if candidate.startswith(("http://", "https://", "dingpan://")):
					candidate = [{"url": candidate}]
				else:
					continue
		if isinstance(candidate, dict):
			candidate = [candidate]
		if not isinstance(candidate, list):
			continue
		for item in candidate:
			if not isinstance(item, dict):
				continue
			if _first(item, "file_id", "fileId", "space_id", "spaceId", "download_uri", "downloadUri", "url"):
				items.append(item)
	return items


def _normalise_dingtalk_attachment(field, item, item_index):
	field_code = str(_first(field, "field_code", "fieldCode") or "")
	field_name = str(_first(field, "field_name", "fieldName") or field_code)
	file_type = str(_first(item, "file_type", "fileType", "mime_type", "mimeType") or "").lower()
	download_url = str(_first(item, "download_uri", "downloadUri", "download_url", "downloadUrl", "url", "file_url", "fileUrl") or "")
	file_name = str(_first(item, "file_name", "fileName", "name") or "").strip()
	if not file_name and download_url:
		path_name = unquote(urlparse(download_url).path.rsplit("/", 1)[-1]).strip()
		if path_name:
			file_name = path_name
	file_name = file_name or f"{field_name}-{item_index + 1}"
	material_type = DINGTALK_ATTACHMENT_MATERIAL_MAP.get(field_code, "dingtalk_other_material")
	return {
		"field_code": field_code,
		"field_name": field_name,
		"item_index": item_index,
		"material_type": material_type,
		"file_id": str(_first(item, "file_id", "fileId") or ""),
		"space_id": str(_first(item, "space_id", "spaceId") or ""),
		"file_name": file_name,
		"file_size": _first(item, "file_size", "fileSize") or 0,
		"file_type": file_type,
		"download_url": download_url,
		"is_image": file_type.startswith("image/") or file_type in {"jpg", "jpeg", "png", "webp"} or str(file_name).lower().endswith((".jpg", ".jpeg", ".png", ".webp")) or material_type in {"identity_card_photo", "personal_id_photo"},
	}


def _normalize_dingtalk_roster_user(record, userid: str):
	"""Convert Smart HR roster fields into the common mapping shape."""
	record = _json_loads(record)
	field_data_list = _first(record, "field_data_list", "fieldDataList") or []
	user = normalize_dingtalk_user(
		{
			"userid": _first(record, "user_id", "userId", "userid") or userid,
			"name": _roster_field_value(field_data_list, "sys00-name"),
			"mobile": _roster_field_value(field_data_list, "sys00-mobile"),
			"jobNumber": _roster_field_value(field_data_list, "sys00-jobNumber"),
			"department_name": _roster_field_value(field_data_list, "sys00-dept"),
			"title": _roster_field_value(field_data_list, "sys00-position"),
			"raw": record,
		}
	)
	user["roster_fields"] = {
		str(_first(field, "field_code", "fieldCode") or ""): _roster_field_value(field_data_list, _first(field, "field_code", "fieldCode"))
		for field in field_data_list
		if _first(field, "field_code", "fieldCode")
	}
	user["roster_field_labels"] = {
		str(_first(field, "field_code", "fieldCode") or ""): _first(field, "field_name", "fieldName")
		for field in field_data_list
		if _first(field, "field_code", "fieldCode")
	}
	user["roster_attachments"] = [
		_normalise_dingtalk_attachment(field, item, item_index)
		for field in field_data_list
		for item_index, item in enumerate(_roster_attachment_items(field))
	]
	user["raw"] = record
	return user


def _fetch_dingtalk_preentry_details(userids: list[str]):
	"""Fetch Smart HR fields for pending-onboarding IDs in one read batch."""
	settings = _settings_doc()
	agent_id = str(settings.get("agent_id") or "").strip()
	if not agent_id:
		frappe.throw(_("请先在钉钉连接设置中填写应用 AgentId（智能人事花名册查询必填）。"))
	try:
		agent_value = int(agent_id)
	except (TypeError, ValueError):
		agent_value = agent_id
	rows = []
	for user_chunk in _chunks(userids, 100):
		payload = _dingtalk_api_request(
			"POST",
			DINGTALK_PREENTRY_DETAIL_PATH,
			json_body={
				"userIdList": user_chunk,
				"appAgentId": agent_value,
				"text2SelectConvert": True,
			},
		)
		chunk_rows = payload.get("result") or payload.get("data") or []
		if isinstance(chunk_rows, dict):
			chunk_rows = chunk_rows.get("list") or chunk_rows.get("items") or []
		if isinstance(chunk_rows, list):
			rows.extend(chunk_rows)
	by_userid = {}
	for row in rows if isinstance(rows, list) else []:
		row_userid = str(_first(row, "user_id", "userId", "userid") or "").strip()
		if row_userid:
			by_userid[row_userid] = row
	return {
		userid: _normalize_dingtalk_roster_user(by_userid[userid], userid)
		for userid in userids
		if userid in by_userid
	}


def _fetch_dingtalk_onjob_userids(page_size: int = 50):
	"""Read the complete Smart HR on-job roster for the first full pull."""
	userids = []
	offset = 0
	while True:
		payload = _dingtalk_api_request(
			"POST",
			DINGTALK_ONJOB_LIST_PATH,
			use_oapi=True,
			json_body={"status_list": "2,3,5,-1", "size": min(max(int(page_size or 50), 1), 50), "offset": offset},
		)
		result = payload.get("result") or payload.get("data") or {}
		if isinstance(result, list):
			items, next_cursor = result, None
		else:
			items = result.get("data_list") or result.get("dataList") or result.get("userids") or []
			next_cursor = result.get("next_cursor", result.get("nextCursor"))
		for userid in items:
			userid = str(userid or "").strip()
			if userid and userid not in userids:
				userids.append(userid)
		if next_cursor in (None, "", offset) or not items:
			break
		offset = next_cursor
	return userids


def _normalise_dingtalk_employee_value(fieldname, value, meta_field):
	value = str(value or "").strip()
	if not value:
		return None
	if fieldname == "gender":
		value = {"男": "Male", "男性": "Male", "女": "Female", "女性": "Female"}.get(value, value)
	if fieldname == "custom_ethnicity" and value in {"汉", "汉族"}:
		value = "汉族"
	if fieldname == "custom_work_nature":
		value = {"正式": "在职·正式", "试用": "在职·试用期", "试用期": "在职·试用期"}.get(value, value)
	if meta_field.fieldtype in {"Date", "Datetime"}:
		try:
			return str(getdate(value))
		except Exception:
			return None
	if meta_field.fieldtype == "Int":
		try:
			return int(float(value))
		except (TypeError, ValueError):
			return None
	return value


def _dingtalk_employee_values(user, company):
	"""Map every non-empty Smart HR roster field supported by Employee."""
	meta_fields = {field.fieldname: field for field in frappe.get_meta("Employee").fields if field.fieldname}
	values = {"company": company, "status": "Active"}
	labels = user.get("roster_field_labels") or {}
	for field_code, raw_value in (user.get("roster_fields") or {}).items():
		candidates = DINGTALK_EMPLOYEE_FIELD_MAP.get(field_code, ())
		if not candidates and labels.get(field_code):
			label = str(labels[field_code]).strip()
			candidates = tuple(
				field.fieldname
				for field in meta_fields.values()
				if str(field.label or "").strip() == label
			)
		fieldname = next((candidate for candidate in candidates if candidate in meta_fields), "")
		if not fieldname:
			continue
		value = _normalise_dingtalk_employee_value(fieldname, raw_value, meta_fields[fieldname])
		if value is not None:
			values[fieldname] = value
	if values.get("employee_name") and not values.get("first_name") and "first_name" in meta_fields:
		values["first_name"] = values["employee_name"]
	if values.get("first_name") and not values.get("employee_name") and "employee_name" in meta_fields:
		values["employee_name"] = values["first_name"]
	if "custom_employee_code" in meta_fields:
		values["custom_employee_code"] = str(user.get("employee_code") or "").strip()
	return values


def _dingtalk_employee_match(values, company):
	"""Validate the business-key match before staging or applying an import."""
	employee_code = str(values.get("custom_employee_code") or "").strip()
	if not employee_code:
		return {"status": "待匹配", "reason": "钉钉工号为空", "employee": ""}
	if not values.get("employee_name"):
		return {"status": "待匹配", "reason": "钉钉姓名为空", "employee": ""}
	filters = {"company": company, "custom_employee_code": employee_code}
	match_count = frappe.db.count("Employee", filters)
	if match_count > 1:
		return {"status": "冲突", "reason": "同公司存在重复工号 {0}".format(employee_code), "employee": ""}
	existing = frappe.db.get_value("Employee", filters, "name") if match_count else None
	if not existing and not values.get("date_of_joining"):
		return {"status": "待匹配", "reason": "缺少入职日期，未创建员工档案", "employee": ""}
	return {"status": "待审批", "reason": "", "employee": existing or ""}


def _upsert_dingtalk_employee_values(values, company):
	"""Create or update an Employee after the import approval has passed."""
	match = _dingtalk_employee_match(values, company)
	if match["status"] != "待审批":
		return match
	existing = match["employee"]
	from hrms.api.employee_field_template import _ensure_employee_base_records

	warnings = []
	base_records = {}
	_ensure_employee_base_records(values, base_records, warnings)
	if existing:
		doc = frappe.get_doc("Employee", existing)
		for fieldname, value in values.items():
			if fieldname in {"company", "status"} or value in (None, ""):
				continue
			if fieldname in doc.meta.get_valid_columns():
				doc.set(fieldname, value)
		doc.flags.hrms_dingtalk_sync = True
		doc.save(ignore_permissions=True)
		return {"status": "已更新", "employee": existing}
	doc = frappe.new_doc("Employee")
	doc.flags.hrms_dingtalk_sync = True
	for fieldname, value in values.items():
		if fieldname in doc.meta.get_valid_columns() and value not in (None, ""):
			doc.set(fieldname, value)
	doc.insert(ignore_permissions=True)
	return {"status": "已创建", "employee": doc.name}


def _upsert_dingtalk_employee(user, company):
	"""Compatibility wrapper for approved imports and focused tests."""
	return _upsert_dingtalk_employee_values(_dingtalk_employee_values(user, company), company)


def _stage_dingtalk_employee_import(user, company, sync_log, raw_record):
	"""Store a reviewable snapshot; this function never writes the Employee master."""
	values = _dingtalk_employee_values(user, company)
	match = _dingtalk_employee_match(values, company)
	payload = user.get("raw") or user
	payload_hash = _payload_hash(payload)
	name = frappe.db.exists(
		DINGTALK_EMPLOYEE_IMPORT_DOCTYPE,
		{"company": company, "dingtalk_userid": user.get("dingtalk_userid")},
	)
	doc = frappe.get_doc(DINGTALK_EMPLOYEE_IMPORT_DOCTYPE, name) if name else frappe.new_doc(DINGTALK_EMPLOYEE_IMPORT_DOCTYPE)
	# A previously approved/rejected snapshot is retained when the same payload is
	# pulled again. A changed payload becomes a new reviewable version on the same
	# external record, so the approval decision always applies to visible data.
	if doc.get("payload_hash") == payload_hash and doc.get("import_status") in ("已批准", "已驳回"):
		return doc
	doc.update(
		{
			"company": company,
			"import_status": match["status"],
			"dingtalk_userid": user.get("dingtalk_userid"),
			"source_record": raw_record.name if raw_record else None,
			"sync_log": sync_log.name if sync_log else None,
			"employee_code": values.get("custom_employee_code"),
			"employee_name": values.get("employee_name"),
			"department": values.get("department"),
			"designation": values.get("designation"),
			"date_of_joining": values.get("date_of_joining"),
			"matched_employee": match.get("employee") or None,
			"payload_hash": payload_hash,
			"payload_json": _json_dumps(user),
			"mapped_values_json": _json_dumps(values),
			"field_labels_json": _json_dumps(user.get("roster_field_labels") or {}),
			"attachments_json": _json_dumps(user.get("roster_attachments") or []),
			"attachment_count": len(user.get("roster_attachments") or []),
			"attachment_status": "待下载" if user.get("roster_attachments") else "无附件",
			"error_message": match.get("reason") or None,
			"submitted_at": now_datetime(),
			"approved_by": None,
			"approved_at": None,
			"approval_note": None,
		}
	)
	doc.save(ignore_permissions=False)
	return doc


def _download_dingtalk_attachment(attachment, drive_spaces=None):
	"""Download a direct DingTalk URL or resolve a dingpan URI through Drive."""
	url = str(attachment.get("download_url") or "").strip()
	file_id = str(attachment.get("file_id") or "").strip()
	if not url and not file_id:
		return None, "钉钉花名册只返回 fileId/spaceId，当前 HRM API 未提供文件下载地址"
	headers = {}
	trusted_drive_url = False
	if url.startswith("dingpan://") or (not url and file_id):
		try:
			url, headers, error_message = _fetch_dingtalk_drive_download_info(attachment, spaces=drive_spaces)
		except Exception as exc:
			return None, "钉盘文件下载接口调用失败：{0}：{1}".format(type(exc).__name__, str(exc)[:200])
		if not url:
			return None, error_message
		trusted_drive_url = True

	from urllib.parse import urlparse

	parsed_url = urlparse(url)
	if parsed_url.scheme not in {"http", "https"} or not parsed_url.hostname:
		return None, "钉钉附件下载接口未返回有效 HTTP 地址"
	if not trusted_drive_url:
		host = (parsed_url.hostname or "").lower().rstrip(".")
		if host != "dingtalk.com" and not host.endswith(".dingtalk.com"):
			return None, "钉钉附件下载地址不是受信任的钉钉域名"

	import requests

	try:
		response = requests.get(url, headers=headers or None, timeout=30, allow_redirects=True, stream=True)
		if not trusted_drive_url:
			final_host = (urlparse(response.url).hostname or "").lower().rstrip(".")
			if final_host != "dingtalk.com" and not final_host.endswith(".dingtalk.com"):
				return None, "钉钉附件下载被重定向到非钉钉域名"
		response.raise_for_status()
		content_length = int(response.headers.get("Content-Length") or 0)
		if content_length > 20 * 1024 * 1024:
			return None, "钉钉附件超过 20MB 安全上限"
		content = response.content
		if len(content) > 20 * 1024 * 1024:
			return None, "钉钉附件超过 20MB 安全上限"
		return content, ""
	except requests.RequestException as exc:
		return None, "钉钉附件下载失败：{0}".format(type(exc).__name__)


def _import_dingtalk_attachments(import_doc, employee_name):
	"""Attach downloadable files and keep non-downloadable metadata auditable."""
	attachments = _json_loads(import_doc.get("attachments_json"))
	if not isinstance(attachments, list) or not attachments:
		return {"status": "无附件", "downloaded": 0, "unavailable": 0, "failed": 0, "attachments": []}

	from hrms.api.employee_field_template import _get_employee_material_type_map

	type_map = _get_employee_material_type_map()
	results = []
	downloaded = unavailable = failed = 0
	drive_spaces = None
	drive_error = ""
	if any(str(item.get("download_url") or "").startswith("dingpan://") for item in attachments if isinstance(item, dict)):
		try:
			drive_spaces = _fetch_dingtalk_drive_spaces()
		except Exception as exc:
			drive_error = "钉盘空间读取失败：{0}".format(type(exc).__name__)
	for attachment in attachments:
		attachment = dict(attachment or {})
		material_type = attachment.get("material_type") or "dingtalk_other_material"
		material = type_map.get(material_type) or type_map.get("dingtalk_other_material")
		if not material:
			attachment["sync_status"] = "失败"
			attachment["sync_message"] = "HRMS 未配置该钉钉材料类型"
			failed += 1
			results.append(attachment)
			continue

		if str(attachment.get("download_url") or "").startswith("dingpan://") and drive_error:
			content, error_message = None, drive_error
		else:
			content, error_message = _download_dingtalk_attachment(attachment, drive_spaces=drive_spaces)
		if content is None:
			download_url = str(attachment.get("download_url") or "")
			server_download_available = bool(download_url) and not download_url.startswith("dingpan://")
			file_reference_available = bool(
				str(attachment.get("file_id") or "").strip()
				or _dingpan_file_id_from_uri(download_url)
			)
			attachment["sync_status"] = "下载失败" if server_download_available or file_reference_available else "接口未提供下载"
			attachment["sync_message"] = error_message
			if server_download_available or file_reference_available:
				failed += 1
			else:
				unavailable += 1
			results.append(attachment)
			continue

		file_name = os.path.basename(str(attachment.get("file_name") or "钉钉材料")) or "钉钉材料"
		existing = frappe.db.exists(
			"File",
			{
				"attached_to_doctype": "Employee",
				"attached_to_name": employee_name,
				"attached_to_field": material["fieldname"],
				"file_name": file_name,
			},
		)
		if existing:
			file_doc = frappe.get_doc("File", existing)
		else:
			file_doc = frappe.get_doc(
				{
					"doctype": "File",
					"attached_to_doctype": "Employee",
					"attached_to_name": employee_name,
					"attached_to_field": material["fieldname"],
					"folder": "Home",
					"file_name": file_name,
					"content": content,
					"is_private": 1,
				}
			).insert(ignore_permissions=True)
		attachment["sync_status"] = "已归档"
		attachment["hrms_file_name"] = file_doc.name
		attachment["hrms_file_url"] = file_doc.file_url
		downloaded += 1
		results.append(attachment)

	if downloaded == len(results):
		status = "已下载"
	elif downloaded:
		status = "部分下载"
	elif unavailable and not failed:
		status = "接口未提供下载"
	else:
		status = "下载失败"
	return {"status": status, "downloaded": downloaded, "unavailable": unavailable, "failed": failed, "attachments": results}


@frappe.whitelist()
def verify_dingtalk_employee_attachment_download(import_name: str = "", attachment_index: int = 0):
	"""Read one synced attachment into memory to verify the download chain."""
	_require_dingtalk_manager()
	if import_name:
		import_doc = frappe.get_doc(DINGTALK_EMPLOYEE_IMPORT_DOCTYPE, import_name)
	else:
		candidate = frappe.db.get_value(
			DINGTALK_EMPLOYEE_IMPORT_DOCTYPE,
			{"attachment_count": [">", 0]},
			"name",
			order_by="creation asc",
		)
		if not candidate:
			return {"verified": False, "reason": "没有可验证的员工附件"}
		import_doc = frappe.get_doc(DINGTALK_EMPLOYEE_IMPORT_DOCTYPE, candidate)
	attachments = _json_loads(import_doc.get("attachments_json"))
	if not isinstance(attachments, list) or not attachments:
		return {"verified": False, "reason": "该同步记录没有附件"}
	try:
		index = int(attachment_index or 0)
	except (TypeError, ValueError):
		index = 0
	if index < 0 or index >= len(attachments):
		return {"verified": False, "reason": "附件序号超出范围"}
	attachment = dict(attachments[index] or {})
	drive_spaces = _fetch_dingtalk_drive_spaces() if str(attachment.get("download_url") or "").startswith("dingpan://") else None
	content, error_message = _download_dingtalk_attachment(attachment, drive_spaces=drive_spaces)
	if content is None:
		return {"verified": False, "reason": error_message, "is_image": bool(attachment.get("is_image"))}
	return {
		"verified": True,
		"byte_count": len(content),
		"is_image": bool(attachment.get("is_image")),
		"download_source": attachment.get("download_source") or "direct_url",
	}


def _set_dingtalk_mapping_after_import(import_doc, values, employee_name):
	"""Link a DingTalk user only after the corresponding snapshot is approved."""
	mapping_name = frappe.db.exists(
		DINGTALK_USER_MAP_DOCTYPE,
		{"company": import_doc.company, "dingtalk_userid": import_doc.dingtalk_userid},
	)
	if not mapping_name:
		return
	mapping = frappe.get_doc(DINGTALK_USER_MAP_DOCTYPE, mapping_name)
	mapping.employee = employee_name
	mapping.employee_code = values.get("custom_employee_code") or mapping.employee_code
	mapping.employee_name = values.get("employee_name") or mapping.employee_name
	mapping.department_name = values.get("department") or mapping.department_name
	mapping.sync_status = "已同步"
	mapping.last_synced_at = now_datetime()
	mapping.save(ignore_permissions=True)


def _sync_preentry_employees(company: str = ""):
	company = _require_api_sync_enabled(company)
	log = _new_sync_log("入职同步", company=company)
	userids = _fetch_dingtalk_preentry_userids()
	preentry_details = _fetch_dingtalk_preentry_details(userids)
	received = created = updated = failed = 0
	employees_created = employees_updated = employees_pending = 0
	pending_approval = pending_match = conflicts = 0
	errors = []
	try:
		for userid in userids:
			received += 1
			try:
				user = preentry_details.get(userid)
				if not user:
					frappe.throw(_("钉钉花名册未返回该待入职员工详情。"))
				user["dingtalk_userid"] = userid
				user["external_id"] = userid
				raw_record = upsert_raw_record(
					DINGTALK_PREENTRY_SOURCE_TYPE,
					userid,
					user["raw"],
					log.name,
					company=company,
					dingtalk_userid=userid,
				)
				employee_import = _stage_dingtalk_employee_import(user, company, log, raw_record)
				if employee_import.import_status == "待审批":
					employees_pending += 1
					pending_approval += 1
				elif employee_import.import_status == "待匹配":
					pending_match += 1
				elif employee_import.import_status == "冲突":
					conflicts += 1
				else:
					if len(errors) < 10:
						errors.append("{0}: {1}".format(userid, employee_import.error_message or employee_import.import_status))
				was_existing = bool(frappe.db.exists(DINGTALK_USER_MAP_DOCTYPE, {"company": company, "dingtalk_userid": userid}))
				mapping = upsert_user_mapping(user, company)
				if employee_import.import_status == "待审批":
					mapping.employee = None
					mapping.sync_status = "待审批"
					mapping.save(ignore_permissions=False)
				elif employee_import.import_status in ("待匹配", "冲突"):
					mapping.sync_status = employee_import.import_status
					mapping.save(ignore_permissions=False)
				if was_existing:
					updated += 1
				else:
					created += 1
				if mapping.sync_status == "冲突":
					errors.append("{0}: 工号映射冲突".format(user["employee_name"] or userid))
			except Exception as exc:
				failed += 1
				if len(errors) < 10:
					errors.append("{0}: {1}".format(userid, str(exc)))
		_finish_sync_log(log, "已完成" if not failed else "部分失败", received, created, updated, failed, "\n".join(errors))
		return {
			"sync_log": log.name,
			"received": received,
			"created": created,
			"updated": updated,
			"failed": failed,
			"employees_created": employees_created,
			"employees_updated": employees_updated,
			"employees_pending": employees_pending,
			"pending_approval": pending_approval,
			"pending_match": pending_match,
			"conflicts": conflicts,
			"matched": sum(1 for userid in userids if frappe.db.get_value(DINGTALK_USER_MAP_DOCTYPE, {"company": company, "dingtalk_userid": userid}, "sync_status") == "已同步"),
			"pending": sum(1 for userid in userids if frappe.db.get_value(DINGTALK_USER_MAP_DOCTYPE, {"company": company, "dingtalk_userid": userid}, "sync_status") == "待匹配"),
			"error_message": "\n".join(errors),
		}
	except Exception as exc:
		_finish_sync_log(log, "失败", received, created, updated, failed + 1, str(exc))
		raise


def _stage_roster_user(user, company, log, source_type=DINGTALK_EMPLOYEE_ROSTER_SOURCE_TYPE):
	"""Persist one full-roster snapshot and its review state."""
	userid = str(user.get("dingtalk_userid") or user.get("external_id") or "").strip()
	if not userid:
		frappe.throw(_("钉钉花名册记录缺少 userid。"))
	user["dingtalk_userid"] = userid
	user["external_id"] = userid
	raw_record = upsert_raw_record(source_type, userid, user.get("raw") or user, log.name, company=company, dingtalk_userid=userid)
	import_doc = _stage_dingtalk_employee_import(user, company, log, raw_record)
	mapping = upsert_user_mapping(user, company)
	if import_doc.import_status == "待审批":
		mapping.employee = None
		mapping.sync_status = "待审批"
		mapping.save(ignore_permissions=False)
	elif import_doc.import_status in ("待匹配", "冲突"):
		mapping.sync_status = import_doc.import_status
		mapping.save(ignore_permissions=False)
	return import_doc, mapping


@frappe.whitelist()
def sync_all_employee_rosters_from_dingtalk(company: str = ""):
	"""Pull the first complete employee roster snapshot, including every returned attachment value."""
	_require_dingtalk_manager()
	company = _require_api_sync_enabled(company)
	log = _new_sync_log("员工档案同步", company=company)
	userids = _fetch_dingtalk_onjob_userids()
	preentry_userids = _fetch_dingtalk_preentry_userids()
	for userid in preentry_userids:
		if userid not in userids:
			userids.append(userid)
	details = _fetch_dingtalk_preentry_details(userids)
	received = pending_approval = pending_match = conflicts = failed = attachment_count = 0
	errors = []
	try:
		for userid in userids:
			received += 1
			try:
				user = details.get(userid)
				if not user:
					frappe.throw(_("钉钉花名册未返回该员工详情。"))
				user["dingtalk_userid"] = userid
				user["external_id"] = userid
				import_doc, _mapping = _stage_roster_user(user, company, log)
				attachment_count += len(user.get("roster_attachments") or [])
				if import_doc.import_status == "待审批":
					pending_approval += 1
				elif import_doc.import_status == "待匹配":
					pending_match += 1
				elif import_doc.import_status == "冲突":
					conflicts += 1
			except Exception as exc:
				failed += 1
				if len(errors) < 10:
					errors.append("{0}: {1}".format(userid, str(exc)))
		_settings_doc().db_set("last_user_sync_at", now_datetime())
		_finish_sync_log(log, "已完成" if not failed else "部分失败", received, 0, received - failed, failed, "\n".join(errors))
		return {
			"sync_log": log.name,
			"received": received,
			"failed": failed,
			"employee_count": len(userids),
			"pending_approval": pending_approval,
			"pending_match": pending_match,
			"conflicts": conflicts,
			"attachment_count": attachment_count,
			"error_message": "\n".join(errors),
		}
	except Exception as exc:
		_finish_sync_log(log, "失败", received, 0, max(received - failed, 0), failed + 1, str(exc))
		raise


@frappe.whitelist()
def sync_preentry_employees_from_dingtalk(company: str = ""):
	"""Pull Smart HR QR onboarding submissions into auditable employee mappings."""
	_require_dingtalk_manager()
	return _sync_preentry_employees(company)


@frappe.whitelist()
def sync_new_employees_from_dingtalk(company: str = ""):
	"""Manual employee-roster action: pull and stage Smart HR data for approval."""
	_require_dingtalk_manager()
	return _sync_preentry_employees(company)


@frappe.whitelist()
def list_dingtalk_employee_imports(company: str = "", import_status: str = "", page_length: int = 200):
	"""List visible DingTalk employee snapshots awaiting human review."""
	_require_dingtalk_employee_import_approver()
	company = _require_sync_company(company)
	statuses = [item.strip() for item in str(import_status or "").replace("，", ",").split(",") if item.strip()]
	filters = {"company": company}
	if statuses:
		filters["import_status"] = ["in", statuses]
	else:
		filters["import_status"] = ["in", ["待审批", "待匹配", "冲突"]]
	rows = frappe.get_all(
		DINGTALK_EMPLOYEE_IMPORT_DOCTYPE,
		filters=filters,
		fields=[
			"name", "import_status", "dingtalk_userid", "employee_code", "employee_name",
			"department", "designation", "date_of_joining", "matched_employee",
			"payload_json", "mapped_values_json", "field_labels_json", "attachments_json",
			"attachment_count", "attachment_status", "error_message",
			"submitted_at", "approved_by", "approved_at", "approval_note",
		],
		order_by="submitted_at desc, modified desc",
		limit_page_length=max(int(page_length or 200), 1),
	)
	result = []
	for row in rows:
		result.append(
			{
				**row,
				"mapped_values": _json_loads(row.mapped_values_json),
				"field_labels": _json_loads(row.field_labels_json),
				"attachments": _json_loads(row.attachments_json),
				"payload": _json_loads(row.payload_json),
			}
		)
	return result


@frappe.whitelist()
def approve_dingtalk_employee_import(import_name: str, approval_note: str = ""):
	"""Approve one immutable snapshot, then create/update the Employee master."""
	_require_dingtalk_employee_import_approver()
	if not import_name or not frappe.db.exists(DINGTALK_EMPLOYEE_IMPORT_DOCTYPE, import_name):
		frappe.throw(_("钉钉导入记录不存在。"))
	frappe.db.sql(
		"SELECT name FROM `tabHRMS DingTalk Employee Import` WHERE name=%s FOR UPDATE",
		(import_name,),
	)
	import_doc = frappe.get_doc(DINGTALK_EMPLOYEE_IMPORT_DOCTYPE, import_name)
	if import_doc.import_status != "待审批":
		frappe.throw(_("当前记录状态为“{0}”，不能重复审批。" ).format(import_doc.import_status))
	values = _json_loads(import_doc.mapped_values_json)
	result = _upsert_dingtalk_employee_values(values, import_doc.company)
	if result.get("status") not in ("已创建", "已更新"):
		import_doc.import_status = result.get("status") or "冲突"
		import_doc.error_message = result.get("reason") or "审批前校验未通过"
		import_doc.save(ignore_permissions=True)
		frappe.throw(_("审批前校验未通过：{0}").format(import_doc.error_message))
	attachment_result = _import_dingtalk_attachments(import_doc, result.get("employee"))
	import_doc.update(
		{
			"import_status": "已批准",
			"matched_employee": result.get("employee"),
			"approved_by": frappe.session.user,
			"approved_at": now_datetime(),
			"approval_note": str(approval_note or "").strip() or None,
			"error_message": None,
			"attachments_json": _json_dumps(attachment_result.get("attachments") or []),
			"attachment_status": attachment_result.get("status") or "无附件",
		}
	)
	import_doc.save(ignore_permissions=True)
	_set_dingtalk_mapping_after_import(import_doc, values, result.get("employee"))
	if import_doc.source_record and frappe.db.exists(DINGTALK_RAW_RECORD_DOCTYPE, import_doc.source_record):
		frappe.db.set_value(
			DINGTALK_RAW_RECORD_DOCTYPE,
			import_doc.source_record,
			{"sync_status": "已处理", "processed_at": now_datetime(), "error_message": None},
		)
	return {
		"name": import_doc.name,
		"status": import_doc.import_status,
		"employee": result.get("employee"),
		"operation": result.get("status"),
		"approved_by": import_doc.approved_by,
		"approved_at": import_doc.approved_at,
	}


@frappe.whitelist()
def retry_dingtalk_employee_attachments(import_name: str):
	"""Retry Drive downloads for an already approved employee snapshot."""
	_require_dingtalk_employee_import_approver()
	if not import_name or not frappe.db.exists(DINGTALK_EMPLOYEE_IMPORT_DOCTYPE, import_name):
		frappe.throw(_("钉钉导入记录不存在。"))
	import_doc = frappe.get_doc(DINGTALK_EMPLOYEE_IMPORT_DOCTYPE, import_name)
	if import_doc.import_status != "已批准" or not import_doc.matched_employee:
		frappe.throw(_("只有已批准且已绑定员工的记录才能重试附件下载。"))
	attachment_result = _import_dingtalk_attachments(import_doc, import_doc.matched_employee)
	import_doc.update(
		{
			"attachments_json": _json_dumps(attachment_result.get("attachments") or []),
			"attachment_status": attachment_result.get("status") or "无附件",
		}
	)
	import_doc.save(ignore_permissions=True)
	return {
		"name": import_doc.name,
		"status": import_doc.attachment_status,
		"downloaded": attachment_result.get("downloaded", 0),
		"unavailable": attachment_result.get("unavailable", 0),
		"failed": attachment_result.get("failed", 0),
	}


@frappe.whitelist()
def reject_dingtalk_employee_import(import_name: str, approval_note: str = ""):
	"""Reject one snapshot without modifying the Employee master."""
	_require_dingtalk_employee_import_approver()
	if not import_name or not frappe.db.exists(DINGTALK_EMPLOYEE_IMPORT_DOCTYPE, import_name):
		frappe.throw(_("钉钉导入记录不存在。"))
	import_doc = frappe.get_doc(DINGTALK_EMPLOYEE_IMPORT_DOCTYPE, import_name)
	if import_doc.import_status not in ("待审批", "待匹配", "冲突"):
		frappe.throw(_("当前记录状态为“{0}”，不能驳回。" ).format(import_doc.import_status))
	import_doc.update(
		{
			"import_status": "已驳回",
			"approved_by": frappe.session.user,
			"approved_at": now_datetime(),
			"approval_note": str(approval_note or "").strip() or "审批人驳回",
		}
	)
	import_doc.save(ignore_permissions=True)
	return {"name": import_doc.name, "status": import_doc.import_status, "approved_by": import_doc.approved_by}


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


def _attendance_resync_preview(company: str, business_date: date) -> dict:
	month = business_date.strftime("%Y-%m")
	month_status = frappe.db.get_value(
		ATTENDANCE_MONTH_LOCK_DOCTYPE,
		{"company": company, "attendance_month": month},
		"status",
	) or ""
	closure = frappe.db.get_value(
		ATTENDANCE_DAILY_CLOSURE_DOCTYPE,
		{"company": company, "attendance_date": business_date},
		["name", "status", "validation_status", "correction_version"],
		as_dict=True,
	) if frappe.db.exists("DocType", ATTENDANCE_DAILY_CLOSURE_DOCTYPE) else None
	previous_logs = frappe.get_all(
		DINGTALK_SYNC_LOG_DOCTYPE,
		filters={
			"company": company,
			"sync_type": "考勤同步",
			"business_date": business_date,
			"status": ["in", ["已完成", "部分失败"]],
		},
		fields=["name", "finished_at", "records_received", "records_created", "records_updated"],
		order_by="modified desc",
		limit_page_length=1,
	)
	active_logs = frappe.get_all(
		DINGTALK_SYNC_LOG_DOCTYPE,
		filters={
			"company": company,
			"sync_type": "考勤同步",
			"business_date": business_date,
			"status": ["in", ["已排队", "运行中", "取消请求"]],
		},
		fields=["name", "status"],
		order_by="modified desc",
		limit_page_length=1,
	)
	raw_records = frappe.db.count(
		DINGTALK_RAW_RECORD_DOCTYPE,
		{"company": company, "source_type": DINGTALK_ATTENDANCE_SOURCE_TYPE, "business_date": business_date},
	)
	api_rows = frappe.db.count(
		ATTENDANCE_DAY_CHECK_DOCTYPE,
		{"company": company, "source_kind": "钉钉API同步", "attendance_date": business_date},
	)
	manual_rows = frappe.db.count(
		ATTENDANCE_DAY_CHECK_DOCTYPE,
		{"company": company, "source_kind": "人工调整", "attendance_date": business_date},
	)
	previous = previous_logs[0] if previous_logs else None
	active = active_logs[0] if active_logs else None
	is_resync = bool(raw_records or api_rows or previous)
	blocked_reason = ""
	if month_status == "已锁定":
		blocked_reason = _("{0} 月度考勤已经锁定；请先按月度更正流程重开，不能直接重新同步。").format(month)
	return {
		"company": company,
		"business_date": str(business_date),
		"latest_allowed_date": str(_attendance_sync_cutoff()),
		"is_resync": is_resync,
		"requires_reason": is_resync,
		"raw_records": raw_records,
		"api_rows": api_rows,
		"manual_rows": manual_rows,
		"month_status": month_status or "草稿",
		"daily_closure": dict(closure) if closure else {},
		"daily_locked": bool(closure and closure.status == "已锁定"),
		"previous_sync": dict(previous) if previous else {},
		"active_sync": dict(active) if active else {},
		"blocked": bool(blocked_reason),
		"blocked_reason": blocked_reason,
	}


@frappe.whitelist()
def get_dingtalk_attendance_resync_preview(work_date: str, company: str = ""):
	"""Return the exact lock/manual-impact boundary before a manual pull."""
	_require_dingtalk_manager()
	company = _require_api_sync_enabled(company)
	business_date = _validate_attendance_sync_date(work_date)
	return _attendance_resync_preview(company, business_date)


@frappe.whitelist()
def sync_attendance_from_dingtalk(
	work_date: str,
	userids_json: str | list | None = None,
	limit: int = 0,
	company: str = "",
	convert_to_draft: bool = True,
	sync_log: str = "",
	finalize_log: bool = True,
	resync_reason: str = "",
	allow_locked_day_resync: bool = False,
):
	"""Read one business date into raw storage, then build draft daily checks only."""
	_require_dingtalk_manager()
	company = _require_api_sync_enabled(company)
	business_date = _validate_attendance_sync_date(work_date)
	preview = _attendance_resync_preview(company, business_date)
	if preview["blocked"]:
		frappe.throw(preview["blocked_reason"])
	if preview["is_resync"] and not (resync_reason or "").strip():
		frappe.throw(_("重新同步必须填写原因，以便保留钉钉修改的审计记录。"))
	if preview["daily_locked"] and not _as_bool(allow_locked_day_resync):
		frappe.throw(_("当天日考勤已经锁定；请勾选重开当天并由有审批权限的人员执行。"))
	if preview["daily_locked"] and _as_bool(allow_locked_day_resync):
		from hrms.access_control import require_hrms_capability

		require_hrms_capability("attendance_approve", legacy_roles=("HR Manager",))
	log = _get_or_start_attendance_sync_log(sync_log, company, business_date)
	log.is_resync = int(preview["is_resync"])
	log.resync_reason = (resync_reason or "").strip()
	if preview["previous_sync"] and not log.get("previous_sync_log"):
		log.previous_sync_log = preview["previous_sync"].get("name")
	log.save(ignore_permissions=False)
	if _sync_cancel_requested(log.name):
		if finalize_log:
			_finish_sync_log(log, "已撤销", error_message="同步任务在开始前已取消；未写入考勤草稿。")
		return {"sync_log": log.name, "received": 0, "failed": 0, "work_date": str(business_date), "cancelled": True}
	userids = _userids_for_attendance_sync(userids_json, limit=limit, company=company)
	received = 0
	raw_created = raw_updated = raw_unchanged = 0
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
				raw_doc = upsert_raw_record(
					DINGTALK_ATTENDANCE_SOURCE_TYPE,
					f"{userid}:{business_date}",
					payload,
					log.name,
					company=company,
					business_date=business_date,
					dingtalk_userid=userid,
				)
				if raw_doc.flags.hrms_created:
					raw_created += 1
				elif raw_doc.flags.hrms_payload_changed:
					raw_updated += 1
				else:
					raw_unchanged += 1
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

			conversion = convert_dingtalk_raw_attendance_to_daily_checks(
				company,
				str(business_date),
				log.name,
				enforce_role=False,
				resync_reason=resync_reason,
				allow_locked_day_resync=_as_bool(allow_locked_day_resync),
			)
		error_message = "\n".join(errors)
		if finalize_log:
			_finish_sync_log(
				log,
				"已完成" if not failed else "部分失败",
				received,
				conversion.get("created", 0),
				conversion.get("updated", 0),
				failed,
				error_message,
				unchanged=conversion.get("unchanged", 0),
				manual_conflicts=conversion.get("manual_conflicts", 0),
			)
		return {
			"sync_log": log.name,
			"received": received,
			"failed": failed,
			"work_date": str(business_date),
			"raw_changes": {"created": raw_created, "updated": raw_updated, "unchanged": raw_unchanged},
			"conversion": conversion,
			"error_message": error_message,
		}
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
def queue_dingtalk_attendance_sync(
	work_date: str,
	company: str = "",
	resync_reason: str = "",
	reopen_locked_day: bool = False,
):
	"""Queue a one-day pull so closing the browser does not interrupt the import."""
	_require_dingtalk_manager()
	company = _require_api_sync_enabled(company)
	business_date = _validate_attendance_sync_date(work_date)
	preview = _attendance_resync_preview(company, business_date)
	if preview["blocked"]:
		frappe.throw(preview["blocked_reason"])
	if preview["active_sync"]:
		return {
			"sync_log": preview["active_sync"]["name"],
			"status": preview["active_sync"]["status"],
			"business_date": str(business_date),
			"duplicate": True,
		}
	reason = (resync_reason or "").strip()
	if preview["requires_reason"] and not reason:
		frappe.throw(_("重新同步必须填写原因。"))
	allow_locked_day_resync = preview["daily_locked"] and _as_bool(reopen_locked_day)
	if preview["daily_locked"] and not allow_locked_day_resync:
		frappe.throw(_("当天日考勤已经锁定；请确认重开当天后重新同步。"))
	if allow_locked_day_resync:
		from hrms.access_control import require_hrms_capability

		require_hrms_capability("attendance_approve", legacy_roles=("HR Manager",))
	log = _new_sync_log("考勤同步", company=company, business_date=business_date)
	log.is_resync = int(preview["is_resync"])
	log.resync_reason = reason
	log.previous_sync_log = preview["previous_sync"].get("name") if preview["previous_sync"] else None
	log.status = "已排队"
	log.error_message = "已提交重新同步；完成后将显示数据变化和人工修改冲突。" if preview["is_resync"] else "已提交后台任务；可在“钉钉同步记录”查看进度或撤销。"
	log.save(ignore_permissions=False)
	frappe.enqueue(
		"hrms.api.dingtalk_integration.run_queued_dingtalk_attendance_sync",
		queue="long",
		timeout=1800,
		enqueue_after_commit=True,
		company=company,
		work_date=str(business_date),
		sync_log=log.name,
		resync_reason=reason,
		allow_locked_day_resync=allow_locked_day_resync,
	)
	return {
		"sync_log": log.name,
		"status": log.status,
		"business_date": str(business_date),
		"is_resync": preview["is_resync"],
	}


@frappe.whitelist()
def queue_dingtalk_local_pilot_sync(work_date: str, userids_json: str | list, company: str = ""):
	"""Run one explicit, small DingTalk attendance pull on a local HRMS site.

	This is intentionally separate from the regular queue endpoint: it cannot
	expand to the whole roster, enable a schedule, or coexist with the employee
	public gateway.  It creates auditable raw records and replaceable daily
	drafts, never Employee master data, approved attendance, or payroll rows.
	"""
	_require_dingtalk_manager()
	company = _require_api_sync_enabled(company)
	settings = _settings_doc()
	if settings.get("public_gateway_enabled"):
		frappe.throw(_("本地试运行要求“启用员工端公网小网关”保持关闭。"))
	if settings.get("daily_sync_enabled"):
		frappe.throw(_("本地试运行要求“每日自动同步”保持关闭。"))

	business_date = _validate_attendance_sync_date(work_date)
	userids = _parse_local_pilot_userids(userids_json)
	preview = _attendance_resync_preview(company, business_date)
	if preview["blocked"] or preview["daily_locked"]:
		frappe.throw(preview["blocked_reason"] or _("本地试运行不能重开已锁定日考勤。"))
	log = _new_sync_log("考勤同步", company=company, business_date=business_date)
	log.is_resync = int(preview["is_resync"])
	log.resync_reason = "本地试运行重新拉取" if preview["is_resync"] else ""
	log.previous_sync_log = preview["previous_sync"].get("name") if preview["previous_sync"] else None
	log.status = "已排队"
	log.error_message = "已提交本地试运行：仅 {0} 名指定员工，未启用公网网关或自动同步。".format(len(userids))
	log.save(ignore_permissions=False)
	frappe.enqueue(
		"hrms.api.dingtalk_integration.run_queued_dingtalk_attendance_sync",
		queue="long",
		timeout=1800,
		enqueue_after_commit=True,
		company=company,
		work_date=str(business_date),
		sync_log=log.name,
		userids_json=userids,
		resync_reason=log.resync_reason,
	)
	return {
		"sync_log": log.name,
		"status": log.status,
		"business_date": str(business_date),
		"requested_user_count": len(userids),
	}


def run_queued_dingtalk_attendance_sync(
	company: str,
	work_date: str,
	sync_log: str,
	userids_json: str | list | None = None,
	resync_reason: str = "",
	allow_locked_day_resync: bool = False,
):
	"""Worker entrypoint: raw evidence first, then replaceable daily drafts."""
	log = frappe.get_doc(DINGTALK_SYNC_LOG_DOCTYPE, sync_log)
	if _sync_cancel_requested(log.name):
		_finish_sync_log(log, "已撤销", error_message="后台任务启动前已取消。")
		return {"sync_log": log.name, "cancelled": True}
	try:
		approvals = sync_approvals_from_dingtalk(company, work_date)
		if approvals.get("failed"):
			_finish_sync_log(
				log,
				"部分失败",
				failed=approvals.get("failed", 0),
				error_message="审批数据同步不完整，未生成新的日考勤草稿。",
			)
			return {"sync_log": log.name, "failed": approvals.get("failed", 0), "approvals": approvals}
		raw = sync_attendance_from_dingtalk(
			work_date,
			company=company,
			userids_json=userids_json,
			convert_to_draft=False,
			sync_log=log.name,
			finalize_log=False,
			resync_reason=resync_reason,
			allow_locked_day_resync=allow_locked_day_resync,
		)
		if raw.get("cancelled") or _sync_cancel_requested(log.name):
			_finish_sync_log(log, "已撤销", raw.get("received", 0), error_message="后台同步已取消；没有生成每日考勤草稿。")
			return {"sync_log": log.name, "cancelled": True}
		if raw.get("failed"):
			_finish_sync_log(log, "部分失败", raw.get("received", 0), 0, 0, raw.get("failed", 0), raw.get("error_message", ""))
			return raw
		raw_changes = raw.get("raw_changes") or {}
		source_changed = bool(
			raw_changes.get("created")
			or raw_changes.get("updated")
			or approvals.get("created")
			or approvals.get("updated")
		)
		if _as_bool(log.get("is_resync")) and not source_changed:
			existing_drafts = frappe.db.count(
				ATTENDANCE_DAY_CHECK_DOCTYPE,
				{"company": company, "source_kind": "钉钉API同步", "attendance_date": getdate(work_date)},
			)
			conversion = {
				"created": 0,
				"updated": 0,
				"unchanged": existing_drafts,
				"drafts": existing_drafts,
				"manual_conflicts": 0,
				"change_detected": False,
				"skipped_rebuild": True,
			}
			_finish_sync_log(
				log,
				"已完成",
				raw.get("received", 0),
				0,
				0,
				0,
				"钉钉原始数据与上次同步一致；保留已有草稿、异常处理和闭环状态。",
				unchanged=existing_drafts,
			)
			return {**raw, "approvals": approvals, "conversion": conversion}
		from hrms.api.dingtalk_attendance_sync import convert_dingtalk_raw_attendance_to_daily_checks

		converted = convert_dingtalk_raw_attendance_to_daily_checks(
			company,
			work_date,
			log.name,
			enforce_role=False,
			resync_reason=resync_reason,
			allow_locked_day_resync=_as_bool(allow_locked_day_resync),
		)
		if _sync_cancel_requested(log.name):
			if _as_bool(log.get("is_resync")):
				message = "取消请求到达时重新同步已完成；为避免删除原有日考勤版本，本次结果已保留并进入待复核。"
				_finish_sync_log(
					log,
					"已完成",
					raw.get("received", 0),
					converted.get("created", 0),
					converted.get("updated", 0),
					raw.get("failed", 0),
					message,
					unchanged=converted.get("unchanged", 0),
					manual_conflicts=converted.get("manual_conflicts", 0),
				)
				return {**raw, "approvals": approvals, "conversion": converted, "cancel_too_late": True}
			from hrms.api.attendance_import import revoke_attendance_import_batch

			revoke_attendance_import_batch(converted["batch"], reason="人事在同步执行中请求撤销", enforce_role=False)
			_finish_sync_log(log, "已撤销", raw.get("received", 0), error_message="已撤销本次同步生成的每日草稿。")
			return {"sync_log": log.name, "cancelled": True}
		_finish_sync_log(
			log,
			"已完成",
			raw.get("received", 0),
			converted.get("created", 0),
			converted.get("updated", 0),
			raw.get("failed", 0),
			raw.get("error_message", ""),
			unchanged=converted.get("unchanged", 0),
			manual_conflicts=converted.get("manual_conflicts", 0),
		)
		return {**raw, "approvals": approvals, "conversion": converted}
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
	if _as_bool(log.get("is_resync")):
		return {
			"sync_log": log.name,
			"status": log.status,
			"message": "重新同步已完成，不能通过撤销删除共享日考勤批次；如有问题请重新同步或按闭环流程复核。",
		}
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
	existing_approvals = frappe.get_all(
		DINGTALK_RAW_RECORD_DOCTYPE,
		filters={"company": company, "source_type": DINGTALK_APPROVAL_SOURCE_TYPE, "business_date": day},
		fields=["name", "external_id", "sync_status"],
		limit_page_length=0,
	)
	seen_approval_ids: set[str] = set()
	received = failed = 0
	created = updated = unchanged = 0
	try:
		for label, process_code in processes.items():
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
						seen_approval_ids.add(str(instance_id))
						detail = _dingtalk_api_request(
							"POST", DINGTALK_PROCESS_INSTANCE_DETAIL_PATH, use_oapi=True, json_body={"process_instance_id": str(instance_id)}
						)
						# Retain the configured business label beside the immutable DingTalk
						# response so attendance conversion can distinguish overtime, leave,
						# and missed-card evidence without guessing from a process code.
						if isinstance(detail, dict):
							detail = {**detail, "hrms_approval_type": label}
						raw_doc = upsert_raw_record(
							DINGTALK_APPROVAL_SOURCE_TYPE,
							str(instance_id),
							detail,
							log.name,
							company=company,
							business_date=day,
							dingtalk_userid=_approval_originator_userid(detail),
						)
						if raw_doc.flags.hrms_created:
							created += 1
						elif raw_doc.flags.hrms_payload_changed or raw_doc.flags.hrms_status_changed:
							updated += 1
						else:
							unchanged += 1
						received += 1
					except Exception:
						failed += 1
				next_cursor = _next_cursor(payload)
				if next_cursor in (None, "", cursor):
					break
				cursor = next_cursor
		if not failed:
			for previous in existing_approvals:
				if str(previous.external_id) in seen_approval_ids or previous.sync_status == "已失效":
					continue
				frappe.db.set_value(
					DINGTALK_RAW_RECORD_DOCTYPE,
					previous.name,
					{"sync_status": "已失效", "processed_at": now_datetime()},
				)
				updated += 1
		_settings_doc().db_set("last_approval_sync_at", now_datetime())
		_finish_sync_log(
			log,
			"已完成" if not failed else "部分失败",
			received,
			created,
			updated,
			failed,
			unchanged=unchanged,
		)
		return {"received": received, "created": created, "updated": updated, "unchanged": unchanged, "failed": failed, "log": log.name}
	except Exception as exc:
		_finish_sync_log(log, "失败", received, 0, received - failed, failed + 1, str(exc))
		raise


def run_scheduled_dingtalk_attendance_sync() -> dict:
	"""T+2 sync with a bounded lookback; locked days are reported, not overwritten."""
	settings = _settings_doc()
	if not settings.get("enabled") or settings.get("sync_mode") != DINGTALK_API_SYNC_MODE or not settings.get("daily_sync_enabled"):
		return {"status": "skipped", "reason": "钉钉每日同步未启用"}
	company = _require_sync_company(settings.get("company"))
	lookback_days = max(1, min(int(settings.get("sync_lookback_days") or 7), 31))
	end_day = _attendance_sync_cutoff()
	results = []
	for offset in range(lookback_days - 1, -1, -1):
		business_date = end_day - timedelta(days=offset)
		preview = _attendance_resync_preview(company, business_date)
		if preview["blocked"] or preview["daily_locked"]:
			results.append(
				{
					"business_date": str(business_date),
					"status": "skipped_locked",
					"reason": preview["blocked_reason"] or "当天日考勤已锁定，自动任务不会重开。",
				}
			)
			continue
		try:
			reason = "每日自动复核最近 {0} 天".format(lookback_days) if preview["is_resync"] else ""
			log = _new_sync_log("考勤同步", company=company, business_date=business_date)
			log.is_resync = int(preview["is_resync"])
			log.resync_reason = reason
			log.previous_sync_log = preview["previous_sync"].get("name") if preview["previous_sync"] else None
			log.save(ignore_permissions=False)
			result = run_queued_dingtalk_attendance_sync(
				company,
				str(business_date),
				log.name,
				resync_reason=reason,
			)
			results.append(
				{
					"business_date": str(business_date),
					"status": "failed" if result.get("failed") else "completed",
					"result": result,
				}
			)
		except Exception as exc:
			results.append({"business_date": str(business_date), "status": "failed", "error": str(exc)})
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
		"employee_code": _first(payload, "employee_code", "job_number", "jobNumber", "jobnumber", "employeeNo"),
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
	new_payload_hash = _raw_payload_hash(source_type, payload)
	previous_payload_hash = _raw_payload_hash(source_type, doc.get("payload_json")) if name and doc.get("payload_json") else ""
	previous_sync_status = str(doc.get("sync_status") or "") if name else ""
	payload_changed = bool(name and previous_payload_hash and previous_payload_hash != new_payload_hash)
	status_changed = bool(name and previous_sync_status != sync_status)
	if payload_changed:
		external_key = hashlib.sha256(external_id.encode()).hexdigest()[:24]
		snapshot_external_id = "snapshot:{0}:{1}:{2}".format(source_type, external_key, previous_payload_hash[:40])
		if not frappe.db.exists(
			DINGTALK_RAW_RECORD_DOCTYPE,
			{"company": company, "source_type": DINGTALK_RAW_SNAPSHOT_SOURCE_TYPE, "external_id": snapshot_external_id},
		):
			snapshot = frappe.new_doc(DINGTALK_RAW_RECORD_DOCTYPE)
			snapshot.update(
				{
					"company": company,
					"source_type": DINGTALK_RAW_SNAPSHOT_SOURCE_TYPE,
					"external_id": snapshot_external_id,
					"dingtalk_userid": doc.get("dingtalk_userid"),
					"business_date": doc.get("business_date"),
					"sync_batch": doc.get("sync_batch"),
					"payload_json": doc.get("payload_json"),
					"payload_hash": previous_payload_hash,
					"sync_status": "已处理",
					"received_at": doc.get("received_at"),
					"processed_at": now_datetime(),
					"error_message": _("重新同步前的 {0} 原始数据快照").format(source_type),
				}
			)
			snapshot.insert(ignore_permissions=False)
	doc.update(
		{
			"company": company,
			"source_type": source_type,
			"external_id": external_id,
			"dingtalk_userid": dingtalk_userid or _attendance_payload_userid(payload),
			"business_date": getdate(business_date) if business_date else None,
			"sync_batch": sync_batch,
			"payload_json": _json_dumps(payload),
			"payload_hash": new_payload_hash,
			"sync_status": sync_status,
			"received_at": now_datetime(),
		}
	)
	doc.save(ignore_permissions=False)
	doc.flags.hrms_created = not bool(name)
	doc.flags.hrms_payload_changed = payload_changed
	doc.flags.hrms_status_changed = status_changed
	doc.flags.hrms_previous_payload_hash = previous_payload_hash
	return doc


def upsert_user_mapping(user: dict, company: str = ""):
	user = normalize_dingtalk_user(user)
	company = _require_sync_company(company)
	if not user["dingtalk_userid"]:
		frappe.throw(_("钉钉用户缺少 userid，无法建立映射"))
	name = frappe.db.exists(DINGTALK_USER_MAP_DOCTYPE, {"company": company, "dingtalk_userid": user["dingtalk_userid"]})
	doc = frappe.get_doc(DINGTALK_USER_MAP_DOCTYPE, name) if name else frappe.new_doc(DINGTALK_USER_MAP_DOCTYPE)
	previous_employee = doc.get("employee")
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
		employee = frappe.db.get_value(
			"Employee",
			{"custom_employee_code": user["employee_code"], "company": company},
			"name",
		)
		if employee and previous_employee and previous_employee != employee:
			doc.sync_status = "冲突"
		elif employee:
			doc.employee = employee
			doc.sync_status = "已同步"
		elif previous_employee:
			doc.sync_status = "冲突"
	elif previous_employee and frappe.db.get_value("Employee", previous_employee, "company") == company:
		doc.sync_status = "已同步"
	elif previous_employee:
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


def _finish_sync_log(
	doc,
	status,
	received=0,
	created=0,
	updated=0,
	failed=0,
	error_message="",
	unchanged=0,
	manual_conflicts=0,
):
	# A queued attendance pull updates this same log while it stores raw evidence.
	# Refresh first so the final status does not overwrite a newer modification
	# timestamp with a stale in-memory document.
	doc.reload()
	doc.update(
		{
			"status": status,
			"finished_at": now_datetime(),
			"records_received": received,
			"records_created": created,
			"records_updated": updated,
			"records_unchanged": unchanged,
			"manual_conflicts": manual_conflicts,
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
		for source_type in ("department", "user", DINGTALK_PREENTRY_SOURCE_TYPE, DINGTALK_EMPLOYEE_ROSTER_SOURCE_TYPE, DINGTALK_ATTENDANCE_SOURCE_TYPE, DINGTALK_APPROVAL_SOURCE_TYPE)
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
			"records_created", "records_updated", "records_unchanged", "manual_conflicts",
			"records_failed", "is_resync", "resync_reason", "previous_sync_log", "error_message",
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
		row["can_cancel"] = row.status in {"已排队", "运行中", "取消请求"} or bool(
			batch and not row.is_resync and batch.status not in {"已撤销", "已生成月度终稿"}
		)
	return logs


@frappe.whitelist()
def queue_dingtalk_directory_sync(company: str = ""):
	"""Queue the full directory pull so a large tree does not time out the browser."""
	_require_dingtalk_manager()
	company = _require_api_sync_enabled(company)
	active = frappe.get_all(
		DINGTALK_SYNC_LOG_DOCTYPE,
		filters={
			"company": company,
			"sync_type": DINGTALK_DIRECTORY_SYNC_TYPE,
			"status": ["in", ["已排队", "运行中"]],
		},
		fields=["name", "status"],
		order_by="modified desc",
		limit_page_length=1,
	)
	if active:
		return {"company": company, "sync_log": active[0].name, "status": active[0].status, "duplicate": True}
	log = _new_sync_log(DINGTALK_DIRECTORY_SYNC_TYPE, company=company)
	log.status = "已排队"
	log.save(ignore_permissions=False)
	frappe.enqueue(
		"hrms.api.dingtalk_integration.run_queued_dingtalk_directory_sync",
		queue="long",
		timeout=3600,
		enqueue_after_commit=True,
		company=company,
		sync_log=log.name,
	)
	return {"company": company, "sync_log": log.name, "status": log.status, "duplicate": False}


def run_queued_dingtalk_directory_sync(company: str, sync_log: str):
	"""Run the two-stage directory pull in a worker and retain partial evidence."""
	log = frappe.get_doc(DINGTALK_SYNC_LOG_DOCTYPE, sync_log)
	try:
		log.status = "运行中"
		log.save(ignore_permissions=False)
		frappe.db.commit()
		departments = sync_departments_from_dingtalk(company=company)
		if departments.get("failed"):
			message = departments.get("error_message") or "组织同步部分失败；已停止员工同步。"
			_finish_sync_log(
				log,
				"部分失败",
				received=departments.get("received", 0),
				failed=departments.get("failed", 0),
				error_message=message,
			)
			frappe.db.commit()
			return {"sync_log": log.name, "status": "部分失败", "departments": departments, "users": {}}
		users = sync_users_from_dingtalk(company=company)
		failed = int(departments.get("failed", 0)) + int(users.get("failed", 0))
		message = "\n".join(filter(None, [departments.get("error_message", ""), users.get("error_message", "")]))
		_finish_sync_log(
			log,
			"已完成" if not failed else "部分失败",
			received=int(departments.get("received", 0)) + int(users.get("received", 0)),
			created=max(int(users.get("received", 0)) - int(users.get("failed", 0)), 0),
			failed=failed,
			error_message=message,
		)
		frappe.db.commit()
		return {"sync_log": log.name, "status": log.status, "departments": departments, "users": users}
	except Exception as exc:
		_finish_sync_log(log, "失败", failed=1, error_message=str(exc))
		frappe.db.commit()
		return {"sync_log": log.name, "status": "失败", "error_message": str(exc)}


@frappe.whitelist()
def get_dingtalk_directory_sync_status(sync_log: str, company: str = ""):
	"""Return the queued directory task state without exposing credentials."""
	_require_dingtalk_manager()
	company = _require_sync_company(company)
	log = frappe.get_doc(DINGTALK_SYNC_LOG_DOCTYPE, sync_log)
	if log.company != company or log.sync_type != DINGTALK_DIRECTORY_SYNC_TYPE:
		frappe.throw(_("目录同步任务与当前公司不匹配。"))
	return {
		"sync_log": log.name,
		"company": company,
		"status": log.status,
		"records_received": log.records_received or 0,
		"records_created": log.records_created or 0,
		"records_failed": log.records_failed or 0,
		"error_message": log.error_message or "",
		"finished_at": log.finished_at,
	}


@frappe.whitelist()
def sync_dingtalk_directory(company: str = ""):
	"""Compatibility entrypoint: full directory pulls now run asynchronously."""
	return queue_dingtalk_directory_sync(company)


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
	updates = {}
	# ``1`` is the legacy placeholder created by earlier local tests.  The
	# approved first production scope is 永新, so never leave the integration on
	# that empty shell company after a migration.
	if settings.get("company") in (None, "", "1"):
		updates["company"] = default_company
	if not settings.get("sync_lookback_days"):
		updates["sync_lookback_days"] = 7
	if settings.get("server_deployment_note") in (None, "", DINGTALK_LEGACY_DEPLOYMENT_NOTE):
		updates["server_deployment_note"] = DINGTALK_PHASE_ONE_DEPLOYMENT_NOTE
	# This compatibility backfill must not validate or silently alter connection
	# enablement. A partially configured API integration should remain visible for
	# HR to repair, while unrelated schema migrations are still allowed to finish.
	for fieldname, value in updates.items():
		frappe.db.set_single_value(DINGTALK_SETTINGS_DOCTYPE, fieldname, value)
	for doctype in (DINGTALK_RAW_RECORD_DOCTYPE, DINGTALK_USER_MAP_DOCTYPE, DINGTALK_SYNC_LOG_DOCTYPE):
		frappe.db.sql(f"UPDATE `tab{doctype}` SET company = %s WHERE IFNULL(company, '') = ''", default_company)
