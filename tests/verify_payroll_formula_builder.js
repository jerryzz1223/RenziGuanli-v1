const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const requireMarker = (source, marker) => {
	if (!source.includes(marker)) throw new Error(`Missing payroll formula marker: ${marker}`);
};

const engine = read("hrms/payroll/payroll_formula.py");
for (const marker of [
	"FIELD_DEFINITIONS",
	"FORMULA_TEMPLATES",
	"compile_formula",
	"evaluate_formula_set",
	"只允许使用系统提供的函数",
	"社保公司手工金额",
	"公司实际负担",
]) requireMarker(engine, marker);

const api = read("hrms/api/payroll_input.py");
for (const marker of [
	"get_payroll_formula_catalog",
	"validate_payroll_formula",
	"upsert_payroll_formula",
	"ensure_default_payroll_formulas",
	"create_payroll_formula_template_file",
	"preview_payroll_formula_workbook",
	"import_payroll_formula_workbook",
	"evaluate_formula_set(payroll_formulas, formula_context)",
	'"formula_trace": formula_trace',
]) requireMarker(api, marker);

const page = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
for (const marker of [
	"工资计算模板",
	"必需输入",
	"计算公式",
	"高级设置",
	"hrms-payroll-formula-palette",
	"data-formula-token",
	"校验并保存",
	"open_payroll_formula_import",
]) requireMarker(page, marker);

console.log("Payroll formula builder contract passed.");
