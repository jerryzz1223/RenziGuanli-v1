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

const workbenchJs = read("hrms/hr/page/hrms_workbench/hrms_workbench.js");
const workbenchPy = read("hrms/hr/page/hrms_workbench/hrms_workbench.py");
const employeeTemplateApi = read("hrms/api/employee_field_template.py");

for (const marker of ["薪资输入中心", "payroll-input-center", "全勤奖", "住房补贴", "学历补贴", "宿舍扣款", "社保个人"]) {
	mustInclude(workbenchJs + workbenchPy, marker, `Payroll module is missing marker: ${marker}`);
}

for (const marker of ["PERSONNEL_PAGE_DEFINITIONS", '"payroll-input-center"', '"薪资输入中心"']) {
	mustInclude(employeeTemplateApi, marker, `Payroll page registration is missing marker: ${marker}`);
}

const pageJson = JSON.parse(read("hrms/hr/page/payroll_input_center/payroll_input_center.json"));
const pageJs = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");

if (pageJson.name !== "payroll-input-center" || pageJson.title !== "薪资输入中心") {
	throw new Error("Payroll input center route/title is incorrect.");
}

for (const marker of [
	"frappe.pages[\"payroll-input-center\"]",
	"导入月度增减项",
	"open_payroll_import_selector",
	"open_source_form_import_selector",
	"variable_source_catalog",
	"clear_inner_toolbar",
	"preview_payroll_variable_workbook",
	"import_payroll_variable_workbook",
	"load_import_batches",
	"delete_import_batch",
	"edit_variable_record",
	"generate_payroll_input_records",
	"list_payroll_variable_records",
	"list_payroll_input_records",
	"data-import-batch-table",
	"旧薪资输入表和未确认试算已失效",
	"void_import_batch",
	"render_payroll_input_rows",
	"render_payroll_settlement_rows",
	"settlement_columns",
	"显示所有细项",
	"load_settlement_dependencies",
	"render_dependency_strip",
	"filter_people_rows",
	"hrms-payroll-filter-row",
	"data-settlement-search",
	"唯一补充数据入口",
	"导入为待审核",
	"确认入账",
	"薪资输入表",
	"薪资结算表",
	"全勤奖",
	"住房补贴",
	"学历补贴",
	"宿舍扣款",
	"社保个人",
	"公积金个人",
	"应发前置合计",
	"应扣前置合计",
	"window.hrmsCompanyContext?.getCurrentCompany?.()",
	"hrms:company-context-changed",
	"data-company-context",
	"readonly",
]) {
	mustInclude(pageJs, marker, `Payroll input center page is missing marker: ${marker}`);
}

if (pageJs.includes("window.hrmsFormImport?.addPageActions")) {
	throw new Error("Payroll page must use one unified import entry instead of registering every salary source as a top toolbar button.");
}

const api = read("hrms/api/payroll_input.py");
for (const marker of [
	"PAYROLL_VARIABLE_SHEETS",
	"全勤奖",
	"住房补贴",
	"学历补贴",
	"社保名单",
	"每月员工住宿费用明细表",
	"preview_payroll_variable_workbook",
	"import_payroll_variable_workbook",
	"list_payroll_variable_import_batches",
	"delete_payroll_variable_import_batch",
	"update_payroll_variable_record",
	"generate_payroll_input_records",
	"list_payroll_variable_records",
	"list_payroll_input_records",
	"PAYROLL_SETTLEMENT_DOCTYPE",
	"HRMS Payroll Variable Import Batch",
	"HRMS Payroll Variable Record",
	"HRMS Payroll Input Record",
	"HRMS Monthly Attendance Summary",
]) {
	mustInclude(api, marker, `Payroll input API is missing marker: ${marker}`);
}

for (const [folder, markers] of [
	["hrms_payroll_variable_import_batch", ["HRMS Payroll Variable Import Batch", "薪资变量导入批次", "payroll_month", "source_file"]],
	["hrms_payroll_variable_record", ["HRMS Payroll Variable Record", "薪资变量记录", "variable_type", "amount", "source_sheet"]],
	["hrms_payroll_input_record", ["HRMS Payroll Input Record", "薪资输入记录", "full_attendance_bonus", "housing_subsidy", "education_subsidy", "dormitory_deduction", "preliminary_earning_total", "preliminary_deduction_total"]],
]) {
	const json = read(`hrms/hr/doctype/${folder}/${folder}.json`);
	const py = read(`hrms/hr/doctype/${folder}/${folder}.py`);
	for (const marker of markers) mustInclude(json, marker, `${folder} DocType is missing marker: ${marker}`);
	mustInclude(py, "Document", `${folder} controller must extend Document.`);
}

console.log("Payroll input center contract passed.");
