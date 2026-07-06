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

const api = read("hrms/api/payroll_input.py");
const pageJs = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
const workbenchPy = read("hrms/hr/page/hrms_workbench/hrms_workbench.py");
const shellJs = read("hrms/public/js/hrms_home_redirect_v6.js");

for (const marker of [
	"PAYROLL_IMPORT_TEMPLATES",
	"list_payroll_import_templates",
	"create_payroll_data_closure_template_file",
	"preview_payroll_data_closure_workbook",
	"import_payroll_data_closure_workbook",
	"preview_payroll_settlement_workbook",
	"import_payroll_settlement_workbook",
	"薪资结算表",
	"员工薪资异动导入",
	"福利扣款来源导入",
	"月度考勤终稿导入",
	"HRMS Employee Salary Change",
	"HRMS Payroll Welfare Source Record",
	"HRMS Monthly Attendance Summary",
]) {
	mustInclude(api, marker, `Payroll data-closure API is missing marker: ${marker}`);
}

for (const marker of [
	"data-closure",
	"数据闭环导入",
	"Excel导入方案",
	"下载模板",
	"上传闭环数据",
	"导入闭环数据",
	"list_payroll_import_templates",
	"create_payroll_data_closure_template_file",
	"preview_payroll_data_closure_workbook",
	"import_payroll_data_closure_workbook",
	"完整薪资结算表",
	"员工薪资异动导入",
	"福利扣款来源导入",
	"月度考勤终稿导入",
	"薪资结算字段对应",
]) {
	mustInclude(pageJs, marker, `Payroll center is missing data-closure marker: ${marker}`);
}

for (const marker of ["数据闭环导入", "data-closure"]) {
	mustInclude(workbenchPy + shellJs, marker, `Workbench/sidebar is missing data-closure route marker: ${marker}`);
}

console.log("Payroll data-closure import contract passed.");
