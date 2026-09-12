const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (path) => fs.readFileSync(path, "utf8");
const roster = read("hrms/public/js/erpnext/employee_list.js");
const payroll = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
const attendance = read("hrms/hr/page/attendance_import_center/attendance_import_center.js");
const organization = read("hrms/hr/page/organizational_chart/organizational_chart.js");
const support = read("hrms/hr/page/cross_department_support/cross_department_support.js");

assert.match(roster, /fieldname: "employee_name", label: "姓名"[\s\S]*fieldname: "custom_employee_code", label: "工号"/);
assert.doesNotMatch(roster, /employee_identity|姓名 \/ 工号/);

for (const marker of [
	'["姓名", "工号", "部门", "工作性质"',
	'<th>姓名</th><th>工号</th>',
	'__("姓名"))}</th><th>${escape(__("工号"))',
	'__("姓名"))}</th><th>${frappe.utils.escape_html(__("工号"))',
]) {
	assert.ok(payroll.includes(marker), `薪资表缺少姓名、工号分列标准：${marker}`);
}
assert.doesNotMatch(payroll, /姓名 \/ 工号|员工 \/ 工号|工号\/姓名/);

for (const marker of [
	'["employee_name", "姓名"], ["employee_code", "工号"], ["department", "部门"]',
	'["姓名", "姓名"], ["工号", "工号"], ["部门", "受奖\/惩人部门"]',
	': ["姓名", "工号", "部门", "加工结果"',
]) {
	assert.ok(attendance.includes(marker), `考勤表缺少姓名、工号顺序标准：${marker}`);
}

assert.match(organization, /<th>姓名<\/th><th>工号<\/th><th>花名册职位<\/th>/);
assert.ok(support.includes('<th>${__("姓名")}</th><th>${__("工号")}</th>'));

console.log("Employee table identity columns use the 姓名、工号 standard.");
