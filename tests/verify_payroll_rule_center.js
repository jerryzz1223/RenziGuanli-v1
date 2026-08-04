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
	"计算公式",
	"校验并保存",
	"下载公式模板",
	"初始化公司公式",
	"list_payroll_rules",
	"upsert_payroll_rule",
	"ensure_default_payroll_rules",
	"can_edit_payroll_rules",
	"规则说明",
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
	"company",
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
	"track_changes",
]) {
	mustInclude(ruleJson, marker, `Payroll rule DocType is missing marker: ${marker}`);
}
mustInclude(rulePy, "Document", "Payroll rule controller must extend Document.");
mustInclude(rulePy, '"company": self.company', "Payroll rules must be unique inside one company.");
mustInclude(api, "def list_payroll_rules(company: str", "Payroll rule reads must require company scope.");
mustInclude(api, "def ensure_default_payroll_rules(company: str", "Default rule creation must require company scope.");
mustInclude(api, '{"company": company, "rule_code": rule["rule_code"]}', "Default rules must be idempotent per company.");
mustInclude(api, '"rule_origin": "内置默认（未保存）"', "Uninitialized companies must still see built-in rule definitions.");
mustInclude(pageJs, "args: { company: this.company }", "Payroll rule page must pass the selected company.");
mustInclude(pageJs, "规则来源", "Payroll rule page must identify built-in and company rules.");

console.log("Payroll rule center contract passed.");
