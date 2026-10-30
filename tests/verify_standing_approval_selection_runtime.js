const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../hrms/hr/page/payroll_input_center/payroll_input_center.js'), 'utf8');
const requests = [];
let confirmed;
const records = [
	{ name: 'salary-a', decision_doctype: 'HRMS Employee Salary Change', submitted_by: 'other' },
	{ name: 'salary-self', decision_doctype: 'HRMS Employee Salary Change', submitted_by: 'reviewer' },
	{ name: 'social-b', decision_doctype: 'HRMS Employee Contribution', submitted_by: 'other' },
];
const frappe = {
	pages: { 'payroll-input-center': {} }, session: { user: 'reviewer' },
	utils: { escape_html: String },
	call: async (request) => {
		if (request.method.endsWith('list_pending')) return { message: records };
		requests.push(request);
		return { message: { approved_count: 1 } };
	},
	prompt: (_fields, callback) => callback({ review_note: '核对通过' }),
	confirm: (_message, callback) => { confirmed = callback(); },
	show_alert() {}, msgprint() {},
};
const context = vm.createContext({ frappe });
vm.runInContext(`${source}\nthis.Center = PayrollInputCenter;`, context);
const center = Object.create(context.Center.prototype);
const control = () => ({ checked: false, disabled: false, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
const all = control(), approve = control(), counter = { textContent: '' }, table = {};
const rows = records.map((_record, index) => {
	const input = control();
	input.disabled = index === 1;
	const row = { dataset: { tableFilterMatch: '1' }, hidden: index === 2, querySelector: () => input };
	input.closest = () => row;
	return { row, input };
});
const target = {
	isConnected: true,
	querySelector(selector) {
		if (selector === 'table') return table;
		if (selector === '[data-standing-select-filtered]') return all;
		if (selector === '[data-standing-approve-all]') return approve;
		if (selector === '[data-standing-selection-count]') return counter;
		const match = selector.match(/data-standing-index="(\d+)"/);
		return match ? rows[Number(match[1])].row : null;
	},
	querySelectorAll(selector) { return selector === '[data-standing-select]' ? rows.map(({ input }) => input) : []; },
};
Object.assign(center, { company: 'ACME', can_approve_standing: () => true,
	standing_approval_change: () => '', standing_time: () => '', apply_pending_payroll_employee_filter() {},
	resume_pending_payroll_calculation() { this.resumed = true; } });
(async () => {
	await center.load_standing_approvals(target);
	assert.equal(approve.disabled, true);
	all.checked = true;
	all.listeners.change();
	assert.deepEqual(rows.map(({ input }) => input.checked), [true, false, true], 'Select filtered rows across pages but exclude self-review');
	assert.equal(counter.textContent, '已选 2 条');
	rows[2].row.dataset.tableFilterMatch = '0';
	table.syncStandingSelection();
	assert.equal(rows[2].input.checked, false, 'Filtering clears hidden selections');
	assert.equal(counter.textContent, '已选 1 条');
	rows[2].row.dataset.tableFilterMatch = '1';
	table.syncStandingSelection();
	assert.equal(all.indeterminate, true);
	assert.equal(rows[2].input.checked, false, 'Clearing filter must not restore stale selections');
	approve.listeners.click();
	await confirmed;
	assert.equal(requests.length, 1);
	assert.deepEqual(JSON.parse(requests[0].args.requests), [{ decision_doctype: records[0].decision_doctype, name: 'salary-a' }]);
	assert.equal(requests[0].args.company, 'ACME');
	assert.equal(requests[0].args.review_note, '核对通过');
	assert.equal(center.resumed, true);
	rows[0].input.checked = false;
	rows[0].input.listeners.change();
	assert.equal(approve.disabled, true);
	assert.equal(all.indeterminate, false);
	assert.equal(counter.textContent, '已选 0 条');
	console.log('Standing approval selection runtime passed: cross-page selection, self-review exclusion, filter clearing, exact request payload and payroll resume.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
