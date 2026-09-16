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

def _capability(key, label, role, category, description, risk="medium", permissions=()):
	return {
		"key": key,
		"label": label,
		"role": role,
		"category": category,
		"description": description,
		"risk": risk,
		"permissions": permissions,
	}


# Each checkbox maps to one real role.  Do not merge submit and approve roles:
# independent assignment is the business control requested by HR, and it also
# makes the effective permission test explainable for auditors.
CAPABILITY_DEFINITIONS = (
	{
		"key": "basic_read_only",
		"label": "基础只读",
		"role": READ_ONLY_ROLE,
		"category": "基础权限",
		"description": "只读公司、部门、岗位、假日和公开招聘等非敏感基础资料；无新建、修改、提交或审批权限。",
		"risk": "low",
	},
	_capability("personnel_view", "花名册与人事查看", "人事查看", "人事", "查看花名册、员工档案及人事记录；不能新增、修改或审批。", "high", (("Employee", "read", "select"),)),
	_capability("roster_import_submit", "花名册导入提交", "花名册导入提交", "人事", "上传、预览并提交花名册批量导入；不包含审批。", "high", (("Employee", "read", "create", "write", "import"),)),
	_capability("roster_import_approve", "花名册导入审批", "花名册导入审批", "人事", "审核已提交的花名册导入结果并决定是否生效。", "critical", (("Employee", "read", "write"), ("HRMS Form Import Batch", "read", "write"), ("HRMS Form Import Row", "read", "write", "submit"))),
	_capability("dingtalk_employee_import_approve", "钉钉员工导入审批", "钉钉员工导入审批", "人事", "查看钉钉花名册待导入资料，并在核对无误后批准写入员工主表。", "critical", (("Employee", "read", "create", "write"), ("HRMS DingTalk Employee Import", "read", "write"))),
	_capability("employee_create", "添加员工", "员工新增", "人事", "创建新员工档案或新增草稿；不包含新增审批。", "high", (("Employee", "read", "create", "write"),)),
	_capability("employee_create_approve", "添加员工后审批", "员工新增审批", "人事", "审批新增员工及入职资料的生效。", "critical", (("Employee", "read", "write", "submit"), ("Employee Onboarding", "read", "write", "submit"))),
	_capability("employee_edit", "员工档案修改", "员工档案修改", "人事", "修改现有员工档案；不包含人事异动或离职审批。", "high", (("Employee", "read", "write"),)),
	_capability("personnel_change_submit", "人事异动提交", "人事异动提交", "人事", "提交调动、转正、晋升等人事异动申请。", "high", (("Employee Transfer", "read", "create", "write", "submit"), ("Employee Promotion", "read", "create", "write", "submit"))),
	_capability("personnel_change_approve", "人事异动审批", "人事异动审批", "人事", "审批调动、转正、晋升等人事异动。", "critical", (("Employee Transfer", "read", "write", "submit", "cancel"), ("Employee Promotion", "read", "write", "submit", "cancel"))),
	_capability("separation_submit", "离职申请提交", "离职申请提交", "人事", "创建并提交离职申请；不能审批自己的申请。", "high", (("Employee Separation", "read", "create", "write", "submit"),)),
	_capability("separation_approve", "离职审批", "离职审批", "人事", "审批或驳回已提交的离职申请。", "critical", (("Employee Separation", "read", "write", "submit", "cancel"),)),
	_capability("separation_effective", "实际离职办理", "实际离职办理", "人事", "填写唯一实际离职时间；时间到达后员工才正式归类为已离职。", "critical", (("Employee Separation", "read", "write"), ("Employee", "read", "write"))),
	_capability("personnel_export", "人事导出", "人事导出", "人事", "导出花名册和人事报表。", "high", (("Employee", "read", "export", "report", "print"),)),

	_capability("attendance_view", "考勤查看", "考勤查看", "考勤", "查看考勤日数据、异常和月度结果。", "high", (("Attendance", "read", "select"), ("HRMS Attendance Import Batch", "read"), ("HRMS Attendance Processing Record", "read"), ("HRMS Monthly Attendance Summary", "read"))),
	_capability("attendance_import_submit", "考勤导入提交", "考勤导入提交", "考勤", "上传并提交考勤、请假、补卡和月度补充来源。", "high", (("HRMS Attendance Import Batch", "read", "create", "write", "import"),)),
	_capability("attendance_exception_edit", "考勤异常修改", "考勤异常修改", "考勤", "提交考勤异常的人工更正，保留原值和更改审计。", "high", (("HRMS Attendance Processing Record", "read", "write"), ("HRMS Attendance Exception", "read", "write"))),
	_capability("attendance_approve", "考勤审批与部门确认", "考勤审批", "考勤", "审核异常、部门确认和考勤结果；不包含月度终稿锁定。", "critical", (("HRMS Attendance Exception", "read", "write", "submit"), ("HRMS Attendance Department Confirmation", "read", "write", "submit"))),
	_capability("attendance_final_lock", "考勤终稿锁定", "考勤终稿锁定", "考勤", "生成、锁定或按要求解锁月度考勤终稿。", "critical", (("HRMS Attendance Month Lock", "read", "create", "write", "submit", "cancel"), ("HRMS Monthly Attendance Summary", "read", "write"))),
	_capability("attendance_export", "考勤导出", "考勤导出", "考勤", "导出考勤明细、异常和月度终稿。", "high", (("Attendance", "read", "export", "report", "print"), ("HRMS Monthly Attendance Summary", "read", "export", "report"))),

	_capability("payroll_view", "薪酬查看", "薪酬查看", "薪酬", "只读查看员工定薪、社保公积金和月度薪酬结果。", "critical", (("Salary Structure Assignment", "read"), ("Salary Slip", "read"), ("HRMS Payroll Input Record", "read"), ("HRMS Payroll Settlement Record", "read"), ("HRMS Payroll Welfare Source Record", "read"))),
	_capability("payroll_entry_submit", "薪资首次录入", "薪资经办", "薪酬", "提交员工首次定薪；不包含审批。", "critical", (("HRMS Employee Salary Change", "read", "create", "write"),)),
	_capability("payroll_change_submit", "薪资修改申请", "薪资修改提交", "薪酬", "提交已定薪员工的薪资修改申请。", "critical", (("HRMS Employee Salary Change", "read", "create", "write"),)),
	_capability("contribution_submit", "社保公积金提交", "社保公积金提交", "薪酬", "录入或申请修改社保和公积金标准。", "critical", (("HRMS Employee Contribution Change", "read", "create", "write"),)),
	_capability("payroll_approval", "薪酬审批", "薪资审批", "薪酬", "审批或驳回薪资、社保和公积金新增或修改申请。", "critical", (("HRMS Employee Salary Change", "read", "write", "submit"), ("HRMS Employee Contribution Change", "read", "write", "submit"))),
	_capability("payroll_calculate", "薪酬试算", "薪酬试算", "薪酬", "生成薪资试算和计算结果；不能确认发放。", "critical", (("Payroll Entry", "read", "create", "write"), ("HRMS Payroll Input Record", "read", "create", "write"))),
	_capability("payroll_confirm", "薪酬确认与发放", "薪酬确认发放", "薪酬", "确认月度薪酬结果、生成结算与发放数据。", "critical", (("Payroll Entry", "read", "write", "submit", "cancel"), ("Salary Slip", "read", "write", "submit", "cancel"), ("HRMS Payroll Settlement Record", "read", "write", "submit"))),
	_capability("payroll_export", "薪酬导出", "薪酬导出", "薪酬", "导出定薪、社保公积金、试算和发放报表。", "critical", (("Salary Slip", "read", "export", "report", "print"), ("HRMS Payroll Settlement Record", "read", "export", "report"))),
	_capability("payroll_rules", "薪酬规则配置", "薪酬规则配置", "薪酬", "维护薪资架构、计薪规则和字段映射。", "critical", (("Salary Structure", "read", "create", "write", "submit", "cancel"), ("HRMS Payroll Rule", "read", "create", "write"), ("HRMS Payroll Field Mapping", "read", "create", "write"))),

	_capability("recruitment_submit", "招聘录入与提交", "招聘提交", "招聘", "录入职位、候选人、面试和录用申请。", "high", (("Job Opening", "read", "create", "write", "submit"), ("Job Applicant", "read", "create", "write"), ("Interview", "read", "create", "write", "submit"), ("Job Offer", "read", "create", "write", "submit"))),
	_capability("recruitment_approve", "招聘审批", "招聘审批", "招聘", "审批招聘职位、面试结论和录用通知。", "critical", (("Job Opening", "read", "write", "submit", "cancel"), ("Interview", "read", "write", "submit", "cancel"), ("Job Offer", "read", "write", "submit", "cancel"))),
	_capability("training_submit", "培训录入与提交", "培训提交", "培训", "创建并提交培训计划、活动、结果和反馈。", "medium", (("Training Program", "read", "create", "write", "submit"), ("Training Event", "read", "create", "write", "submit"), ("Training Result", "read", "create", "write", "submit"), ("Training Feedback", "read", "create", "write", "submit"))),
	_capability("training_approve", "培训审批", "培训审批", "培训", "审批或取消已提交的培训业务。", "high", (("Training Program", "read", "write", "submit", "cancel"), ("Training Event", "read", "write", "submit", "cancel"), ("Training Result", "read", "write", "submit", "cancel"))),
	_capability("performance_submit", "绩效录入与提交", "绩效提交", "绩效", "创建并提交目标、考核周期和绩效考核。", "high", (("Goal", "read", "create", "write", "submit"), ("Appraisal Cycle", "read", "create", "write", "submit"), ("Appraisal", "read", "create", "write", "submit"))),
	_capability("performance_approve", "绩效审批", "绩效审批", "绩效", "审批目标、考核周期和绩效结果。", "critical", (("Goal", "read", "write", "submit", "cancel"), ("Appraisal Cycle", "read", "write", "submit", "cancel"), ("Appraisal", "read", "write", "submit", "cancel"))),
	_capability("expense_submit", "费用与出差提交", "费用出差提交", "审批", "创建并提交费用报销和出差申请。", "high", (("Expense Claim", "read", "create", "write", "submit"), ("Travel Request", "read", "create", "write", "submit"))),
	_capability("expense_approve", "费用与出差审批", "费用出差审批", "审批", "审批或驳回费用报销和出差申请。", "critical", (("Expense Claim", "read", "write", "submit", "cancel"), ("Travel Request", "read", "write", "submit", "cancel"))),
	{
		"key": "permission_management",
		"label": "账户与权限管理",
		"role": "System Manager",
		"category": "系统",
		"description": "创建账户、勾选角色、设置数据范围及系统配置。",
		"risk": "critical",
	},
)
CAPABILITY_BY_KEY = {item["key"]: item for item in CAPABILITY_DEFINITIONS}


