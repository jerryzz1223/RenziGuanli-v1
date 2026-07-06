const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(file) {
	const full = path.join(root, file);
	if (!fs.existsSync(full)) throw new Error(`Missing file: ${file}`);
	return fs.readFileSync(full, "utf8");
}

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}

const pageJs = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
const api = read("hrms/api/payroll_input.py");
const workbenchPy = read("hrms/hr/page/hrms_workbench/hrms_workbench.py");
const shellJs = read("hrms/public/js/hrms_home_redirect_v6.js");

for (const marker of [
	"员工薪资",
	"月工资表",
	"工资发放",
	"薪酬报表",
	"薪酬分析",
	"计薪规则",
	"薪资设置",
	"年终奖计算",
	"发送工资条",
]) {
	mustInclude(pageJs + workbenchPy + shellJs, marker, `Payroll menu is not linked to business view: ${marker}`);
}

for (const route of [
	"employee-salary",
	"monthly-payroll",
	"payroll-disbursement",
	"payroll-reports",
	"payroll-analysis",
	"salary-slips",
	"annual-bonus",
]) {
	mustInclude(pageJs + workbenchPy + shellJs, route, `Payroll route is missing: ${route}`);
}

for (const method of [
	"list_employee_salary_profiles",
	"list_monthly_payroll_overview",
	"list_payroll_disbursement_records",
	"list_payroll_report_summary",
	"list_payroll_analysis",
	"list_payroll_dependency_status",
]) {
	mustInclude(api, `def ${method}`, `Payroll API is missing linkage method: ${method}`);
	mustInclude(pageJs, `hrms.api.payroll_input.${method}`, `Payroll page does not call linkage method: ${method}`);
}

for (const marker of [
	"Employee",
	"HRMS Monthly Attendance Summary",
	"HRMS Payroll Input Record",
	"HRMS Payroll Settlement Record",
	"HRMS Payroll Welfare Source Record",
	"HRMS Employee Salary Change",
]) {
	mustInclude(api, marker, `Payroll linkage API must use real source doctype: ${marker}`);
}

for (const marker of ["固定工资", "总工资", "员工状态", "最近调整日", "调整原因", "结算覆盖率", "公司实际负担总计", "待生成工资条"]) {
	mustInclude(pageJs, marker, `Payroll linked page is missing visible business field: ${marker}`);
}

console.log("Payroll module linkage contract passed.");
