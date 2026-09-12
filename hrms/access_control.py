"""Business-facing account registration and capability assignment.

The UI intentionally assigns real Frappe roles.  Existing DocPerm, workflow
and explicit backend role checks therefore remain the source of truth.
"""

import json
import re

import frappe
from frappe import _
from frappe.permissions import add_permission
from frappe.rate_limiter import rate_limit
from frappe.utils import validate_email_address
from frappe.utils.password import update_password


READ_ONLY_ROLE = "HRMS 基础只读"
EMPLOYEE_SELF_SERVICE_ROLE = "Employee Self Service"

# Publicly self-registered accounts must not receive employee, attendance or
# payroll data.  These dictionaries are enough to enter Desk and understand
# the organisation; an administrator must explicitly grant every wider role.
READ_ONLY_DOCTYPES = (
	"Company",
	"Department",
	"Designation",
	"Employment Type",
	"Branch",
	"Holiday List",
	"Shift Type",
	"Training Program",
	"Job Opening",
)

CAPABILITY_DEFINITIONS = (
	{
		"key": "basic_read_only",
		"label": "基础只读",
		"role": READ_ONLY_ROLE,
		"category": "基础权限",
		"description": "只读公司、部门、岗位、假日和公开招聘等非敏感基础资料；无新建、修改、提交或审批权限。",
		"risk": "low",
	},
	{
		"key": "payroll_entry_submit",
		"label": "薪资录入与提交",
		"role": "薪资经办",
		"category": "薪资",
		"description": "录入或申请修改薪资、社保公积金数据；不包含最终审批。",
		"risk": "high",
	},
	{
		"key": "payroll_approval",
		"label": "薪资审批",
		"role": "薪资审批",
		"category": "薪资",
		"description": "审批薪资和社保公积金的新增或修改申请，与薪资经办分离。",
		"risk": "critical",
	},
	{
		"key": "permission_management",
		"label": "账户与权限管理",
		"role": "System Manager",
		"category": "系统",
		"description": "创建账户、勾选角色、设置数据范围及系统配置；属于最高风险业务权限。",
		"risk": "critical",
	},
)


def _require_system_manager():
	if frappe.session.user != "Administrator" and "System Manager" not in frappe.get_roles(frappe.session.user):
		frappe.throw(_("仅系统管理员可修改账户权限。"), frappe.PermissionError)


def ensure_hrms_access_roles():
	"""Create the baseline role and its deliberately narrow read permissions."""
	if not frappe.db.exists("Role", READ_ONLY_ROLE):
		frappe.get_doc(
			{"doctype": "Role", "role_name": READ_ONLY_ROLE, "desk_access": 1, "is_custom": 1}
		).insert(ignore_permissions=True)
	for doctype in READ_ONLY_DOCTYPES:
		if frappe.db.exists("DocType", doctype):
			add_permission(doctype, READ_ONLY_ROLE, ptype="read")
	frappe.clear_cache()


def _normalise_capability_keys(capabilities):
	if isinstance(capabilities, str):
		try:
			capabilities = json.loads(capabilities)
		except ValueError:
			capabilities = [capabilities]
	return {str(item) for item in (capabilities or [])}


@frappe.whitelist()
def get_hrms_capability_catalog():
	_require_system_manager()
	return {
		"capabilities": CAPABILITY_DEFINITIONS,
		"managed_roles": [item["role"] for item in CAPABILITY_DEFINITIONS],
		"design_notes": [
			"公开注册只授予非敏感基础资料的只读权限。",
			"当前清单只展示已完成并验证的基础只读、薪资经办、薪资审批和权限管理。",
			"请假审批、费用审批、招聘面试和通用人事角色暂不作为可勾选能力，待对应业务链路验收后再开放。",
			"角色决定可执行的操作；User Permission 继续限定公司、部门或员工数据范围。",
			"导入、导出、打印、分享等细粒度权限仍由角色权限管理器按单据类型设置。",
		],
	}


@frappe.whitelist()
def set_hrms_user_capabilities(user: str, capabilities=None):
	"""Replace only the roles managed by this business-facing checklist."""
	_require_system_manager()
	if not user or not frappe.db.exists("User", user):
		frappe.throw(_("账户不存在。"))
	if user == "Administrator":
		frappe.throw(_("不能通过业务权限勾选修改 Administrator。"))

	selected = _normalise_capability_keys(capabilities)
	definitions = {item["key"]: item for item in CAPABILITY_DEFINITIONS}
	unknown = selected - set(definitions)
	if unknown:
		frappe.throw(_("包含未知的业务权限：{0}").format("、".join(sorted(unknown))))

	target = frappe.get_doc("User", user)
	managed_roles = {item["role"] for item in CAPABILITY_DEFINITIONS}
	if user == frappe.session.user and "System Manager" in {row.role for row in target.roles} and "permission_management" not in selected:
		frappe.throw(_("不能在当前登录会话中移除自己的权限管理能力。"))
	preserved_roles = [row.role for row in target.roles if row.role not in managed_roles]
	desired_roles = preserved_roles + [
		item["role"] for item in CAPABILITY_DEFINITIONS if item["key"] in selected
	]
	target.set("roles", [])
	for role in dict.fromkeys(desired_roles):
		target.append("roles", {"role": role})
	if selected:
		target.user_type = "System User"
	target.save(ignore_permissions=True)
	frappe.clear_cache(user=user)
	return {
		"user": user,
		"capabilities": sorted(selected),
		"roles": [row.role for row in target.roles],
	}


