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
	"SALARY_STRUCTURE_VERSION_DOCTYPE",
	"SALARY_GRADE_DOCTYPE",
	"EMPLOYEE_SALARY_CHANGE_DOCTYPE",
	"preview_salary_structure_workbook",
	"import_salary_structure_workbook",
	"list_salary_structure_versions",
	"list_salary_grades",
	"create_employee_salary_change",
	"create_employee_salary_change_template_file",
	"list_employee_salary_changes",
	"get_active_salary_change_for_employee",
	"get_salary_architecture_workbench",
	"_is_trial_salary_change",
	"底薪",
	"职能津贴",
	"证书及多能工津贴",
	"薪资小计",
]) {
	mustInclude(api, marker, `Payroll master-data API is missing marker: ${marker}`);
}

const pageJs = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
for (const marker of [
	"薪酬管理中心",
	"salary-master",
	"薪资主数据",
	"薪资架构版本",
	"薪资档位",
	"员工薪资异动",
	"薪资架构与员工定薪",
	"下载员工定薪模板",
	"get_salary_architecture_workbench",
	"preview_salary_structure_workbook",
	"import_salary_structure_workbook",
	"list_salary_structure_versions",
	"list_salary_grades",
	"list_employee_salary_changes",
]) {
	mustInclude(pageJs, marker, `Payroll center page is missing master-data marker: ${marker}`);
}

const workbenchJs = read("hrms/hr/page/hrms_workbench/hrms_workbench.js");
const workbenchPy = read("hrms/hr/page/hrms_workbench/hrms_workbench.py");
for (const marker of ["薪资主数据", "salary-master", "薪酬管理中心"]) {
	mustInclude(workbenchJs + workbenchPy, marker, `Workbench is missing payroll master-data marker: ${marker}`);
}

for (const [folder, markers] of [
	[
		"hrms_salary_structure_version",
		["HRMS Salary Structure Version", "薪资架构版本", "structure_version", "effective_from", "status", "source_file"],
	],
	[
		"hrms_salary_grade",
		["HRMS Salary Grade", "薪资档位", "salary_structure_version", "job_grade", "base_salary", "function_allowance", "full_salary"],
	],
	[
		"hrms_employee_salary_change",
		["HRMS Employee Salary Change", "员工薪资异动", "employee_code", "effective_date", "base_salary", "function_allowance", "full_salary"],
	],
]) {
	const json = read(`hrms/hr/doctype/${folder}/${folder}.json`);
	const py = read(`hrms/hr/doctype/${folder}/${folder}.py`);
	for (const marker of markers) mustInclude(json, marker, `${folder} DocType is missing marker: ${marker}`);
	mustInclude(py, "Document", `${folder} controller must extend Document.`);
}

console.log("Payroll master-data contract passed.");
