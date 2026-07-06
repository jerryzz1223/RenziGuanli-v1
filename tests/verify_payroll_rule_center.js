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
	"PAYROLL_RULE_DOCTYPE",
	"DEFAULT_PAYROLL_RULES",
	"ensure_default_payroll_rules",
	"list_payroll_rules",
	"upsert_payroll_rule",
	"can_edit_payroll_rules",
	"PAYROLL_SETTLEMENT_GROSS_PAY",
	"ATTENDANCE_FULL_ATTENDANCE_BONUS",
	"WELFARE_EDUCATION_SUBSIDY",
	"WELFARE_RENTAL_SUBSIDY",
	"WELFARE_DORMITORY_FEE",
	"WELFARE_SOCIAL_SECURITY_COMPANY",
]) {
	mustInclude(api, marker, `Payroll rule API is missing marker: ${marker}`);
}

const pageJs = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
for (const marker of [
	"salary-rules",
	"薪资规则",
	"规则中心",
	"刷新默认规则",
	"新增/修改规则",
	"list_payroll_rules",
	"upsert_payroll_rule",
	"ensure_default_payroll_rules",
	"can_edit_payroll_rules",
	"公式/规则",
	"来源资料",
]) {
	mustInclude(pageJs, marker, `Payroll page is missing rule center marker: ${marker}`);
}

const workbenchJs = read("hrms/hr/page/hrms_workbench/hrms_workbench.js");
const workbenchPy = read("hrms/hr/page/hrms_workbench/hrms_workbench.py");
for (const marker of ["薪资规则", "salary-rules", "规则中心"]) {
	mustInclude(workbenchJs + workbenchPy, marker, `Workbench is missing salary rule route marker: ${marker}`);
}

const ruleJson = read("hrms/hr/doctype/hrms_payroll_rule/hrms_payroll_rule.json");
const rulePy = read("hrms/hr/doctype/hrms_payroll_rule/hrms_payroll_rule.py");
for (const marker of [
	"HRMS Payroll Rule",
	"薪资规则",
	"rule_code",
	"rule_name",
	"rule_category",
	"formula_expression",
	"parameters_json",
	"rule_text",
	"source_file",
	"source_sheet",
	"status",
	"editable",
]) {
	mustInclude(ruleJson, marker, `Payroll rule DocType is missing marker: ${marker}`);
}
mustInclude(rulePy, "Document", "Payroll rule controller must extend Document.");

console.log("Payroll rule center contract passed.");
