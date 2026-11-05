const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../hrms/hr/page/cross_department_support/cross_department_support.js'), 'utf8');
let dialog, state = '', requests = [], pending = [];
const output = {text: value => state = value, html: value => state = value};
const escape = value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const context = {Promise, __: value => value, frappe: {
    pages: {'cross-department-support': {}}, datetime: {get_today: () => '2026-11-02'},
    utils: {escape_html: escape}, show_alert() {},
    ui: {Dialog: function(options) {
        dialog = this; this.options = options; this.values = {};
        options.fields.forEach(f => this.values[f.fieldname] = f.default);
        this.fields_dict = {counts: {$wrapper: output}};
        this.get_value = name => this.values[name];
        this.set_value = (name, value) => {this.values[name] = value; return options.fields.find(f => f.fieldname === name).change?.();};
        this.get_primary_btn = () => ({prop: (key, value) => this.disabled = value});
        this.show = () => {};
    }},
    call: args => {requests.push(args); return {then: resolve => pending.push(resolve)};},
}};
vm.createContext(context);
vm.runInContext(source + '\nthis.SupportPage = CrossDepartmentSupportPage;', context);
const tick = () => new Promise(resolve => setImmediate(resolve));
const result = count => ({message: {month: '2026-11', monthly_count: count, total_count: count, can_edit: true,
    counting_rule: '<rule>', months: [{month: '2026-11', count}]}});
(async () => {
    const page = new context.SupportPage({main: [{}]});
    page.search = () => {};
    page.open_counts_dialog('EMP-1');
    assert(dialog.disabled);
    await tick(); pending.shift()(result(2)); await tick();
    assert.equal(dialog.values.support_count, 2);
    assert(!dialog.disabled);
    assert(state.includes('再次保存会更新'));
    dialog.set_value('support_count', 0);
    const saving = dialog.options.primary_action({...dialog.values});
    dialog.options.primary_action({...dialog.values});
    await tick();
    assert.equal(requests.filter(r => r.method.endsWith('save_monthly_support_count')).length, 1);
    assert.equal(requests.at(-1).args.support_count, 0);
    pending.shift()({message: {name: 'MONTH-1'}}); await tick();
    pending.shift()(result(0)); await saving;
    assert.equal(dialog.values.support_count, 0);
    // A slow response for a previous month must not overwrite the selected month.
    dialog.set_value('month', '2026-10'); await tick();
    dialog.set_value('month', '2026-09'); await tick();
    const old = pending.shift(), latest = pending.shift();
    latest(result(9)); await tick(); old(result(10)); await tick();
    assert.equal(dialog.values.support_count, 9);
    assert.equal(typeof page.open_dispatch_dialog, 'undefined');
    console.log('monthly count dialog: save zero, Deferred, double-click guard, escaping and stale responses passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
