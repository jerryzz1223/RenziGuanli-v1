const assert = require("node:assert/strict");
const fs = require("node:fs");

const employeeList = fs.readFileSync("hrms/public/js/erpnext/employee_list.js", "utf8");
const employeeDetail = fs.readFileSync("hrms/hr/page/employee_detail/employee_detail.js", "utf8");
const employeeApi = fs.readFileSync("hrms/api/employee_field_template.py", "utf8");

for (const obsolete of ["standing_salary_summary", "standing_social_summary", "standing_housing_summary", "当前定薪"]) {
  assert.ok(!employeeList.includes(obsolete), `roster homepage must not contain pay summary marker: ${obsolete}`);
}
for (const marker of [
  "render_standing_pay_summary",
  "standing_pay_summary",
  "当前工资社保标准",
  "当前定薪",
  "当前社保",
  "当前公积金",
  "data-standing-pay-history",
  'frappe.set_route("payroll-input-center", "salary-register", this.employee',
]) {
  assert.ok(employeeDetail.includes(marker), `employee pay tab missing marker: ${marker}`);
}
assert.match(employeeApi, /def _get_employee_standing_pay_summary/);
assert.match(employeeApi, /from hrms\.payroll\.standing_permissions import can_submit/);
assert.match(employeeApi, /"status": "已批准"/);
assert.match(employeeApi, /"effective_date": \["<=", as_of\]/);

console.log("Employee profile pay tab shows current standards and routed history links; roster homepage stays unchanged.");
