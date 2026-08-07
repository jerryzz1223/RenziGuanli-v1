const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(file) {
	return fs.readFileSync(path.join(root, file), "utf8");
}

function mustInclude(source, marker) {
	if (!source.includes(marker)) throw new Error(`Missing marker: ${marker}`);
}

const page = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
for (const marker of [
	"process_steps",
	"薪酬实施步骤",
	"点击哪一步，下方只显示该步",
	"is-selected",
	"process_state_for",
	"update_process_guide_status",
	"process_status_from_salary_architecture",
	"process_status_from_workflow",
	"data-process-route",
	'route: "salary-rules"',
	'route: "salary-assignments"',
	'route: "attendance-pay-rules"',
	'route: "data-closure"',
	"load_salary_assignment_step",
	"load_attendance_pay_rules",
	"核对人事基础资料",
	"前往人事 · 员工花名册",
	'frappe.set_route("List", "Employee")',
	"确认并锁定本步",
	"解锁并使后续步骤失效",
	"payroll-formulas",
	"payroll-config-items",
	"payroll-advanced",
	"list_payroll_configuration_items",
	"filter_payroll_configuration_items",
	"configure_payroll_item",
	"下载公式模板",
	"薪酬配置操作指南",
	"data-guide-route",
]) {
	mustInclude(page, marker);
}

const api = read("hrms/api/payroll_input.py");
for (const marker of [
	"PAYROLL_ATOMIC_CONFIGURATION_ITEMS",
	"PAYROLL_WORKFLOW_STEPS",
	"PAYROLL_ATTENDANCE_RULE_CODES",
	"def lock_payroll_workflow_step",
	"def unlock_payroll_workflow_step",
	"def list_payroll_configuration_items(company: str):",
	"company = _require_company(company)",
	"职务津贴",
	"员工基础资料",
	"薪资规则与字段",
	"证书津贴",
	"多能工津贴",
	"全勤奖",
	"住房补贴",
	"学历补贴",
	"宿舍住宿费",
	"宿舍水费",
	"宿舍电费",
	"迟到扣款",
	"全勤奖扣款",
	"configuration_status",
	"calculation_mode",
	'"standard_payroll"',
	'"Salary Structure Assignment"',
]) {
	mustInclude(api, marker);
}

const css = read("hrms/hr/page/payroll_input_center/payroll_input_center.css");
for (const marker of [
	".hrms-payroll-process-guide",
	".hrms-payroll-process-step.is-selected",
	".hrms-payroll-lock-panel",
	".hrms-payroll-attendance-rule-grid",
	".hrms-payroll-step-purpose",
	".hrms-payroll-step-kicker",
	".hrms-payroll-formula-list",
	".hrms-payroll-guide-dialog",
]) {
	mustInclude(css, marker);
}

const guide = read("docs/payroll/薪酬配置中心操作指南.md");
for (const marker of ["七步操作顺序", "独立步骤跳转", "只读预览", "规则修改要求", "最低验收案例"]) {
	mustInclude(guide, marker);
}

console.log("Payroll configuration guide contract passed.");
