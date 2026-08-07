const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const mustInclude = (source, marker) => {
	if (!source.includes(marker)) throw new Error(`Missing marker: ${marker}`);
};

const page = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
for (const marker of [
	"人员基础",
	"员工定薪",
	"核算规则",
	"考勤计薪",
	"月度封板",
	"试算复核",
	"报表发放",
	"data-payroll-step-lock",
	"load_payroll_workflow_status",
	"lock_payroll_workflow_step",
	"unlock_payroll_workflow_step",
	"get_payroll_attendance_rule_overview",
	"系统先检查完整性和匹配关系",
	"解锁并使后续步骤失效",
	"如何验证规则是真正生效的",
	"需要排查导入时展开",
]) mustInclude(page, marker);

const api = read("hrms/api/payroll_input.py");
for (const marker of [
	"PAYROLL_STEP_LOCK_DOCTYPE",
	"PAYROLL_WORKFLOW_STEPS",
	"PAYROLL_ATTENDANCE_RULE_CODES",
	"def get_payroll_workflow_status",
	"def lock_payroll_workflow_step",
	"def unlock_payroll_workflow_step",
	"def _assert_workflow_locked_for_generation",
	"请先锁定上一步",
	"上游步骤解锁",
	"当前结算已生成工资单",
	"PAYROLL_SETTLEMENT_ABSENCE_DEDUCTION",
	"PAYROLL_SETTLEMENT_OVERTIME_PAY",
	"PAYROLL_SETTLEMENT_NIGHT_SHIFT",
	"ATTENDANCE_FULL_ATTENDANCE_BONUS",
]) mustInclude(api, marker);

const doctype = read("hrms/hr/doctype/hrms_payroll_step_lock/hrms_payroll_step_lock.json");
for (const marker of ["薪资月份", "锁定状态", "校验快照码", "解锁/失效原因", "System Manager", "HR Manager"]) {
	mustInclude(doctype, marker);
}

const css = read("hrms/hr/page/payroll_input_center/payroll_input_center.css");
for (const marker of [".hrms-payroll-lock-panel", ".hrms-payroll-lock-panel.is-locked", ".hrms-payroll-attendance-rule-grid", ".hrms-payroll-rule-verification"]) {
	mustInclude(css, marker);
}

console.log("Payroll workflow lock contract passed.");
