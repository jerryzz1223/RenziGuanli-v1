const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(file) {
	const full = path.join(root, file);
	if (!fs.existsSync(full)) throw new Error(`Missing file: ${file}`);
	return fs.readFileSync(full, "utf8");
}

function mustInclude(source, marker) {
	if (!source.includes(marker)) throw new Error(`Missing marker: ${marker}`);
}

const page = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
for (const marker of [
	"monthly-workbench",
	"本月算薪",
	"load_monthly_workbench",
	"data-payroll-calculation-table",
	"list_payroll_settlement_records",
	"薪资计算表",
	"settlement_columns(true)",
	"data-select-calculation-columns",
	"calculation_column_storage_key",
	"data-select-all-calculation-columns",
	"data-clear-calculation-columns",
	"data-export-calculation-excel",
	"export_calculation_excel",
	"fixed_calculation_column_fields",
	'"employee_name", "employee_code", "department"',
]) {
	mustInclude(page, marker);
}

if (page.includes("primary_tabs") || page.includes("hrms-payroll-input-tabs")) {
	throw new Error("Duplicate payroll primary navigation must not be rendered.");
}

const monthlyWorkbench = page.slice(page.indexOf("\tload_monthly_workbench() {"), page.indexOf("\n\trender_project_map_items() {"));
for (const marker of ["data-workbench-cards", "data-workbench-runbook", "data-workbench-action", "hrms-payroll-runbook-head"]) {
	if (monthlyWorkbench.includes(marker)) throw new Error(`Monthly calculation view must only render its table: ${marker}`);
}

const api = read("hrms/api/payroll_input.py");
for (const marker of [
	"def get_payroll_month_runbook(company: str, payroll_month: str, attendance_lock_version: str):",
	"def confirm_payroll_settlement_records(company: str, payroll_month: str, attendance_lock_version: str):",
	'"readiness_areas": readiness_areas',
	'readiness_area("master", "人员范围"',
	'readiness_area("sources", "月度增减项"',
	"_attendance_scope_filters(company, payroll_month, attendance_lock_version)",
	"status\": \"已批准\"",
	"无法生成薪资输入表：以下员工缺少本月有效且已批准的薪资异动",
	"无法试算：以下员工缺少本月有效且已批准的薪资异动",
	"薪资确认前，锁定考勤、薪资输入表和薪资结算表人数必须一致",
	"仍有 {0} 条福利/扣款来源待确认，不能确认薪资结算",
]) {
	mustInclude(api, marker);
}

const readiness = api.slice(api.indexOf("readiness_areas = ["), api.indexOf('"readiness_areas": readiness_areas'));
if (readiness.includes('readiness_area("attendance"') || readiness.includes('"考勤数据"')) {
	throw new Error("Attendance must be an implicit dependency, not a payroll workflow area.");
}

const guide = read("docs/payroll/永新薪酬统算使用说明与项目企划.md");
for (const marker of ["5.1薪资福利.xlsx", "5.2人资考勤.xlsx", "5.5租房补贴.xlsx", "5.6员工宿舍.xlsx", "本月算薪", "尚待人事/财务确认的规则"]) {
	mustInclude(guide, marker);
}

console.log("Payroll monthly workbench contract passed.");