def _require_system_manager():
	if frappe.session.user != "Administrator" and "System Manager" not in frappe.get_roles(frappe.session.user):
		frappe.throw(_("仅系统管理员可修改账户权限。"), frappe.PermissionError)


def has_hrms_capability(capability_key: str, user: str | None = None, legacy_roles=()):
	"""Return whether one user may perform a named business action.

	System Manager and Administrator retain their existing full access.  The
	legacy role list is deliberately explicit per call so older HR accounts keep
	working while new accounts can be granted only the narrow checkbox role.
	"""
	definition = CAPABILITY_BY_KEY.get(capability_key)
	if not definition:
		raise ValueError(f"Unknown HRMS capability: {capability_key}")
	user = user or frappe.session.user
	if user == "Administrator":
		return True
	roles = set(frappe.get_roles(user))
	return bool({"System Manager", definition["role"], *legacy_roles} & roles)


def require_hrms_capability(capability_key: str, *, legacy_roles=(), message: str = ""):
	if has_hrms_capability(capability_key, legacy_roles=legacy_roles):
		return
	definition = CAPABILITY_BY_KEY[capability_key]
	frappe.throw(
		message or _('当前账户没有“{0}”权限。').format(definition["label"]),
		frappe.PermissionError,
	)


def require_any_hrms_capability(capability_keys, *, legacy_roles=(), message: str = ""):
	if any(has_hrms_capability(key, legacy_roles=legacy_roles) for key in capability_keys):
		return
	frappe.throw(message or _('当前账户没有该板块的任何已授权操作。'), frappe.PermissionError)


