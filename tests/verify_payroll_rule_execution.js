const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
function read(file) {
	return fs.readFileSync(path.join(root, file), "utf8");
}
function requireMarker(source, marker) {
	if (!source.includes(marker)) throw new Error(`Missing payroll rule execution contract: ${marker}`);
}

const api = read("hrms/api/payroll_input.py");
const page = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
const guide = read("docs/payroll/永新薪酬统算使用说明与项目企划.md");
const inputDoctype = read("hrms/hr/doctype/hrms_payroll_input_record/hrms_payroll_input_record.json");

for (const marker of [
	"EXECUTABLE_PAYROLL_RULES",
	"FIXED_PAYROLL_CALCULATION_RULES",
	"def _effective_rule_config",
	"def _payroll_calculation_rules",
	"def validate_payroll_rule_execution",
	"def list_available_payroll_attendance_locks",
	'"lock_status": "已锁定"',
	"ATTENDANCE_FULL_ATTENDANCE_BONUS",
	"PAYROLL_SETTLEMENT_OVERTIME_PAY",
	"PAYROLL_SETTLEMENT_NIGHT_SHIFT",
	"WELFARE_SOCIAL_SECURITY_COMPANY",
	"calculation_rules = _payroll_calculation_rules(company, payroll_month)",
	'"calculation_rules": calculation_rules',
	"attendance_full_deduction",
	"def save_attendance_pay_rule",
	"large_night_shift_start",
	"大夜班结束时间应为次日时间",
]) {
	requireMarker(api, marker);
}

for (const marker of [
	"data-attendance-dependency",
	"get_payroll_attendance_dependency",
	"render_attendance_dependency",
	"正在自动读取考勤假期终稿",
	"validate_payroll_formula",
	"校验并保存",
	"计算公式",
	"公式已保存并进入下一次试算",
	"data-attendance-rule-editor-area",
	"大夜班每次津贴",
	"大夜班上班时间",
]) {
	requireMarker(page, marker);
}

for (const marker of [
	"考勤锁定版本如何定义",
	"规则如何真正参与计算",
	"参数化公式",
	"固定计算器公式",
	"来源/说明规则",
]) {
	requireMarker(guide, marker);
}

requireMarker(inputDoctype, "attendance_full_deduction");
console.log("Payroll rule execution and automatic attendance dependency contract passed.");
