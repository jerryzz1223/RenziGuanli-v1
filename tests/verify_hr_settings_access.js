const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const api = read("hrms/api/employee_field_template.py");
const topNav = read("hrms/public/js/hrms_top_nav.js");
const legacySettingsPage = JSON.parse(read("hrms/hr/page/staff_attribute_settings/staff_attribute_settings.json"));
const modelPage = JSON.parse(read("hrms/hr/page/hrms_model_center/hrms_model_center.json"));
const sidebar = read("hrms/public/js/hrms_home_redirect_v6.js");
const shellCss = read("hrms/public/css/hrms_top_nav.css");

const expectedRoles = ["HR Manager", "System Manager"];
assert(!fs.existsSync(path.join(root, "hrms/hr/page/hr_settings_center/hr_settings_center.json")));
assert(api.includes('RETIRED_PERSONNEL_PAGE_NAMES = {"employee-form-entry", "hr-settings-center", "hrms-developer-center"}'));
assert(!fs.existsSync(path.join(root, "hrms/hr/page/hrms_developer_center/hrms_developer_center.json")));
assert(!api.includes('"name": "hr-settings-center"'));
assert(!topNav.includes('action: "settings"'));
assert(!read("hrms/hr/page/staff_attribute_settings/staff_attribute_settings.js").includes('frappe.set_route("hr-settings-center")'));
assert(sidebar.includes('"staff-attribute-settings"'));
assert(shellCss.includes('body.hrms-custom-drawer-active > .body-sidebar-container {\n\tdisplay: none !important;'));
for (const page of [legacySettingsPage]) {
	assert.deepStrictEqual(
		page.roles.map((row) => row.role),
		expectedRoles,
		`${page.title} must only be available to HR and system administrators`,
	);
}
assert.deepStrictEqual(
	modelPage.roles.map((row) => row.role),
	["System Manager"],
	"Model governance center must only be available to system administrators",
);

for (const marker of [
	'HR_SETTINGS_MANAGER_ROLES = ("HR Manager", "System Manager")',
	"def _require_hr_settings_manager():",
	"frappe.only_for(HR_SETTINGS_MANAGER_ROLES)",
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
	".filter((item) => !item.roles?.length || hasAnyRole(item.roles))",
]) {
	assert(topNav.includes(marker), `Account menu role gate missing: ${marker}`);
}

assert(!topNav.includes('action: "developer-tools"'));
assert(!sidebar.includes('/desk/hrms-developer-center'));
assert(api.includes('field = lookup.get(_normalise_header(header_label))'), "Roster header auto-matching must remain in the import API.");
assert(api.includes('for key in (field["field_label"], field["fieldname"], *aliases):'), "Roster header matching must retain labels, field names and aliases.");

console.log("HR configuration access and retired developer page verified.");