@frappe.whitelist()
def get_current_hrms_capabilities():
	"""Expose only the current user's action keys for button-level UI control."""
	return {
		"capabilities": [
			item["key"] for item in CAPABILITY_DEFINITIONS
			if has_hrms_capability(item["key"])
		],
	}


def _ensure_docperm_operations(doctype, role, permission_types):
	"""Merge all operations into one Custom DocPerm row for the role."""
	if not permission_types:
		return
	filters = {"parent": doctype, "role": role, "permlevel": 0, "if_owner": 0}
	permission_name = frappe.db.get_value("Custom DocPerm", filters, "name")
	if not permission_name:
		add_permission(doctype, role, ptype=permission_types[0])
		permission_name = frappe.db.get_value("Custom DocPerm", filters, "name")
	if not permission_name:
		return
	docperm = frappe.get_doc("Custom DocPerm", permission_name)
	changed = False
	for permission_type in permission_types:
		if not docperm.get(permission_type):
			docperm.set(permission_type, 1)
			changed = True
	if changed:
		docperm.save(ignore_permissions=True)


def ensure_hrms_access_roles():
	"""Create every checkbox role and its actual DocType operation permissions."""
	for capability in CAPABILITY_DEFINITIONS:
		role = capability["role"]
		if not frappe.db.exists("Role", role):
			frappe.get_doc(
				{"doctype": "Role", "role_name": role, "desk_access": 1, "is_custom": 1}
			).insert(ignore_permissions=True)
		for permission in capability.get("permissions") or ():
			doctype, *permission_types = permission
			if not frappe.db.exists("DocType", doctype):
				continue
			_ensure_docperm_operations(doctype, role, permission_types)
		# Every business operation is company-scoped.  This read permission is
		# further narrowed by Company User Permission when one is configured.
		if role != "System Manager" and frappe.db.exists("DocType", "Company"):
			_ensure_docperm_operations("Company", role, ("read",))
	for doctype in READ_ONLY_DOCTYPES:
		if frappe.db.exists("DocType", doctype):
			_ensure_docperm_operations(doctype, READ_ONLY_ROLE, ("read",))
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
		"capabilities": [{key: value for key, value in item.items() if key != "permissions"} for item in CAPABILITY_DEFINITIONS],
		"managed_roles": [item["role"] for item in CAPABILITY_DEFINITIONS],
		"design_notes": [
			"公开注册只授予非敏感基础资料的只读权限。",
			"每个勾选项对应一个独立系统角色，提交和审批不捆绑。",
			"人事、考勤、薪酬、招聘、培训、绩效、费用出差均可按业务动作独立分配。",
			"角色决定可执行的操作；User Permission 继续限定公司、部门或员工数据范围。",
			"导入、导出、打印和报表权限也由对应勾选项进入实际权限引擎。",
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


def prevent_hrms_user_account_deletion(doc=None, method=None):
	"""Keep account identities available for historical business records."""
	frappe.throw(
		_("账号不允许删除。请停用账号，以保留历史单据中的操作人和审计记录。"),
		frappe.PermissionError,
	)


@frappe.whitelist()
def disable_hrms_user_account(user: str):
	"""Disable one account without deleting its identity or linked history."""
	_require_system_manager()
	user = str(user or "").strip()
	if not user or not frappe.db.exists("User", user):
		frappe.throw(_("账户不存在。"))
	if user in {"Administrator", "Guest"}:
		frappe.throw(_("系统内置账户不能停用。"), frappe.PermissionError)
	if user == frappe.session.user:
		frappe.throw(_("不能停用当前正在登录的账户。"), frappe.PermissionError)

	target = frappe.get_doc("User", user)
	if not target.enabled:
		return {"user": user, "disabled": 1, "message": _("账户已停用。")}
	target.enabled = 0
	target.save(ignore_permissions=True)
	frappe.clear_cache(user=user)
	return {"user": user, "disabled": 1, "message": _("账户已停用，历史记录已保留。")}


@frappe.whitelist()
def delete_hrms_user_account(user: str, confirmation: str = ""):
	"""Reject legacy deletion requests kept by stale clients."""
	_require_system_manager()
	prevent_hrms_user_account_deletion()


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
