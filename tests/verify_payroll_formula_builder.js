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
	'"expression": "[标准工时] - [基本出勤工时]"',
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
	"preview_payroll_formula_source_workbook",
	"import_payroll_formula_source_workbook",
	"_excel_formula_to_business_expression",
	'frappe.session.user == "Administrator"',
	"evaluate_formula_set(payroll_formulas, formula_context)",
	'"formula_trace": formula_trace',
	"get_payroll_calculation_audit",
	"PAYROLL_SETTLEMENT_FORMULA_OUTPUT_FIELDS",
	"PAYROLL_FORMULA_CONTEXT_FIELDS",
	"已有结算记录未完整保留公式执行追溯",
]) requireMarker(api, marker);

const page = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
for (const marker of [
	"工资计算模板",
	"必需输入",
	"计算公式",
	"hrms-payroll-formula-builder",
	"hrms-payroll-formula-flow-guide",
	"hrms-payroll-formula-process-card",
	"data-formula-builder-add",
	"data-formula-builder-drag",
	"data-formula-builder-remove",
	"render_inline_formula_editor",
	"toggle_inline_formula_editor",
	"get_payroll_calculation_audit",
	"参与计算与字段映射核查",
	"render_formula_cards",
	"校验并保存",
	"open_payroll_formula_import",
]) requireMarker(page, marker);

if (page.includes('fieldtype: "Small Text", label: __("计算公式")')) {
	throw new Error("Payroll formula editor must use the card builder instead of a raw formula textarea.");
}

if (page.includes("tokens.push(button.dataset.formulaBuilderAdd)")) {
	throw new Error("New formula cards must insert at the selected position instead of always appending.");
}

if (page.includes("hrms-payroll-formula-insert-point")) {
	throw new Error("Formula editor must not render non-formula plus signs between cards.");
}

console.log("Payroll formula builder contract passed.");
