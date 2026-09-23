const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const access = fs.readFileSync(path.join(root, "hrms", "access_control.py"), "utf8");
const ui = fs.readFileSync(path.join(root, "hrms", "public", "js", "hrms_capability_ui.js"), "utf8");
const intakeApi = fs.readFileSync(path.join(root, "hrms", "api", "form_data_intake.py"), "utf8");
const intakeUi = fs.readFileSync(path.join(root, "hrms", "public", "js", "hrms_contextual_form_import.js"), "utf8");
const hooks = fs.readFileSync(path.join(root, "hrms", "hooks.py"), "utf8");

const keys = new Set();
for (const match of access.matchAll(/_capability\("([a-z0-9_]+)"/g)) keys.add(match[1]);
for (const match of access.matchAll(/"key":\s*"([a-z0-9_]+)"/g)) keys.add(match[1]);

if (keys.size !== 40) throw new Error(`Expected 40 business capabilities, found ${keys.size}.`);
for (const key of keys) {
	if (!ui.includes(`${key}:`)) throw new Error(`Global capability UI is missing ${key}.`);
}

for (const marker of [
	"hrms_capability_ui.js",
	"Business permissions control actions, not navigation",
	"MutationObserver",
	"data-hrms-permission-disabled",
	"event.stopImmediatePropagation()",
	"FORM_POLICIES",
	"PAGE_POLICIES",
	"LIST_IMPORT_POLICIES",
]) {
	if (!`${hooks}\n${ui}`.includes(marker)) throw new Error(`Missing global action-control marker: ${marker}`);
}

for (const key of [
	"roster_import_submit", "roster_import_approve", "employee_create", "employee_create_approve",
	"personnel_change_submit", "personnel_change_approve", "separation_submit", "separation_approve",
	"attendance_import_submit", "attendance_approve", "attendance_final_lock", "payroll_change_submit",
	"payroll_approval", "recruitment_submit", "recruitment_approve", "training_submit", "training_approve",
	"performance_submit", "performance_approve", "permission_management",
]) {
	if (!intakeApi.includes(`"${key}"`)) throw new Error(`Form import backend does not map ${key}.`);
}

for (const marker of ["submit_capability", "approval_capability", "_require_form_import_capability", "TEMPLATE_CAPABILITIES", "window.hrmsCapabilities?.require"]) {
	if (!`${intakeApi}\n${intakeUi}`.includes(marker)) throw new Error(`Form import permission marker missing: ${marker}`);
}

console.log(`Business capability action matrix verified (${keys.size}/40 keys).`);
