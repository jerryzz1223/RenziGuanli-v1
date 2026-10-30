const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let dialog, dispatches = [], searches = 0, alerts = 0;
const context = {Promise, Date, Math, Set, __: text => text,
    frappe: {pages: {'cross-department-support': {}}, datetime: {get_today: () => '2026-10-30'},
        ui: {Dialog: function(options) {
            dialog = this; this.options = options; this.values = {}; this.props = {}; this.fields_dict = {notice: {$wrapper: {text() {}}}};
            for (const f of options.fields) this.values[f.fieldname] = f.default;
            this.get_value = name => this.values[name];
            this.set_value = (name, value) => {this.values[name] = value; options.fields.find(f => f.fieldname === name)?.change?.();};
            this.set_df_property = (name, prop, value) => {this.props[name] ||= {}; this.props[name][prop] = value;};
            this.get_primary_btn = () => ({prop: (key, value) => this.disabled = value});
            this.show = () => {}; this.hide = () => this.hidden = true;
        }}, show_alert: () => alerts++, call: args => ({then: resolve => {
            if (args.method.endsWith('get_dispatch_options')) resolve({message: {can_add: true, can_dispatch: true, capabilities: [
                {support_department: 'Dept', support_designation: 'Job'},
                {support_department: 'Dept', support_designation: 'Job 2'}]}});
            else {dispatches.push(args); resolve({message: {name: 'RECORD-1'}});}
        }})}
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../hrms/hr/page/cross_department_support/cross_department_support.js'), 'utf8') + '\nglobalThis.Page = CrossDepartmentSupportPage;', context);
(async () => {
    const page = new context.Page({main: [{}]});
    page.search = () => searches++;
    page.load_filter_options = () => {};
    const row = {name: 'CAP-1', employee: 'EMP-1', employee_name: 'Person', support_department: 'Dept', support_designation: 'Job'};
    page.open_dispatch_dialog(row);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dialog.values.support_designation, 'Job');
    assert.equal(dialog.options.primary_action_label, '确认派出');
    assert(!dialog.options.fields.some(f => f.fieldname === 'detail'));
    assert(dialog.props.support_designation.options.includes('Job 2'));
    assert(dialog.props.support_designation.options.some(v => v.value === '__new_support_job__'));
    dialog.set_value('support_designation', '__new_support_job__');
    assert.equal(dialog.props.new_designation.hidden, false);
    assert.equal(dialog.props.new_designation.reqd, true);
    const values = {...dialog.values, new_designation: 'New Job'};
    const saving = dialog.options.primary_action(values);
    dialog.options.primary_action(values);
    await saving;
    assert.equal(dispatches.length, 1, 'double clicks must not send two dispatches');
    assert.equal(dispatches[0].args.support_designation, 'New Job');
    assert.equal(dispatches[0].args.add_new, 1);
    assert(dispatches[0].args.request_id.length >= 16);
    assert.equal(searches, 1);
    assert.equal(alerts, 1);
    assert(dialog.hidden);
    console.log('support dispatch: direct form, existing/new job selection, persistence payload and double-click guard passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
