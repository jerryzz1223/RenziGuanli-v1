const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('hrms/hr/page/payroll_input_center/payroll_input_center.js', 'utf8');
const css = fs.readFileSync('hrms/hr/page/payroll_input_center/payroll_input_center.css', 'utf8');
const Payroll = vm.runInNewContext(`${source}\nPayrollInputCenter`, {
  frappe: {
    pages: { 'payroll-input-center': {} },
    utils: { escape_html: (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') },
  },
});
const view = Object.create(Payroll.prototype);

const social = view.standing_approval_change({
  contribution_type: '社保', enabled: 1, personal_amount: 0, company_amount: 1256.82,
  previous_standard: { enabled: 1, personal_amount: 791.45, company_amount: 1900.96 },
});
assert.match(social, /当前标准/);
assert.match(social, /申请后标准/);
assert.doesNotMatch(social, /缴费状态/);
assert.doesNotMatch(social, /正常/);
assert.doesNotMatch(social, /缴纳/);
assert.match(social, /791\.45/);
assert.match(social, /0\.00/);
assert.match(social, /1,900\.96/);
assert.match(social, /1,256\.82/);

const salary = view.standing_approval_change({
  base_salary: 3333, function_allowance: 3094, certificate_allowance: 0, multi_skill_allowance: 0,
  previous_standard: { base_salary: 3170, function_allowance: 3094, certificate_allowance: 0, multi_skill_allowance: 0 },
});
assert.match(salary, /底薪/);
assert.match(salary, /3,170\.00/);
assert.match(salary, /3,333\.00/);
assert.doesNotMatch(salary, /职能津贴/);
assert.doesNotMatch(salary, /证书津贴/);
assert.doesNotMatch(salary, /多能工津贴/);
const salaryHistory = view.standing_approval_change({
  base_salary: 3333, function_allowance: 3094, certificate_allowance: 0, multi_skill_allowance: 0,
  previous_standard: { base_salary: 3370, function_allowance: 3094, certificate_allowance: 0, multi_skill_allowance: 0 },
}, 'history');
assert.match(salaryHistory, /项目/);
assert.match(salaryHistory, /原始标准/);
assert.match(salaryHistory, /修改后标准/);
assert.match(salaryHistory, /3,370\.00/);
assert.match(salaryHistory, /3,333\.00/);
assert.match(css, /\.hrms-standing-change-grid\s*\{[^}]*grid-template-columns:\s*1fr/);
assert.match(css, /\.hrms-standing-change-item\s*\{[^}]*grid-template-columns:\s*82px 92px 18px 92px/);

const initial = view.standing_approval_change({ contribution_type: '公积金', enabled: 1, personal_amount: 248, company_amount: 248 });
assert.match(initial, /首次建立公积金标准/);
assert.match(initial, /未设置/);
assert.match(initial, /248\.00/);
console.log('Approval change summary: only changed fields and first-entry state passed.');
