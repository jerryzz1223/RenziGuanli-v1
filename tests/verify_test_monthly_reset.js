const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const mustInclude = (source, marker) => {
	if (!source.includes(marker)) throw new Error(`Missing marker: ${marker}`);
};

const api = read("hrms/api/payroll_input.py");
for (const marker of [
	"TEST_MONTHLY_RESET_AREAS",
	"def preview_test_monthly_data_reset",
	"def reset_test_monthly_data",
	"只有系统管理员可以清空测试月度数据",
	"考勤清空不支持未限定部门",
	"TEST 清空 {0} {1} {2}",
	"scope_label = department or \"全公司\"",
	"_test_monthly_reset_salary_import_batch_candidates",
	"FORM_IMPORT_BATCH_DOCTYPE",
	"HRMS Monthly Attendance Summary",
	"HRMS Employee Salary Change",
	"原始附件、花名册和薪资架构均未删除",
]) mustInclude(api, marker);

const payroll = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
for (const marker of [
	"data-test-monthly-reset",
	"open_test_monthly_reset_dialog",
	"测试清空本月全部薪酬",
	"点击“预览影响”后查看全公司本月将删除的数据",
	"department: \"\", area: \"payroll\"",
	"preview_test_monthly_data_reset",
	"reset_test_monthly_data",
	"我确认这是测试数据，允许永久删除",
]) mustInclude(payroll, marker);

const attendance = read("hrms/hr/page/attendance_import_center/attendance_import_center.js");
for (const marker of [
	"测试清空月度数据",
	"test-monthly-reset",
	"open_test_monthly_reset_dialog",
	"area: \"attendance\"",
	"reset_test_monthly_data",
]) mustInclude(attendance, marker);

console.log("Test monthly reset contract passed.");
