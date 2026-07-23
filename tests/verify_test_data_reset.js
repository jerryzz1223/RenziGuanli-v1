const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "hrms", "api", "test_data_reset.py"), "utf8");
const ui = fs.readFileSync(path.join(root, "hrms", "public", "js", "hrms_test_data_reset.js"), "utf8");
const hooks = fs.readFileSync(path.join(root, "hrms", "hooks.py"), "utf8");

for (const marker of [
	"TEST_COMPANY = \"TEST-HRMS\"",
	"CONFIRMATION_TEXT",
	"def get_test_data_reset_context",
	"def clear_test_page_data",
	"def _require_trial_access",
	"PAGE_TARGETS",
	"attendance-import-center",
	"payroll-input-center",
	"form-data-intake",
	"employee_detail",
	"sample_names",
]) {
	assert(api.includes(marker), `Test reset API is missing ${marker}`);
}

assert(api.includes('"System Manager" not in frappe.get_roles()'), "Reset API must require System Manager.");
assert(api.includes('meta.has_field("company")'), "Reset API must scope records by company.");
assert(api.includes("frappe.db.rollback()"), "Reset API must roll back a failed cleanup.");
assert(api.includes('if page == "employee-detail"'), "Employee detail must have an exact current-record scope.");
assert(api.includes('filters["name"] = record_name'), "Current Form/detail pages must filter by the current record name.");
assert(!api.includes('"workbench": ('), "Workbench must not offer a cross-page bulk cleanup.");
assert(ui.includes("清除本页测试数据"), "The local-only reset asset must retain its explicit trial warning.");
assert(ui.includes("frappe.router.on(\"change\", refresh)"), "Reset entry must refresh with page navigation.");
assert(ui.includes("renderPreview"), "Reset dialog must show a record-level deletion preview.");
assert(!hooks.includes("hrms_test_data_reset.js"), "Test reset control must never be loaded globally in a production build.");
assert(!hooks.includes("hrms_test_data_reset.css"), "Test reset styling must never be loaded globally in a production build.");

console.log("TEST-HRMS page reset contract is valid.");
