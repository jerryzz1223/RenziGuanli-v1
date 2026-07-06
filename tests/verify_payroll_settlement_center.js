const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function mustExist(file) {
	const full = path.join(root, file);
	if (!fs.existsSync(full)) throw new Error(`Missing file: ${file}`);
	return full;
}

function read(file) {
	return fs.readFileSync(mustExist(file), "utf8");
}

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}

const api = read("hrms/api/payroll_input.py");
for (const marker of [
	"PAYROLL_SETTLEMENT_DOCTYPE",
	"generate_payroll_settlement_records",
	"list_payroll_settlement_records",
	"HRMS Payroll Settlement Record",
	"full_salary_hourly_rate",
	"base_salary_hourly_rate",
	"company_cost_total",
]) {
	mustInclude(api, marker, `Payroll settlement API is missing marker: ${marker}`);
}

const pageJs = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
for (const marker of [
	"settlements",
	"薪资结算表",
	"generate_payroll_settlement_records",
	"list_payroll_settlement_records",
	"实发工资",
	"公司实际负担总计",
]) {
	mustInclude(pageJs, marker, `Payroll settlement page is missing marker: ${marker}`);
}

const workbenchJs = read("hrms/hr/page/hrms_workbench/hrms_workbench.js");
const workbenchPy = read("hrms/hr/page/hrms_workbench/hrms_workbench.py");
mustInclude(workbenchJs + workbenchPy, "薪资结算表", "Workbench must expose payroll settlement table route.");
mustInclude(workbenchJs + workbenchPy, "settlements", "Workbench settlement route must target payroll input center settlements tab.");

const settlementJson = read("hrms/hr/doctype/hrms_payroll_settlement_record/hrms_payroll_settlement_record.json");
for (const marker of [
	"HRMS Payroll Settlement Record",
	"薪资结算记录",
	"base_salary",
	"salary_subtotal",
	"overtime_pay_total",
	"gross_pay",
	"taxable_salary",
	"net_pay",
	"company_cost_total",
	"calculation_status",
]) {
	mustInclude(settlementJson, marker, `Payroll settlement DocType is missing marker: ${marker}`);
}

console.log("Payroll settlement center contract passed.");
