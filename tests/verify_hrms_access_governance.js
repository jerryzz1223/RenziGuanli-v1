const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const api = read("hrms/api/employee_field_template.py");
const accessPage = read("hrms/hr/page/hrms_access_center/hrms_access_center.js");
const developerPage = read("hrms/hr/page/hrms_developer_center/hrms_developer_center.js");
const modelPage = read("hrms/hr/page/hrms_model_center/hrms_model_center.js");
const sidebarShell = read("hrms/public/js/hrms_home_redirect_v6.js");
const accessControl = read("hrms/access_control.py");

for (const marker of [
	"账户与角色分配",
	"角色操作权限",
	"用户数据范围",
	"实际有效权限",
	"全部已创建账户",
	"仅显示已开放角色",
	"配置业务权限",
	"测试账户的实际有效权限",
	"test_hrms_effective_permission",
	"data-action=\"test-user\"",
	"data-access-tab=\"accounts\"",
	"data-access-tab=\"roles\"",
	"data-access-tab=\"guide\"",
	"管理数据范围",
	"assigned_scopes",
	"员工必须填公司工号",
	"员工仅显示公司工号",
]) {
	assert(accessPage.includes(marker), `Account-first access center contract missing: ${marker}`);
}

for (const marker of [
	'"User Permission"',
	'permissions_by_user',
	'"data_scope_count"',
	'"data_scopes"',
	"_business_user_permissions",
	"_employee_link_from_company_code",
	'filters={"custom_employee_code": employee_code}',
	'"user_permissions": business_user_permissions',
]) {
	assert(api.includes(marker), `Access center data-scope summary contract missing: ${marker}`);
}

assert(!accessPage.includes("员工：${escape(scope.internal_for_value)}"), "Internal Employee link values must never be rendered.");
assert(api.includes('hrms.patches.v16_0.reapply_company_employee_code_names') === false, "Patch registration belongs only in patches.txt.");

for (const marker of [
	"勾选权限",
	"open_capability_editor",
	"hrms.access_control.set_hrms_user_capabilities",
	"已开放的权限",
]) {
	assert(accessPage.includes(marker), `Business capability editor contract missing: ${marker}`);
}

for (const marker of [
	"删除账号",
	"open_delete_account_dialog",
	"hrms.access_control.delete_hrms_user_account",
	"data-action=\"delete-account\"",
]) {
	assert(accessPage.includes(marker), `Account deletion UI contract missing: ${marker}`);
}

for (const marker of [
	"def delete_hrms_user_account(",
	'if user in {"Administrator", "Guest"}',
	"if user == frappe.session.user",
	'frappe.delete_doc("User", user, ignore_permissions=True)',
]) {
	assert(accessControl.includes(marker), `Account deletion backend contract missing: ${marker}`);
}

for (const marker of [
	"basic_read_only",
	"payroll_entry_submit",
	"payroll_approval",
	"permission_management",
	"def set_hrms_user_capabilities(",
	"preserved_roles",
]) {
	assert(accessControl.includes(marker), `Capability backend contract missing: ${marker}`);
}

for (const unavailableCapability of [
	"hr_entry_submit",
	"hr_approval",
	"leave_approval",
	"expense_approval",
	"recruitment_interview",
]) {
	assert(!accessControl.includes(`"key": "${unavailableCapability}"`), `Unverified capability must stay hidden: ${unavailableCapability}`);
}

for (const marker of [
	"def test_hrms_effective_permission(",
	"frappe.has_permission(doctype, permission_type, doc=doc, user=user)",
	'filters={"user": user}',
	'for permission_doctype in ("DocPerm", "Custom DocPerm")',
	'"administrator_assigned"',
	'"is_project_used"',
]) {
	assert(api.includes(marker), `Effective permission backend contract missing: ${marker}`);
}

for (const marker of [
	"get_hrms_developer_configuration_map",
	"字段字典与引用范围",
	"打开生效位置",
	"如何验证",
	"仍然需要代码和迁移",
	'frappe.set_route("List", this.dataset.dictionary)',
]) {
	assert(developerPage.includes(marker), `Developer configuration map contract missing: ${marker}`);
}

for (const marker of [
	'label: "账户与权限"',
	'label: "账户、权限与角色"',
	'label: "安全审计"',
	'label: "开发与配置"',
	'label: "开发与配置总览"',
	'label: "基础模型管理"',
	'label: "全部底层模型（谨慎）"',
	'label: "业务配置"',
	'label: "结构与页面（高级）"',
	'label: "运行与发布"',
	'"Core": "系统管理"',
	'"Frappe Framework": "人资管理系统"',
	'"Employee Self Service": "员工自助"',
	'"System User": "系统用户"',
]) {
	assert(sidebarShell.includes(marker), `Contextual Chinese sidebar contract missing: ${marker}`);
}

for (const obsolete of ['label: "全部账户"', 'label: "用户数据范围"', 'label: "角色资料"', 'label: "角色权限配置"']) {
	assert(!sidebarShell.includes(obsolete), `Duplicate access sidebar entry must be removed: ${obsolete}`);
}

for (const marker of [
	"get_hrms_model_governance_catalog",
	"不需要了解全部单据类型",
	"核心业务模型",
	"无代码业务配置",
	"系统内部记录",
	"项目中用在哪里",
	"应该怎样修改",
	"查看底层结构（高级）",
	"谨慎查看全部底层模型",
	"套件明细",
]) {
	assert(modelPage.includes(marker) || api.includes(marker), `Model governance contract missing: ${marker}`);
}

assert(api.includes('"doctype": TEMPLATE_DOCTYPE'), "Configuration map missing the employee field template");
for (const doctype of [
	"Workflow",
	"HRMS Form Approval Matrix",
	"HRMS Attendance Custom Rule",
	"HRMS Payroll Rule",
	"HRMS Payroll Field Mapping",
	"HRMS DingTalk Settings",
]) {
	assert(api.includes(`"doctype": "${doctype}"`), `Configuration map missing ${doctype}`);
}

console.log("Account-first permissions, real permission testing, and business configuration map verified.");