@frappe.whitelist()
def delete_hrms_user_account(user: str, confirmation: str):
	"""Delete one account after an exact typed confirmation.

	Frappe's normal link checks remain enabled.  Accounts referenced by business
	records therefore cannot be silently removed and should be disabled instead.
	"""
	_require_system_manager()
	user = str(user or "").strip()
	confirmation = str(confirmation or "").strip()
	if not user or not frappe.db.exists("User", user):
		frappe.throw(_("账户不存在或已被删除。"))
	if user in {"Administrator", "Guest"}:
		frappe.throw(_("系统内置账户不能删除。"), frappe.PermissionError)
	if user == frappe.session.user:
		frappe.throw(_("不能删除当前正在登录的账户。"), frappe.PermissionError)
	if confirmation != user:
		frappe.throw(_("删除确认与账户不一致，请输入完整账户：{0}").format(user))

	frappe.delete_doc("User", user, ignore_permissions=True)
	frappe.clear_cache(user=user)
	return {"user": user, "deleted": 1, "message": _("账户已删除。")}


def _validate_registration_password(password):
	password = str(password or "")
	if len(password) < 10 or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
		frappe.throw(_("密码至少 10 位，且必须同时包含字母和数字。"))
	return password


def _registration_employee(employee_code):
	"""Resolve one current roster row without exposing its private fields."""
	employee_code = str(employee_code or "").strip()
	if not employee_code:
		return None
	employee = frappe.db.get_value(
		"Employee",
		{"custom_employee_code": employee_code, "status": ["!=", "Left"]},
		["name", "employee_name", "custom_employee_code", "company", "department", "designation", "user_id"],
		as_dict=True,
	)
	if not employee:
		frappe.throw(_("未在当前花名册中找到工号 {0}，请核对后重试。").format(employee_code))
	if employee.get("user_id"):
		frappe.throw(_("该工号已绑定账号，请直接登录或联系管理员处理。"))
	return employee


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=20, seconds=3600)
def preview_registration_employee(employee_code: str):
	"""Return only a non-sensitive summary; the full profile stays login-only."""
	employee = _registration_employee(employee_code)
	if not employee:
		return {"matched": False}
	return {
		"matched": True,
		"employee_name": employee.get("employee_name"),
		"employee_code": employee.get("custom_employee_code"),
		"company": employee.get("company"),
		"department": employee.get("department"),
		"designation": employee.get("designation"),
	}


@frappe.whitelist(allow_guest=True)
@rate_limit(limit=5, seconds=3600)
def register_read_only_account(email: str, full_name: str, password: str, employee_code: str = ""):
	"""Create a baseline account and optionally bind it to one roster profile."""
	email = (validate_email_address(str(email or "").strip(), throw=True) or "").lower()
	full_name = " ".join(str(full_name or "").split())
	password = _validate_registration_password(password)
	employee = _registration_employee(employee_code)
	if employee:
		full_name = " ".join(str(employee.get("employee_name") or "").split())
	if not full_name or len(full_name) > 140:
		frappe.throw(_("未填工号时，请输入 1–140 个字符的姓名。"))
	if not frappe.db.exists("Role", READ_ONLY_ROLE):
		frappe.throw(_("只读角色尚未初始化，请联系系统管理员执行部署迁移。"))
	if employee and not frappe.db.exists("Role", EMPLOYEE_SELF_SERVICE_ROLE):
		frappe.throw(_("员工自助角色尚未初始化，请联系系统管理员。"))
	if frappe.db.exists("User", email):
		frappe.throw(_("该邮箱已有账户，请直接登录或找回密码。"))

	user = frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": full_name,
			"enabled": 1,
			"user_type": "System User",
			"send_welcome_email": 0,
			"roles": [{"role": READ_ONLY_ROLE}],
		}
	)
	user.insert(ignore_permissions=True)
	if employee:
		# Link first, then add the ESS role: ERPNext validates that this role has
		# a corresponding Employee.user_id record when the User is saved.
		frappe.db.set_value("Employee", employee.get("name"), "user_id", email)
		frappe.get_doc(
			{
				"doctype": "User Permission",
				"user": email,
				"allow": "Employee",
				"for_value": employee.get("name"),
				"apply_to_all_doctypes": 1,
			}
		).insert(ignore_permissions=True)
		user.append("roles", {"role": EMPLOYEE_SELF_SERVICE_ROLE})
		user.save(ignore_permissions=True)
	update_password(email, password, logout_all_sessions=True)
	return {
		"user": email,
		"employee": employee.get("name") if employee else None,
		"employee_code": employee.get("custom_employee_code") if employee else None,
		"profile_matched": bool(employee),
		"message": _(
			"注册成功，已匹配员工个人档案。"
			if employee
			else "注册成功。当前为基础只读账号，后续可由管理员补充权限。"
		),
	}
