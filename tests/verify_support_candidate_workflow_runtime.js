const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
let dialog, uploader, route, rendered = 0, searches = 0, optionsLoaded = 0, templates = 0;
const handlers = {};
const body = {html() {}, text() {}, find: selector => ({on: (event, fn) => handlers[selector] = fn})};
const context = {Promise, __: text => text, frappe: {
    pages: {'cross-department-support': {}}, utils: {escape_html: String},
    datetime: {get_today: () => '2026-10-30'},
    set_route: (...args) => route = args, show_alert() {},
    ui: {
        Dialog: function(options) {
            dialog = this; this.primary = options.primary_action;
            this.fields_dict = {import_content: {$wrapper: body}};
            this.set_primary_action = (label, action) => this.primary = action;
            this.show = () => {}; this.hide = () => {};
        },
        FileUploader: function(options) {uploader = options;}
    },
    call: args => ({then: resolve => resolve({message: args.method.includes('preview_') ?
        {can_import: true, total: 1, rows: []} : {inserted: 1}})})
}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,
    '../hrms/hr/page/cross_department_support/cross_department_support.js'), 'utf8') +
    '\nglobalThis.Page = CrossDepartmentSupportPage;', context);
(async () => {
    const page = new context.Page({main: [{}]});
    page.search = () => searches++;
    page.load_filter_options = () => optionsLoaded++;
    page.download_import_template = () => templates++;
    page.open_import_dialog();
    handlers['[data-download-import-template]']();
    assert.equal(templates, 1);
    dialog.primary();
    uploader.on_success({file_url: '/private/files/test.xlsx'});
    page.page_number = 3;
    dialog.primary();
    assert.equal(searches, 1);
    assert.equal(optionsLoaded, 1);
    assert.equal(page.page_number, 1);

    context.frappe.call = () => ({then: resolve => resolve({message: {counts_ready: true}})});
    await page.open_records_list('EMP-1');
    assert.equal(context.frappe.route_options.employee, 'EMP-1');
    assert.deepEqual(route, ['List', 'Cross Department Support Record']);
    await page.open_records_list();
    assert.equal(Object.keys(context.frappe.route_options).length, 0);

    // Optional history loading must never remove otherwise dispatchable candidates.
    delete page.search;
    page.render_results = () => rendered++;
    context.frappe.call = args => args.method.endsWith('get_available_support_candidates') ?
        {then: resolve => resolve({message: {rows: [{name: 'CAP-1', employee: 'EMP-1'}], count: 1}})} :
        {then: (resolve, reject) => reject(new Error('ledger unavailable'))};
    page.search();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.rows.length, 1);
    assert.equal(rendered, 1);
    console.log('support import refresh, template action, employee record filter and optional-history failure passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
