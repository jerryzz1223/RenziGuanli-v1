const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

[
	"hrms/public/js/hrms_top_nav.js",
	"hrms/public/js/hrms_home_redirect_v6.js",
	"hrms/hr/page/hrms_workbench/hrms_workbench.js",
	"hrms/hr/page/staff_attribute_settings/staff_attribute_settings.js",
].forEach((file) => {
	assert(!read(file).includes("ensure_personnel_pages"), `${file} must not run page migration during navigation`);
});

[
	"employee_archive/employee_archive.js",
	"employee_property_history/employee_property_history.js",
	"employee_roster_import/employee_roster_import.js",
	"form_data_intake/form_data_intake.js",
	"organizational_chart/organizational_chart.js",
].forEach((file) => {
	const source = read(`hrms/hr/page/${file}`);
	assert(source.includes("on_page_show"), `${file} must refresh when Frappe shows a cached Page`);
	assert(source.includes("request_id"), `${file} must ignore stale async responses`);
});

[
	"employee_archive/employee_archive.js",
	"employee_property_history/employee_property_history.js",
	"form_data_intake/form_data_intake.js",
	"organizational_chart/organizational_chart.js",
].forEach((file) => {
	assert(read(`hrms/hr/page/${file}`).includes("on_page_hide"), `${file} must release global listeners when hidden`);
});

[
	"employee_archive/employee_archive.js",
	"employee_detail/employee_detail.js",
	"employee_property_history/employee_property_history.js",
	"form_data_intake/form_data_intake.js",
	"organizational_chart/organizational_chart.js",
	"attendance_import_center/attendance_import_center.js",
	"payroll_input_center/payroll_input_center.js",
].forEach((file) => {
	assert(read(`hrms/hr/page/${file}`).includes("cache_ttl = 30_000"), `${file} must reuse fresh cached page data`);
});

const attendance = read("hrms/hr/page/attendance_import_center/attendance_import_center.js");
const payroll = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
assert(attendance.includes("refresh_from_route(view = \"\", force = false)"), "Attendance view must refresh on page re-show");
assert(payroll.includes("refresh_from_route(tab = \"\", force = false)"), "Payroll view must refresh on page re-show");

const shell = read("hrms/public/js/hrms_home_redirect_v6.js");
const hooks = read("hrms/hooks.py");
assert(shell.includes("function localize_dynamic_text(root)"), "Localization must accept a changed-node root");
assert(shell.includes("schedule_hrms_dynamic_localization(changed_nodes)"), "Mutation observer must process only changed nodes");
assert(shell.includes("compact_localization_roots"), "Localization must avoid walking nested DOM roots more than once");
assert(shell.includes("requestIdleCallback"), "Dynamic localization must yield to user interactions");
assert(shell.includes("localized_value !== original_value"), "Localization must not write unchanged text and retrigger its observer");
assert(hooks.includes("hrms_home_redirect_v6.js?v=20260805h"), "The optimized Desk shell must use a fresh browser cache key");

const employeeDetail = read("hrms/hr/page/employee_detail/employee_detail.js");
assert(employeeDetail.includes("invalid_route_employee"), "Employee detail must reject literal undefined/null route values");
assert(employeeDetail.includes('frappe.set_route("employee-archive")'), "Invalid employee detail URLs must return to the archive");

const api = read("hrms/api/employee_field_template.py");
const branding = read("hrms/branding.py");
assert(api.includes('frappe.defaults.get_user_default("Company")'), "Roster must have a server-side company fallback");
assert(api.includes("frappe.get_list("), "Roster queries must honor Frappe permissions");
assert(api.includes("_employee_export_records_cache_key"), "Export history cache must be isolated by user and company");
assert(api.includes("_count_employee_rows"), "Roster totals must use database counts instead of loading every employee name");
assert(
	api.includes('fields=[{"COUNT": "*", "as": "count"}]'),
	"Roster counts must use Frappe's supported aggregate-dict syntax",
);
assert(!api.includes('fields=["count(name) as count"]'), "Roster counts must not use rejected SQL-function strings");
assert(branding.includes('request.path != "/desk/undefined"'), "Invalid Desk image interception must have an exact URL scope");
assert(branding.includes('abort(Response(status=204))'), "Invalid Desk image requests must not render a full Desk page");

console.log("Cached page lifecycle, company scoping, and stale-response guards are wired.");
