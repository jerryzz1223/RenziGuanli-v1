const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../hrms/hr/employee_property_update.js'), 'utf8');
const calls = [];
const messages = [];
let confirmation;
const fail = message => { throw new Error(message); };
const stub = { find() { return this; }, text() { return this; } };
const ctx = vm.createContext({
	cur_frm: { doctype: 'Employee Transfer' },
	__: (s, args = []) => s.replace(/\{(\d+)\}/g, (_, n) => args[n]),
	frappe: { ui: { form: { on() {} } }, call(opts) { calls.push(opts); }, msgprint(s) { messages.push(s); }, throw: fail, confirm(message, callback) { confirmation = callback; } },
});
vm.runInContext(source, ctx);
ctx.render_transfer_property_editor = () => {};
const form = () => ({
	doc: { employee: 'employee-a', docstatus: 0, transfer_details: [] },
	fields_dict: { transfer_details: { $wrapper: stub } },
	add_child(table, row) { this.doc[table].push({ ...row, name: `row-${this.doc[table].length}` }); },
	refresh_field() {}, dirty() {},
});
const reply = (call) => call.callback({ message: { value: '原值', label: call.args.fieldname } });
(async () => {
	const frm = form();
	const pending = ctx.add_inline_transfer_property(frm, 'transfer_details', 'department');
	assert.equal(calls.length, 2, '部门必须同时读取岗位');
	await ctx.add_inline_transfer_property(frm, 'transfer_details', 'department');
	await ctx.add_inline_transfer_property(frm, 'transfer_details', 'designation');
	assert.equal(calls.length, 2, '重复点击和重叠的部门/岗位请求必须去重');
	calls.splice(0).forEach(reply);
	await pending;
	assert.deepEqual(frm.doc.transfer_details.map(row => row.fieldname), ['department', 'designation']);
	assert.equal(frm.__hrms_transfer_pending_fields.size, 0);
	assert.equal(ctx.get_transfer_property_groups(frm.doc.transfer_details).length, 1);

	const switched = form();
	const stale = ctx.add_inline_transfer_property(switched, 'transfer_details', 'grade');
	switched.doc.employee = 'employee-b';
	calls.splice(0).forEach(reply);
	await stale;
	assert.equal(switched.doc.transfer_details.length, 0, '不能将旧员工的读取结果写入新员工');

	const cleared = form();
	const staleTable = ctx.add_inline_transfer_property(cleared, 'transfer_details', 'grade');
	cleared.doc.transfer_details = [];
	calls.splice(0).forEach(reply);
	await staleTable;
	assert.equal(cleared.doc.transfer_details.length, 0, '表格清空后必须丢弃旧请求');

	const submitted = form();
	const staleStatus = ctx.add_inline_transfer_property(submitted, 'transfer_details', 'grade');
	submitted.doc.docstatus = 1;
	calls.splice(0).forEach(reply);
	await staleStatus;
	assert.equal(submitted.doc.transfer_details.length, 0);
	await ctx.add_inline_transfer_property(submitted, 'transfer_details', 'grade');
	assert.equal(calls.length, 0, '已提交单据不能添加变更');

	const failed = form();
	const failure = ctx.add_inline_transfer_property(failed, 'transfer_details', 'grade');
	calls.shift().error(new Error('network'));
	await failure;
	assert.equal(failed.__hrms_transfer_pending_fields.size, 0, '失败后必须解除读取状态');
	assert.equal(messages.length, 1);
	const retry = ctx.add_inline_transfer_property(failed, 'transfer_details', 'grade');
	calls.splice(0).forEach(reply);
	await retry;
	assert.equal(failed.doc.transfer_details.length, 1, '失败后允许重新添加');

	let progress;
	stub.text = value => { progress = value; return stub; };
	failed.doc.transfer_details.push({ fieldname: 'custom_is_confirmed', new: 0 });
	ctx.update_transfer_property_progress(failed, 'transfer_details');
	assert.match(progress, /1\/2/, '数值 0 是已填写的有效值');

	const managers = [
		{ name: 'm1', employee_code: '1001', employee_name: '同名' },
		{ name: 'm2', employee_code: '1002', employee_name: '同名' },
		{ name: 'm3', employee_code: '1003', employee_name: '唯一姓名' },
	];
	assert.equal(ctx.match_transfer_manager(managers, '同名'), null);
	assert.equal(ctx.match_transfer_manager(managers, '1002').name, 'm2');
	assert.equal(ctx.match_transfer_manager(managers, '1001 · 同名').name, 'm1');
	assert.equal(ctx.match_transfer_manager(managers, '唯一姓名').name, 'm3');
	assert.equal(ctx.match_transfer_manager(managers, '不存在'), null);

	const check = form();
	assert.throws(() => ctx.validate_inline_transfer_details(check), /至少选择/);
	check.doc.transfer_details = [{ fieldname: 'grade', property: '职级', current: 'G1', new: '' }];
	assert.throws(() => ctx.validate_inline_transfer_details(check), /请填写职级/);
	check.doc.transfer_details[0].new = 'G1';
	assert.throws(() => ctx.validate_inline_transfer_details(check), /不能相同/);
	check.doc.transfer_details[0].new = 'G2';
	ctx.validate_inline_transfer_details(check);
	check.__hrms_transfer_pending_fields = new Set(['grade']);
	assert.throws(() => ctx.validate_inline_transfer_details(check), /正在读取/);
	check.__hrms_transfer_pending_fields.clear();
	check.doc.transfer_details = [{ fieldname: 'department', property: '部门', current: 'D1', new: 'D2' },
		{ fieldname: 'designation', property: '岗位', current: '同一岗位', new: '同一岗位' }];
	ctx.validate_inline_transfer_details(check);
	check.doc.transfer_details.pop();
	assert.throws(() => ctx.validate_inline_transfer_details(check), /同时选择新岗位/);
	check.doc.transfer_details = [{ fieldname: 'reports_to', property: '直属上级', new: check.doc.employee }];
	assert.throws(() => ctx.validate_inline_transfer_details(check), /员工本人/);

	const removal = form();
	removal.doc.transfer_details = [{ name: 'd', fieldname: 'department', new: 'D2' }, { name: 'p', fieldname: 'designation', new: 'P2' }];
	const removed = [];
	ctx.frappe.model = { clear_doc(doctype, name) { removed.push(name); removal.doc.transfer_details = removal.doc.transfer_details.filter(row => row.name !== name); } };
	ctx.remove_inline_transfer_property(removal, 'transfer_details', 'department');
	assert.equal(removed.length, 0, '已填写的内容应等待确认');
	assert.equal(typeof confirmation, 'function');
	confirmation();
	assert.deepEqual(removed, ['d', 'p'], '部门与岗位需一起移除');


	const departmentQuery = form();
	departmentQuery.doc.department = 'old-department';
	assert.equal(ctx.get_transfer_target_department(departmentQuery, 'transfer_details'), 'old-department');
	departmentQuery.doc.transfer_details = [{ fieldname: 'department', new: '' }];
	assert.equal(ctx.get_transfer_target_department(departmentQuery, 'transfer_details'), '__hrms_department_required__');
	departmentQuery.doc.transfer_details[0].new = 'new-department';
	assert.equal(ctx.get_transfer_target_department(departmentQuery, 'transfer_details'), 'new-department');
	const readOnly = form();
	readOnly.perm = [{ read: 1, write: 0 }];
	await ctx.add_inline_transfer_property(readOnly, 'transfer_details', 'grade');
	assert.equal(calls.length, 0, '只读草稿不可添加项目');
	assert.equal(ctx.can_edit_transfer_properties(readOnly), false);
	readOnly.perm[0].write = 1;
	assert.equal(ctx.can_edit_transfer_properties(readOnly), true);
	const late = form();
	late.doc.transfer_details = [{ name: 'g', fieldname: 'grade', new: 'G2' }];
	ctx.remove_inline_transfer_property(late, 'transfer_details', 'grade');
	late.doc.docstatus = 1;
	confirmation();
	assert.equal(late.doc.transfer_details.length, 1, '确认期间已提交单据不可被修改');
	console.log('Employee Transfer editor runtime passed: deduplication, stale responses, read-only state, retry, progress, manager matching, validation, removal and permissions.');
})().catch(error => { console.error(error); process.exitCode = 1; });
