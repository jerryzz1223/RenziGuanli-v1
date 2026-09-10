const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('hrms/hr/page/payroll_input_center/payroll_input_center.js', 'utf8');
const Payroll = vm.runInNewContext(`${source}\nPayrollInputCenter`, { frappe: { pages: { 'payroll-input-center': {} } } });
const view = Object.create(Payroll.prototype);
const rows = view.contribution_view_rows({
  employees: [{ employee: 'a' }, { employee: 'b' }, { employee: 'c' }],
  initialized: [{ employee: 'b', contribution_type: '社保' }],
  contributions: [
    { employee: 'a', contribution_type: '社保', enabled: '1', personal_amount: 524.96, company_amount: 1256.82 },
    { employee: 'a', contribution_type: '公积金', enabled: 1, personal_amount: 248, company_amount: 248 },
    { employee: 'c', contribution_type: '社保', enabled: '0', personal_amount: 999, company_amount: 999 },
    { employee: 'c', contribution_type: '公积金', enabled: 1, personal_amount: 0, company_amount: 10.01 },
  ],
});
assert.equal(rows[0].personal, 77296, 'sum using cents, not rounded integer yuan');
assert.equal(rows[0].company, 150482);
assert.equal(rows[0].missing, false);
assert.equal(rows[1].missing, true);
assert.equal(rows[1].items[0].pending, true, 'submitted but not effective is distinct from no archive');
assert.equal(rows[1].items[1].pending, false);
assert.equal(rows[2].stopped, true);
assert.equal(rows[2].personal, 0, 'stopped record must not add historical amount');
assert.equal(rows[2].company, 1001);
assert.equal(rows[2].missing, false, 'zero contributions and stops are valid standards');
assert.equal(view.standing_amounts({ contribution_type: '社保', enabled: 1, personal_amount: 248, company_amount: 500 }), '个人 248 / 公司 500');
assert.doesNotMatch(view.standing_amounts({ contribution_type: '社保', enabled: 1, personal_amount: 248, company_amount: 500 }), /缴纳/);
assert.match(view.standing_amounts({ contribution_type: '社保', enabled: 0, personal_amount: 0, company_amount: 0 }), /^停缴 · /);
console.log('Contribution view: exact amounts, missing standards, pending standards, stopped and zero contributions passed.');
