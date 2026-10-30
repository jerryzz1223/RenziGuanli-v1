const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let events, options = {}, hidden, css, dialog, html = '';
const handlers = {};
const scope = {length: 1, closest() {return this;}, addClass() {}, find(selector) {hidden = selector; return {hide() {}};}};
const context = {Promise, Set, document: {head: {}, getElementById: () => false},
    $: (tag, attrs) => {css = attrs.text; return {appendTo() {}};}, __: text => text,
    frappe: {pages: {'cross-department-support': {}}, utils: {escape_html: value => String(value).replaceAll('<', '&lt;').replaceAll('"','&quot;')},
        ui: {form: {on: (name, value) => events = value}},
        call: () => ({then: resolve => resolve({message: {
            departments: ['Imported Department', 'Other Department'],
            designations: ['Imported Job', 'Other Job'], master_designations: [],
            pairs: [{department: 'Imported Department', designation: 'Imported Job'}, {department: 'Other Department', designation: 'Other Job'}]
        }})}), show_alert() {}}
};
const root = path.join(__dirname, '..');
vm.runInNewContext(fs.readFileSync(path.join(root, 'hrms/hr/doctype/cross_department_support_capability/cross_department_support_capability.js'), 'utf8'), context);
(async () => {
    const frm = {doc: {support_department: 'Legacy Department', support_designation: 'Legacy Job'},
        page: {wrapper: scope, set_title() {}}, is_new: () => false, toggle_display() {}, add_custom_button() {},
        set_df_property: (field, property, values) => options[field] = values,
        refresh_field() {}, set_value: (field, value) => frm.doc[field] = value};
    events.refresh(frm);
    await new Promise(resolve => setImmediate(resolve));
    assert(hidden.includes('.form-sidebar') && hidden.includes('.form-footer') && hidden.includes('.form-timeline'));
    assert(css.includes('.hrms-support-capability-form .form-sidebar'));
    assert(options.support_department.includes('Legacy Department'));
    assert(options.support_designation.includes('Legacy Job'));
    frm.doc.support_department = 'Other Department';
    events.support_department(frm);
    assert(options.support_designation.includes('Other Job'));
    assert(!options.support_designation.includes('Imported Job'));
    assert.equal(frm.doc.support_designation, '');

    const body = {text() {}, html: value => html = value,
        find: selector => ({on: (event, fn) => handlers[selector] = fn})};
    context.frappe.ui.Dialog = function(opts) {dialog = opts; this.fields_dict = {detail: {$wrapper: body}}; this.show = () => {};};
    vm.runInNewContext(fs.readFileSync(path.join(root, 'hrms/hr/page/cross_department_support/cross_department_support.js'), 'utf8') + '\nglobalThis.Page = CrossDepartmentSupportPage;', context);
    const page = new context.Page({main: [{}]});
    context.frappe.call = () => ({then: resolve => resolve({message: {records_ready: false, exclusions_ready: false, counts: null}})});
    page.open_support_details({name: 'CAP-1', employee: 'EMP-1', employee_name: '<Name>', support_department: '<Department>'});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dialog.size, 'large');
    assert.equal(dialog.primary_action_label, '编辑支援能力');
    assert(html.includes('support-info__stats') && html.includes('support-info__actions'));
    assert(!html.includes('<Name>') && html.includes('&lt;Name>'));
    assert(html.includes('disabled') && html.includes('排除功能暂不可用'));
    assert(!html.includes('迁移') && !html.includes('btn-group'));
    assert(handlers['[data-view-records]'] && handlers['[data-exclude]']);
    console.log('support form: scoped chrome hiding, imported dropdown values, department change and dialog cards passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
