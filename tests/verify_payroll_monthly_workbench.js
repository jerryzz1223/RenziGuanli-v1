const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(file) {
	const full = path.join(root, file);
	if (!fs.existsSync(full)) throw new Error(`Missing file: ${file}`);
	return fs.readFileSync(full, "utf8");
}

function mustInclude(source, marker) {
	if (!source.includes(marker)) throw new Error(`Missing marker: ${marker}`);
}

const page = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
for (const marker of [
	"monthly-workbench",
	"primary_tabs",
	"本月算薪",
	"薪酬项目与规则",
	"load_monthly_workbench",
	"get_payroll_month_runbook",
	"生成薪资输入表",
	"试算本月工资",
	"ensure_payroll_generation_scope",
	"缺少薪资试算前置条件",
	"请先选择已锁定考勤版本",
	"process_status_from_runbook",
	"process_readiness",
	"缺考勤锁定",
	"确认本月结算",
	"confirm_payroll_settlement_records",
	"系统拒绝读取未锁定考勤、跨公司数据和不同锁定版本的数据",
]) {
	mustInclude(page, marker);
}

const api = read("hrms/api/payroll_input.py");
for (const marker of [
	"def get_payroll_month_runbook(company: str, payroll_month: str, attendance_lock_version: str):",
	"def confirm_payroll_settlement_records(company: str, payroll_month: str, attendance_lock_version: str):",
	'"process_steps": process_steps',
	'"key": "master"',
	'"key": "sources"',
	"_attendance_scope_filters(company, payroll_month, attendance_lock_version)",
	"status\": \"已批准\"",
	"无法生成薪资输入表：以下员工缺少本月有效且已批准的薪资异动",
	"无法试算：以下员工缺少本月有效且已批准的薪资异动",
	"薪资确认前，锁定考勤、薪资输入表和薪资结算表人数必须一致",
	"仍有 {0} 条福利/扣款来源待确认，不能确认薪资结算",
]) {
	mustInclude(api, marker);
}

const guide = read("docs/payroll/永新薪酬统算使用说明与项目企划.md");
for (const marker of ["5.1薪资福利.xlsx", "5.2人资考勤.xlsx", "5.5租房补贴.xlsx", "5.6员工宿舍.xlsx", "本月算薪", "尚待人事/财务确认的规则"]) {
	mustInclude(guide, marker);
}

console.log("Payroll monthly workbench contract passed.");
