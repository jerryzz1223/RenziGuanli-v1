import frappe
from frappe import _
from frappe.utils import cint

from hrms.api.dingtalk_integration import (
	DINGTALK_USER_MAP_DOCTYPE,
	get_dingtalk_access_token_value,
	get_dingtalk_default_settings,
)


DINGTALK_USERINFO_BY_CODE_URL = "https://oapi.dingtalk.com/topapi/v2/user/getuserinfo"


def _settings():
	return frappe.get_single("HRMS DingTalk Settings")


def _gateway_enabled():
	settings = _settings()
	return cint(settings.get("enabled")) and cint(settings.get("public_gateway_enabled"))


def _allowed_scopes():
	settings = _settings()
	raw = settings.get("employee_gateway_scopes") or "profile\nattendance"
	return {scope.strip() for scope in raw.replace(",", "\n").splitlines() if scope.strip()}


@frappe.whitelist(allow_guest=True)
def get_employee_gateway_config():
	"""Public, non-secret configuration for the DingTalk employee entry page."""
	settings = _settings()
	defaults = get_dingtalk_default_settings()
	return {
		"enabled": bool(_gateway_enabled()),
		"app_id": settings.get("app_id") or defaults["app_id"],
		"corp_id": settings.get("corp_id") or defaults["corp_id"],
		"agent_id": settings.get("agent_id") or defaults["agent_id"],
		"scopes": sorted(_allowed_scopes()),
		"auth": "dingtalk_auth_code_required",
	}


def _exchange_auth_code_for_userid(auth_code):
	if not auth_code:
		frappe.throw(_("缺少钉钉免登录 auth_code"))

	import requests

	access_token = get_dingtalk_access_token_value()
	response = requests.post(
		f"{DINGTALK_USERINFO_BY_CODE_URL}?access_token={access_token}",
		json={"code": auth_code},
		timeout=20,
	)
	response.raise_for_status()
	data = response.json()
	if data.get("errcode") not in (0, None):
		frappe.throw(_("钉钉免登录校验失败：{0}").format(data.get("errmsg") or frappe.as_json(data)))

	result = data.get("result") or data
	userid = result.get("userid") or result.get("userId") or result.get("user_id")
	if not userid:
		frappe.throw(_("钉钉未返回 userid，无法识别员工身份"))
	return userid


def _employee_from_dingtalk_userid(dingtalk_userid):
	company = _settings().get("company")
	if not company:
		frappe.throw(_("钉钉同步公司尚未配置"))
	map_name = frappe.db.exists(DINGTALK_USER_MAP_DOCTYPE, {"company": company, "dingtalk_userid": dingtalk_userid})
	if not map_name:
		frappe.throw(_("当前钉钉账号尚未同步到人资系统，请先执行员工同步"))

	mapping = frappe.get_doc(DINGTALK_USER_MAP_DOCTYPE, map_name)
	if mapping.get("employee"):
		if frappe.db.get_value("Employee", mapping.employee, "company") != company:
			frappe.throw(_("当前钉钉账号的员工映射与同步公司不一致"))
		return mapping.employee

	if mapping.get("employee_code"):
		employee = frappe.db.get_value("Employee", {"custom_employee_code": mapping.employee_code, "company": company}, "name")
		if employee:
			return employee

	frappe.throw(_("当前钉钉账号尚未绑定到员工档案"))


def _employee_profile(employee):
	fields = ["name", "employee_name", "department", "designation", "status", "date_of_joining", "company"]
	profile = frappe.db.get_value("Employee", employee, fields, as_dict=True) or {}
	return {
		"employee": profile.get("name"),
		"employee_name": profile.get("employee_name"),
		"department": profile.get("department"),
		"designation": profile.get("designation"),
		"status": profile.get("status"),
		"date_of_joining": profile.get("date_of_joining"),
		"company": profile.get("company"),
	}


def _monthly_attendance(employee):
	if not frappe.db.exists("DocType", "HRMS Monthly Attendance Summary"):
		return None
	rows = frappe.get_all(
		"HRMS Monthly Attendance Summary",
		filters={"employee": employee},
		fields=[
			"attendance_month",
			"standard_hours",
			"actual_attendance_hours",
			"leave_hours",
			"absent_hours",
			"overtime_1_5_hours",
			"overtime_2_hours",
			"overtime_3_hours",
			"full_attendance_deduction",
			"green_apples",
			"red_apples",
			"status",
		],
		order_by="attendance_month desc, modified desc",
		limit=1,
	)
	return rows[0] if rows else None


def _recent_attendance_days(employee):
	if not frappe.db.exists("DocType", "HRMS Attendance Day Check"):
		return []
	return frappe.get_all(
		"HRMS Attendance Day Check",
		filters={"employee": employee},
		fields=[
			"attendance_date",
			"shift_name",
			"actual_in_time",
			"actual_out_time",
			"attendance_result",
			"missing_in",
			"missing_out",
			"late_count",
			"early_count",
		],
		order_by="attendance_date desc, modified desc",
		limit=7,
	)


def _payroll_status(employee):
	"""Expose payroll status only; do not expose payroll amounts through the first public gateway."""
	if not frappe.db.exists("DocType", "HRMS Payroll Settlement Record"):
		return None
	rows = frappe.get_all(
		"HRMS Payroll Settlement Record",
		filters={"employee": employee},
		fields=["payroll_month", "calculation_status"],
		order_by="payroll_month desc, modified desc",
		limit=1,
	)
	return rows[0] if rows else None


@frappe.whitelist(allow_guest=True)
def get_employee_self_snapshot(auth_code: str):
	"""Return only the current DingTalk user's own HR snapshot.

	This is the public employee gateway surface. It intentionally does not accept
	employee IDs, department IDs, report filters, or payroll amount switches.
	"""
	if not _gateway_enabled():
		frappe.throw(_("员工端公网小网关未启用"))

	dingtalk_userid = _exchange_auth_code_for_userid(auth_code)
	employee = _employee_from_dingtalk_userid(dingtalk_userid)
	scopes = _allowed_scopes()

	result = {"employee": _employee_profile(employee)}
	if "attendance" in scopes:
		result["attendance"] = {
			"monthly": _monthly_attendance(employee),
			"recent_days": _recent_attendance_days(employee),
		}
	if "payroll_status" in scopes:
		result["payroll_status"] = _payroll_status(employee)
	return result
