const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const mustInclude = (source, marker) => {
	if (!source.includes(marker)) throw new Error(`Missing marker: ${marker}`);
};

const api = read("hrms/api/payroll_input.py");
for (const marker of [
	"def bulk_save_monthly_payroll_participation_decisions",
	"employee_codes: str | list",
	'"employee_code": ["in", employee_codes]',
	"payroll_participation_bulk",
	"离职结算需逐人核对原表输入和结算依据",
	"invalidate_trial=False",
	"def get_payroll_generation_preflight",
	'"issue_employee_codes"',
	"pending_decision_codes",
	'str(row.get("employee_code") or "").strip()',
	'"employee_codes": (salary_validation.get("issue_employee_codes")',
	'"route": "employee-salary"',
	'"route": "salary-assignments"',
]) mustInclude(api, marker);

const ui = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
for (const marker of [
	"data-payroll-participation-select-filtered",
	"data-bulk-payroll-participation",
	"open_bulk_payroll_participation_dialog",
	"bulk_save_monthly_payroll_participation_decisions",
	"employee_codes: JSON.stringify(employeeCodes)",
	"refresh_payroll_participation_preview",
	"capture_payroll_participation_table_state",
	"restore_payroll_participation_table_state",
	"get_payroll_generation_preflight",
	"data-payroll-preflight-route",
	"pending_payroll_resume_storage_key",
	"read_pending_payroll_resume",
	"allow_standing_tab: restorePending",
	"pending_payroll_resume_check_scope",
	"save_pending_payroll_resume",
	"apply_pending_payroll_employee_filter",
	"resume_pending_payroll_calculation",
	"data-payroll-employee-code",
	"generate_payroll_input_records",
	"generate_payroll_settlement_records",
	"前往人员范围",
	"前往员工定薪",
]) mustInclude(ui, marker);

const resumeRunStart = ui.indexOf("\n\trun_payroll_settlement_generation(");
const resumeRunEnd = ui.indexOf("\n\tresume_pending_payroll_calculation(", resumeRunStart);
const resumeRun = ui.slice(resumeRunStart, resumeRunEnd);
if (resumeRun.indexOf("generate_payroll_input_records") > resumeRun.indexOf("generate_payroll_settlement_records")) {
	throw new Error("Pending resume must rebuild payroll inputs before settlement calculation.");
}
if (resumeRun.indexOf("clear_pending_payroll_resume") < resumeRun.indexOf("generate_payroll_settlement_records")) {
	throw new Error("Pending resume must only clear after settlement calculation succeeds.");
}

const singleSave = ui.slice(ui.indexOf("open_payroll_participation_decision_dialog"), ui.indexOf("load_payroll_participation_preview"));
if (singleSave.includes("this.load_employee_salary_profiles()")) {
	throw new Error("Single participation save must not reload the entire personnel-range page.");
}

console.log("Payroll participation batch and in-place refresh contract passed.");
