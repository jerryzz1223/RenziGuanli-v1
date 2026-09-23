const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const api = read("hrms/api/employee_field_template.py");
const accessPage = read("hrms/hr/page/hrms_access_center/hrms_access_center.js");
const accessPageStyles = read("hrms/hr/page/hrms_access_center/hrms_access_center.css");
const developerPage = read("hrms/hr/page/hrms_developer_center/hrms_developer_center.js");
const modelPage = read("hrms/hr/page/hrms_model_center/hrms_model_center.js");
const sidebarShell = read("hrms/public/js/hrms_home_redirect_v6.js");
const accessControl = read("hrms/access_control.py");
const hooks = read("hrms/hooks.py");

for (const marker of [
	"全部已创建账户",
	"仅显示已开放角色",
	"配置业务权限",
	"测试账户的实际有效权限",
	"test_hrms_effective_permission",
	"data-action=\"test-user\"",
	"data-access-tab=\"accounts\"",
	"data-access-tab=\"roles\"",
	"管理数据范围",
	"assigned_scopes",
	"员工必须填公司工号",
	"员工仅显示公司工号",
]) {
	assert(accessPage.includes(marker), `Account-first access center contract missing: ${marker}`);
}

for (const removedGuideMarker of [
	"权限逻辑说明",
	"data-access-tab=\"guide\"",
	"hrms-access-center__permission-model",
	"密码与业务权限说明",
]) {
	assert(!accessPage.includes(removedGuideMarker), `Permission guide must stay removed: ${removedGuideMarker}`);
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
	"设置权限档位",
	"open_capability_editor",
	"hrms.access_control.set_hrms_user_access_tier",
	"三档业务权限",
	"只读 → 可以提交 → 审批",
	"access_tier_label",
	"tier_by_label",
	"hrms-access-capability-dialog",
	"response.message?.saved",
	"权限已保存为",
	"always()",
	"dialog.enable_primary_action()",
	"提交人和审批人按实际登录账号记入",
]) {
	assert(accessPage.includes(marker), `Three-tier access editor contract missing: ${marker}`);
}

for (const removedGranularUi of ["一键全选", "取消全选", "capability_${capability.key}", "permissionFields"]) {
	assert(!accessPage.includes(removedGranularUi), `Granular capability UI must stay removed: ${removedGranularUi}`);
}

for (const marker of [".hrms-access-capability-dialog .modal-dialog", "1180px", "calc(100vw - 48px)"]) {
	assert(accessPageStyles.includes(marker), `Wide capability editor styling missing: ${marker}`);
}

assert(!accessPage.includes("高风险"), "Capability screens should not show high-risk badges or warning copy.");
assert(!accessControl.includes("最高风险业务权限"), "Capability descriptions should stay concise and omit risk warning copy.");

for (const marker of [
	"停用账号",
	"open_disable_account_dialog",
	"hrms.access_control.disable_hrms_user_account",
	"data-action=\"disable-account\"",
	"历史记录已保留",
]) {
	assert(accessPage.includes(marker), `Account disabling UI contract missing: ${marker}`);
}

assert(!accessPage.includes("删除账号"), "Account management must not expose account deletion.");
assert(!accessPage.includes('data-action="delete-account"'), "Deletion action must not remain in the account table.");

for (const marker of [
	"def disable_hrms_user_account(",
	"target.enabled = 0",
	"def prevent_hrms_user_account_deletion(",
	"账号不允许删除",
	"def delete_hrms_user_account(",
]) {
	assert(accessControl.includes(marker), `Account retention backend contract missing: ${marker}`);
}

assert(!accessControl.includes('frappe.delete_doc("User"'), "HRMS must never delete User records.");
assert(
	hooks.includes('"on_trash": "hrms.access_control.prevent_hrms_user_account_deletion"'),
	"User deletion must be blocked from standard forms and APIs as well as the access center.",
);

for (const marker of [
	"basic_read_only",
	"roster_import_submit",
	"roster_import_approve",
	"employee_create",
	"employee_create_approve",
	"attendance_import_submit",
	"attendance_approve",
	"attendance_final_lock",
	"payroll_entry_submit",
	"payroll_change_submit",
	"payroll_approval",
	"payroll_confirm",
	"permission_management",
	"def require_hrms_capability(",
	"ACCESS_TIER_DEFINITIONS",
	"def set_hrms_user_access_tier(",
	"def migrate_legacy_capability_roles_to_access_tiers(",
	"preserved_roles",
]) {
	assert(accessControl.includes(marker), `Capability backend contract missing: ${marker}`);
}

for (const unavailableCapability of [
	"hr_entry_submit",
	"hr_approval",
	"leave_approval",
	"expense_approval",
	"expense_submit",
	"expense_approve",
	"recruitment_interview",
]) {
	assert(!accessControl.includes(`"key": "${unavailableCapability}"`), `Unverified capability must stay hidden: ${unavailableCapability}`);
}

for (const removedLabel of ["费用与出差提交", "费用与出差审批"]) {
	assert(!accessControl.includes(removedLabel), `Undelivered capability must stay removed: ${removedLabel}`);
}

for (const marker of ["RETIRED_CAPABILITY_ROLES", "RETIRED_CAPABILITY_KEYS", "ignored_capabilities", "retire_removed_capability_roles", '"Has Role",', 'frappe.db.delete("Custom DocPerm"']) {
	assert(accessControl.includes(marker), `Retired capability cleanup is missing marker: ${marker}`);
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
