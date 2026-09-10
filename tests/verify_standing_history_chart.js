const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('hrms/hr/page/payroll_input_center/payroll_input_center.js', 'utf8');
const frappeStub = { pages: { 'payroll-input-center': {} }, utils: { escape_html: (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') } };
const Payroll = vm.runInNewContext(`${source}\nPayrollInputCenter`, {
  frappe: frappeStub,
});
const view = Object.create(Payroll.prototype);
const today = '2026-09-09';
const salary = (name, effective_date, base_salary, extra = {}) => ({ name, effective_date, base_salary, status: '已批准', ...extra });
const rows = [
  salary('initial', '2026-07-01', 3000, { function_allowance: 1000, certificate_allowance: 100, multi_skill_allowance: 50 }),
  salary('old-review', '2026-08-01', 3200, { approved_on: '2026-08-01 10:00:00' }),
  salary('latest-review', '2026-08-01', 3500, { approved_on: '2026-08-01 11:00:00' }),
  salary('pending', '2026-09-01', 9999, { status: '待审核' }),
  salary('rejected', '2026-09-02', 9999, { status: '已驳回' }),
  salary('future', '2026-10-01', 8000),
];
const model = view.standing_history_model(rows.reverse(), '定薪', today);
assert.equal(model.records.length, 6, 'timeline retains pending, rejected and future proposals');
assert.equal(model.points.length, 2, 'only effective approved standards enter chart');
assert.equal(model.points[0].amount, 4150, 'salary components included explicitly');
assert.equal(model.current.row.name, 'latest-review', 'same date uses latest approval');
const chart = view.standing_history_chart(model, '定薪', today);
assert.match(chart, / H [\d.]+ V /, 'effective changes use steps, not interpolated pay');
assert.doesNotMatch(chart, /NaN|Infinity|9999|2026-10-01/);
const contributions = [
  { name: 'enabled', contribution_type: '社保', effective_date: '2026-07-01', status: '已批准', enabled: 1, personal_amount: 500, company_amount: 1200 },
  { name: 'stopped', contribution_type: '社保', effective_date: '2026-09-01', status: '已批准', enabled: 0, personal_amount: 500, company_amount: 1200 },
];
const stopped = view.standing_history_model(contributions, '社保', today);
assert.equal(stopped.current.amount, 0);
assert.equal(stopped.current.company, 0);
assert.match(view.standing_history_chart(stopped, '社保', today), /公司承担/);
assert.match(view.standing_history_chart(view.standing_history_model([], '定薪', today), '定薪', today), /暂无已生效/);
const single = view.standing_history_model([salary('one', today, 0)], '定薪', today);
assert.doesNotMatch(view.standing_history_chart(single, '定薪', today), /NaN|Infinity/);
const historyPageSource = source.slice(source.indexOf('async show_standing_history'), source.indexOf('async load_standing_approvals'));
assert.doesNotMatch(historyPageSource, /new frappe\.ui\.Dialog/, 'personal history is rendered as a full content page, not a dialog');
assert.match(historyPageSource, /data-history-back/, 'full-page history provides an explicit return to the source list');
assert.match(historyPageSource, /hrms-pay-history-record-table/, 'the page includes a structured Excel record table');
assert.match(historyPageSource, /hrms-pay-history-timeline/, 'the original growth-card history remains on the page');
assert.ok(historyPageSource.lastIndexOf('hrms-pay-history-record-table') < historyPageSource.lastIndexOf('hrms-pay-history-timeline'), 'Excel records render above the growth-card history');
assert.match(historyPageSource, /\["生效日期", "状态", "底薪"/, 'salary records expose separate searchable amount and audit columns');
assert.match(source, /standing_history_from_current_route\(\)/, 'personal history can be opened by a stable route from the employee profile');
assert.match(source, /frappe\.set_route\("payroll-input-center", "salary-register"\)/, 'history return clears the employee route and restores the register');
frappeStub.get_route = () => ['payroll-input-center', 'salary-register', 'HR-EMP-0001', '社保', 'employee-detail'];
assert.equal(view.standing_history_from_current_route().employee, 'HR-EMP-0001');
assert.equal(view.standing_history_from_current_route().type, '社保');
assert.equal(view.standing_history_from_current_route().return_to_employee_detail, true);
console.log('Standing history: approval/date boundaries, same-day revisions, salary sum, stopped contributions, charts and full-page record table passed.');
