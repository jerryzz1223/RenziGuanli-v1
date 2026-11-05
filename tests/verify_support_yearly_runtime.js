const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
let html = '', request;
const output = {text: value => html = value, html: value => html = value};
const context = {Promise, __: text => text, $: () => ({find: () => output}), frappe: {
    pages: {'cross-department-support': {}}, utils: {escape_html: v => String(v).replaceAll('<', '&lt;')},
    call: args => {request = args; return {then: resolve => resolve({message: {year: '2026', rows: [
        {employee: 'EMP-1', employee_name: '<Name>', months: [2, 0, ...Array(9).fill(null), 3], total_count: 5}]}})};}
}};
const source = fs.readFileSync(path.join(__dirname, '../hrms/hr/page/cross_department_support/cross_department_support.js'), 'utf8');
vm.runInNewContext(source + '\nglobalThis.Page = CrossDepartmentSupportPage;', context);
(async () => {
    const page = new context.Page({main: [{}]});
    page.year = {get_value: () => '2026'};
    page.employee = {get_value: () => ''};
    await page.search();
    assert.equal(request.args.year, '2026');
    assert.equal(request.args.employee, null);
    assert(html.includes('2026年合计') && html.includes('<strong>5</strong>'));
    assert(html.includes('<td>0</td>') && html.includes('<td>—</td>'));
    assert(html.includes('&lt;Name>') && !html.includes('<Name>'));
    for (const old of ['open_support_details', 'open_import_dialog', 'open_dispatch_dialog', 'open_records_list']) assert.equal(typeof page[old], 'undefined');
    console.log('annual summary: year filter, 12 months, zero vs unfilled, totals, escaping and removed UI passed');
})().catch(error => {console.error(error); process.exitCode = 1;});
