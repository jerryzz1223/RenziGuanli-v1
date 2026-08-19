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

for (const marker of ["get_payroll_attendance_dependency", "请先在考勤假期完成并锁定本月考勤终稿", 'if (tab === "data-closure") return "variables"']) {
	mustInclude(api + pageJs, marker, `Automatic attendance dependency is missing marker: ${marker}`);
}

const tabs = pageJs.slice(pageJs.indexOf("this.tabs = ["), pageJs.indexOf("this.workspace_areas = ["));
if (tabs.includes('{ key: "data-closure"') || tabs.includes("数据闭环导入")) throw new Error("Payroll tabs still expose attendance/data-closure import.");
if (shellJs.includes('/desk/payroll-input-center/data-closure') || shellJs.includes("考勤与月度资料")) throw new Error("Payroll sidebar still exposes attendance/data-closure import.");
for (const marker of ["月度增减项", "/desk/payroll-input-center/variables"]) mustInclude(shellJs, marker);

console.log("Payroll automatic attendance dependency contract passed.");
