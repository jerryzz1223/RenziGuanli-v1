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
	"PAYROLL_FIELD_MAPPING_DOCTYPE",
	"PAYROLL_SETTLEMENT_FIELD_MAPPINGS",
	"ensure_default_payroll_field_mappings",
	"list_payroll_field_mappings",
	"upsert_payroll_field_mapping",
	"EXCEL_B_DEPARTMENT",
	"EXCEL_H_SALARY_SUBTOTAL",
	"EXCEL_N_ABSENCE_DEDUCTION",
	"EXCEL_AI_GROSS_PAY",
	"EXCEL_AS_NET_PAY",
	"EXCEL_AV_COMPANY_COST_TOTAL",
]) {
	mustInclude(api, marker, `Payroll settlement field mapping API is missing marker: ${marker}`);
}

const pageJs = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
for (const marker of [
	"薪资结算字段映射",
	"list_payroll_field_mappings",
	"ensure_default_payroll_field_mappings",
	"upsert_payroll_field_mapping",
	"Excel列",
	"系统字段",
	"来源模块",
	"对应规则",
]) {
	mustInclude(pageJs, marker, `Payroll rule page is missing field mapping marker: ${marker}`);
}

const salaryRulesStart = pageJs.indexOf("\tload_salary_rules() {");
const salaryRulesEnd = pageJs.indexOf("\n\tformat_attendance_rule_parameters", salaryRulesStart);
const salaryRulesView = pageJs.slice(salaryRulesStart, salaryRulesEnd);
for (const marker of [
	"专业设置：查看全部薪酬项目",
	"data-payroll-item-summary",
	"data-payroll-item-catalog",
	"高级设置：项目来源规则与字段映射",
	"data-payroll-field-mapping-table",
	"data-refresh-field-mappings",
	"data-edit-field-mapping",
]) {
	if (salaryRulesView.includes(marker)) throw new Error(`Payroll rules view must not display mapping configuration: ${marker}`);
}

const mappingJson = read("hrms/hr/doctype/hrms_payroll_field_mapping/hrms_payroll_field_mapping.json");
const mappingPy = read("hrms/hr/doctype/hrms_payroll_field_mapping/hrms_payroll_field_mapping.py");
for (const marker of [
	"HRMS Payroll Field Mapping",
	"薪资字段映射",
	"mapping_code",
	"excel_column",
	"excel_label",
	"system_doctype",
	"system_field",
	"source_module",
	"formula_expression",
	"rule_code",
	"required_for_settlement",
]) {
	mustInclude(mappingJson, marker, `Payroll field mapping DocType is missing marker: ${marker}`);
}
mustInclude(mappingPy, "Document", "Payroll field mapping controller must extend Document.");

console.log("Payroll settlement field mapping contract passed.");
