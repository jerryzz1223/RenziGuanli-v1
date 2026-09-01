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
	"delete_salary_structure_version",
	"list_salary_grades",
	"list_assignable_salary_grades",
	"create_employee_salary_change",
	"create_employee_salary_change_template_file",
	"preview_employee_salary_change_workbook",
	"import_employee_salary_change_workbook",
	"list_employee_salary_change_import_batches",
	"rollback_employee_salary_change_import_batch",
	"salary_import_batch",
	"_salary_grade_from_structure",
	"_salary_grade_from_unique_amounts",
	"_salary_grade_from_import_row",
	"_salary_grade_from_matching_history",
	"按表内金额匹配薪资架构",
	"hiding the earlier option makes a",
	"salary_grade_label",
	"已绑定历史薪级",
	"version_by_name",
	"薪资架构版本",
	"薪资序号",
	"已匹配薪资架构",
	"使用表内定薪金额",
	"update_employee_salary_change",
	"list_employee_salary_changes",
	"list_employee_salary_change_grid",
	"_salary_contribution_defaults",
	"get_active_salary_change_for_employee",
	"get_salary_architecture_workbench",
	"_is_trial_salary_change",
	"set_employee_payroll_participation",
	"exclude_from_payroll",
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
	"员工定薪表",
	"薪资架构与员工定薪",
	"下载员工定薪模板",
	"get_salary_architecture_workbench",
	"preview_salary_structure_workbook",
	"import_salary_structure_workbook",
	"list_salary_structure_versions",
	"list_salary_grades",
	"list_employee_salary_change_grid",
	"员工定薪表",
	"缴纳社保",
	"缴纳公积金",
	"请输入",
	"导入 Excel",
	"人员薪资调整模板（月）",
	"preview_employee_salary_change_workbook",
	"import_employee_salary_change_workbook",
	"update_employee_salary_change",
	"data-save-salary-change",
	"选择等级后自动带入薪资",
	"data-salary-change-field=\"salary_grade\"",
	"assignableSalaryGrades",
	"员工定薪导入记录",
	"撤销本次导入",
	"rollback_employee_salary_change_import_batch",
	"本月不参与计算",
	"data-exclude-payroll",
	"const missingDifference",
	"data-salary-change-save-state",
	"confirm_salary_changes_saved",
	"values: JSON.stringify(values)",
	"员工定薪提交失败",
	"保存并提交",
	"get_saved_payroll_month",
	"remember_payroll_month",
]) {
	mustInclude(pageJs, marker, `Payroll center page is missing master-data marker: ${marker}`);
}

if (pageJs.includes("data-salary-assignment-overview") || pageJs.includes("请先处理以下人员")) {
	throw new Error("The duplicated salary-action list must not be rendered above the editable table.");
}

if (pageJs.includes('data-salary-change-field="status"') || pageJs.includes('__("异动原因")')) {
	throw new Error("Employee salary grid must not expose legacy status or change-reason columns.");
}

if (!api.includes('status = "已批准"') || !api.includes('"status": "已批准"')) {
	throw new Error("Employee salary saves and imports must be submitted immediately.");
}

mustInclude(
	api,
	'contribution_enabled = int(bool(is_active and stage == "正式"))',
	"Only confirmed employees may default to social-insurance and housing-fund contributions.",
);
mustInclude(
	api,
	"社保、公积金：正式默认缴纳，试用默认不缴纳",
	"The salary grid must describe the confirmed-only contribution default.",
);

const salaryGridApi = api.slice(api.indexOf("def list_employee_salary_change_grid"), api.indexOf("def get_active_salary_change_for_employee"));
for (const marker of [
	"current_lock = _current_payroll_attendance_lock(company, payroll_month)",
	"_attendance_scope_filters(company, payroll_month, attendance_lock_version)",
	"_monthly_payroll_participation_decision_map(company, payroll_month, attendance_lock_version)",
	"including leavers and missing-salary",
]) {
	mustInclude(salaryGridApi, marker, `Salary grid must retain each locked attendance employee: ${marker}`);
}

for (const marker of [
	"employee_names = [row.name for row in employees]",
	'"employee": ["in", employee_names or [""]]',
	"fields=[",
	'"exclude_from_payroll"',
]) {
	mustInclude(salaryGridApi, marker, `Salary grid query must stay scoped and lightweight: ${marker}`);
}

const salaryAssignmentStep = pageJs.slice(pageJs.indexOf("\tload_salary_assignment_step()"), pageJs.indexOf("\n\texclude_employee_from_payroll"));
mustInclude(salaryAssignmentStep, "const salaryRowsRequest = this.load_employee_salary_changes({ render: false })", "Salary assignment should fetch rows without waiting for the grade request.");
mustInclude(salaryAssignmentStep, "salaryRowsRequest.then((rows) => {", "Salary assignment must render employee rows as soon as they arrive.");
mustInclude(salaryAssignmentStep, "refresh_assignable_salary_grade_options", "Salary grades should fill in after the editable employee form is visible.");
if (salaryAssignmentStep.includes("Promise.all([")) throw new Error("Salary-grade options must not delay the employee salary form.");
mustInclude(salaryAssignmentStep, "正在读取员工定薪表…", "Salary assignment should show immediate loading feedback.");

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
		["HRMS Employee Salary Change", "员工薪资异动", "employee_code", "effective_date", "base_salary", "function_allowance", "full_salary", "exclude_from_payroll"],
	],
]) {
	const json = read(`hrms/hr/doctype/${folder}/${folder}.json`);
	const py = read(`hrms/hr/doctype/${folder}/${folder}.py`);
	for (const marker of markers) mustInclude(json, marker, `${folder} DocType is missing marker: ${marker}`);
	mustInclude(py, "Document", `${folder} controller must extend Document.`);
}

console.log("Payroll master-data contract passed.");
