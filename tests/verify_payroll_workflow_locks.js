const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const mustInclude = (source, marker) => {
	if (!source.includes(marker)) throw new Error(`Missing marker: ${marker}`);
};

const page = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
for (const marker of [
	"workspace_areas",
	"人员范围",
	"员工定薪",
	"月度增减项",
	"薪资试算",
	"确认与发放",
	"render_workspace_navigation",
	"data-area-route",
	"各区域可按需进入",
	"试算时系统统一检查必要条件",
	"如何验证规则是真正生效的",
]) mustInclude(page, marker);

const areas = page.slice(page.indexOf("this.workspace_areas = ["), page.indexOf("this.active_tab ="));
if ((areas.match(/\{ key:/g) || []).length !== 5) throw new Error("Payroll workspace must expose exactly five business areas.");
if (areas.includes('key: "attendance"') || areas.includes('route: "data-closure"')) throw new Error("Attendance must not be a payroll workspace area.");

for (const forbidden of ["data-payroll-step-lock", "render_active_step_lock", "load_payroll_workflow_status()", "请先按顺序锁定"]) {
	if (page.includes(forbidden)) throw new Error(`Obsolete sequential workflow marker: ${forbidden}`);
}

const api = read("hrms/api/payroll_input.py");
for (const marker of [
	"def _assert_workflow_locked_for_generation",
	"薪资试算前请处理",
	"_validate_salary_step(company, payroll_month, attendance_lock_version)",
	"_validate_rules_step(company, payroll_month, attendance_lock_version)",
	"_validate_attendance_rule_step(company, payroll_month)",
	"_validate_sources_step(company, payroll_month, attendance_lock_version)",
	'"readiness_areas": readiness_areas',
	"无需人工逐步锁定",
]) mustInclude(api, marker);

const assertion = api.slice(api.indexOf("def _assert_workflow_locked_for_generation"), api.indexOf("@frappe.whitelist()\ndef sync_locked_attendance_final_to_payroll"));
if (assertion.includes("_workflow_status") || assertion.includes("请先按顺序完成并锁定")) {
	throw new Error("Generation must validate live data, not manual workflow locks.");
}

console.log("Payroll on-demand readiness contract passed.");
