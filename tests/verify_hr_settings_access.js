const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const api = read("hrms/api/employee_field_template.py");
const topNav = read("hrms/public/js/hrms_top_nav.js");
const settingsPage = JSON.parse(read("hrms/hr/page/hr_settings_center/hr_settings_center.json"));
const legacySettingsPage = JSON.parse(read("hrms/hr/page/staff_attribute_settings/staff_attribute_settings.json"));
const developerPage = JSON.parse(read("hrms/hr/page/hrms_developer_center/hrms_developer_center.json"));
const developerPageJs = read("hrms/hr/page/hrms_developer_center/hrms_developer_center.js");
const modelPage = JSON.parse(read("hrms/hr/page/hrms_model_center/hrms_model_center.json"));

const expectedRoles = ["HR Manager", "System Manager"];
for (const page of [settingsPage, legacySettingsPage]) {
	assert.deepStrictEqual(
		page.roles.map((row) => row.role),
		expectedRoles,
		`${page.title} must only be available to HR and system administrators`,
	);
}
assert.deepStrictEqual(
	developerPage.roles.map((row) => row.role),
	["System Manager"],
	"Developer center must only be available to system administrators",
);
assert.deepStrictEqual(
	modelPage.roles.map((row) => row.role),
	["System Manager"],
	"Model governance center must only be available to system administrators",
);

for (const marker of [
	'HR_SETTINGS_MANAGER_ROLES = ("HR Manager", "System Manager")',
	"def _require_hr_settings_manager():",
	"frappe.only_for(HR_SETTINGS_MANAGER_ROLES)",
	"def get_hr_settings_center():\n\t_require_hr_settings_manager()",
	"def save_employee_field_center(items: str):\n\t_require_hr_settings_manager()",
	"def save_employee_field_template(items: str):\n\t_require_hr_settings_manager()",
	"def create_employee_custom_field(",
	"def set_employee_template_field_enabled(fieldname: str, enabled: int | str):\n\t_require_hr_settings_manager()",
	'"roles": HR_SETTINGS_PAGE_ROLES',
	'page_doc.set("roles", [{"role": role} for role in desired_roles])',
]) {
	assert(api.includes(marker), `HR settings access control missing: ${marker}`);
}

for (const marker of [
	'const HR_SETTINGS_MANAGER_ROLES = ["HR Manager", "System Manager"]',
	'const SYSTEM_ADMIN_ROLES = ["System Manager"]',
	'{ label: "设置中心", action: "settings", roles: HR_SETTINGS_MANAGER_ROLES }',
	'{ label: "开发工具（开发环境）", action: "developer-tools", roles: SYSTEM_ADMIN_ROLES }',
	".filter((item) => !item.roles?.length || hasAnyRole(item.roles))",
	'frappe.set_route("hrms-developer-center")',
]) {
	assert(topNav.includes(marker), `Account menu role gate missing: ${marker}`);
}

for (const marker of [
	'frappe.pages["hrms-developer-center"]',
	'case "models": route("hrms-model-center")',
	'frappe.set_route("List", "Page")',
	'route("hrms-access-center")',
	"get_hrms_developer_configuration_map",
	"可配置业务逻辑地图",
	"./scripts/hrms-local.sh migrate",
	"业务配置与受控开发通道",
]) {
	assert(developerPageJs.includes(marker), `Developer center missing controlled tooling: ${marker}`);
}

console.log("HR settings and developer access controls verified.");
