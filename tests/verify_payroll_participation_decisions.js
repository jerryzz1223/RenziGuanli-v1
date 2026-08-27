const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const mustInclude = (source, marker) => {
	if (!source.includes(marker)) throw new Error(`Missing marker: ${marker}`);
};

const api = read("hrms/api/payroll_input.py");
for (const marker of [
	"MONTHLY_PAYROLL_PARTICIPATION_DOCTYPE",
	"PAYROLL_PARTICIPATION_DECISIONS",
	"def save_monthly_payroll_participation_decision",
	"def reload_payroll_participation_population",
	"重新加载当前锁定考勤人员范围",
	"异常待审核必须填写异常说明",
	"离职结算必须填写结算依据",
	"_participation_decision_blocks_calculation",
	"_participation_decision_excludes",
	"尚未完成审核决定",
	"participation_decisions",
]) mustInclude(api, marker);

const ui = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
for (const marker of [
	"本月人员范围与处理决定",
	"data-payroll-participation-decision",
	"open_payroll_participation_decision_dialog",
	"离职结算",
	"异常待审核",
	"save_monthly_payroll_participation_decision",
	"data-reload-payroll-population",
	"reload_payroll_participation_population",
]) mustInclude(ui, marker);

const doctype = read("hrms/hr/doctype/hrms_monthly_payroll_participation/hrms_monthly_payroll_participation.json");
for (const marker of [
	"HRMS Monthly Payroll Participation",
	"attendance_lock_version",
	"settlement_basis",
	"review_status",
	"审核通过",
]) mustInclude(doctype, marker);

console.log("Payroll participation decision contract passed.");
