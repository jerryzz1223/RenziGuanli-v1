const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../hrms/hr/page/cross_department_support/cross_department_support.js'), 'utf8');
let dialog, request, state = '';
const output = {text: value => state = value, html: value => state = value};
const escape = value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const context = {Promise, __: value => value, frappe: {
    pages: {'cross-department-support': {}},
    datetime: {get_today: () => '2026-10-23'},
    utils: {escape_html: escape},
    ui: {Dialog: function(options) {dialog = this; this.options = options; this.fields_dict = {counts: {$wrapper: output}}; this.show = () => {}; }},
    call: args => {request = args; return {then: resolve => resolve({message: {month: '<2026-10>', monthly_count: 2, total_count: 3, counting_rule: '<rule>', months: [{month: '2026-10', count: 2}]}})};},
}};
vm.createContext(context);
vm.runInContext(source + '\nthis.SupportPage = CrossDepartmentSupportPage;', context);
(async () => {
    const page = new context.SupportPage({main: [{}]});
    page.open_counts_dialog();
    assert(state.includes('草稿和取消不计次'));
    await dialog.options.primary_action({employee: 'EMP-1', month: '2026-10'});
    assert.strictEqual(request.method, 'hrms.api.cross_department_support.get_employee_support_counts');
    assert.strictEqual(request.args.employee, 'EMP-1');
    assert(state.includes('&lt;rule&gt;') && !state.includes('<rule>'));
    assert(state.includes('累计支援次数') && state.includes('：3'));
    context.frappe.call = () => ({then: (resolve, reject) => reject(new Error('denied'))});
    await dialog.options.primary_action({employee: 'EMP-1'});
    assert(state.includes('查询失败'));
    console.log('support count dialog: then-only Deferred success, escaping and rejection passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
