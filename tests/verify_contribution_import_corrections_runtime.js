const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('hrms/hr/page/payroll_input_center/payroll_input_center.js', 'utf8');
const cacheScript = fs.readFileSync('hrms/public/js/hrms_payroll_page_cache.js', 'utf8');
const cacheKey = '_page:payroll-input-center';
for (const [cached, removed] of [
	[JSON.stringify([{ name: 'payroll-input-center', script: 'old preview' }]), true],
	[JSON.stringify([{ name: 'payroll-input-center', script: source }]), false],
	[null, false],
]) {
	const deleted = [];
	vm.runInNewContext(cacheScript, { localStorage: { getItem: () => cached, removeItem: (key) => deleted.push(key) }, console });
	assert.deepEqual(deleted, removed ? [cacheKey] : []);
}
let upload, clicked;
const dialogs = [], requests = [];
const row = { row_id: '0:74', source_sheet: '公积金名单', source_row: 74, employee_code: '9999', employee_name: '姓名有误', contribution_type: '公积金', personal_amount: '270', company_amount: '270', request_mode: 'initial', error: '工号、姓名或公司不匹配' };
const valid = { ...row, row_id: '0:1', source_row: 1, employee_code: '2001', employee_name: '原本通过员工', error: '' };
class Dialog {
	constructor(options) {
		this.options = options; this.disabled = false;
		this.button = { prop: (_key, value) => { this.disabled = value; } };
		this.fields_dict = { preview: { $wrapper: { html: (html) => { this.html = html; }, find: () => ({ on: (_event, callback) => { clicked = callback; } }) } } };
		dialogs.push(this);
	}
	get_primary_btn() { return this.button; }
	show() { this.visible = true; }
	hide() { this.visible = false; }
}
const frappe = { pages: { 'payroll-input-center': {} }, datetime: { get_today: () => '2026-11-04' },
	utils: { escape_html: (s) => String(s).replaceAll('<', '&lt;') }, ui: { Dialog, FileUploader: class { constructor(options) { upload = options.on_success; } } },
	prompt: (_fields, callback) => callback({ effective_date: '2026-11-04' }), msgprint() {} };
const context = vm.createContext({ frappe });
vm.runInContext(`${source}\nthis.Center = PayrollInputCenter;`, context);
const center = Object.create(context.Center.prototype);
Object.assign(center, { company: 'ACME', load_contribution_register() { this.reloaded = true; },
	async call_payroll_api(request) {
		requests.push(request);
		if (!request.args.preview) return { message: { submitted: 1 } };
		const fixes = JSON.parse(request.args.corrections || '{}');
		if (!fixes[row.row_id]) return { message: { errors: [row.error], rows: [valid], entries: [valid, row] } };
		const fixed = { ...row, ...fixes[row.row_id], error: '', correction_reason: fixes[row.row_id].reason };
		return { message: { errors: [], rows: [valid, fixed], entries: [valid, fixed] } };
	} });
(async () => {
	center.import_standing_contributions();
	await upload({ file_url: '/private/files/contribution.xlsx' });
	const preview = dialogs[0];
	assert.equal(preview.disabled, true);
	assert.match(preview.html, /修改本行/);
	assert.match(preview.html, /姓名有误/);
	const initialBody = preview.html.split('<tbody>')[1];
	assert.ok(initialBody.indexOf('姓名有误') < initialBody.indexOf('原本通过员工'), 'Error rows must be placed first');
	assert.match(initialBody, /^<tr class="hrms-contribution-import-error">/);
	assert.match(preview.html, /校验未通过 1 条，已置顶标红；校验通过 1 条/);
	assert.match(preview.html, /background-color: #fff1f0 !important; color: #b42318 !important/);
	clicked({ currentTarget: { dataset: { correctContribution: '0' } } });
	const editor = dialogs[1];
	assert.equal(editor.options.fields.find((f) => f.fieldname === 'employee_code').default, '9999');
	await editor.options.primary_action({ employee_code: '1001', employee_name: '正确姓名', personal_amount: '248', company_amount: '248', reason: '核对后修正', mode: '首次录入' });
	assert.equal(preview.disabled, false);
	assert.match(preview.html, /正确姓名/);
	assert.match(preview.html, /核对后修正/);
	const correctedBody = preview.html.split('<tbody>')[1];
	assert.doesNotMatch(correctedBody, /hrms-contribution-import-error/);
	assert.ok(correctedBody.indexOf('原本通过员工') < correctedBody.indexOf('正确姓名'), 'Passing rows return to source order');
	assert.match(preview.html, /校验未通过 0 条，已置顶标红；校验通过 2 条/);
	assert.equal(editor.visible, false);
	await preview.options.primary_action();
	const submitted = requests.at(-1);
	assert.equal(submitted.args.preview, 0);
	const fix = JSON.parse(submitted.args.corrections)[row.row_id];
	assert.equal(fix.employee_code, '1001');
	assert.equal(fix.reason, '核对后修正');
	assert.equal(center.reloaded, true);
	assert.equal(preview.visible, false);
	console.log('Contribution corrections runtime passed: cache invalidation, error-row editor, full revalidation and corrected submission.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
