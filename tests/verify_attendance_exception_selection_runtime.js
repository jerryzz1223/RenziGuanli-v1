const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = {
    frappe: { pages: { 'attendance-import-center': {} }, utils: { escape_html: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') } },
    __: (text, args = []) => text.replace(/\{(\d+)\}/g, (_, index) => args[index] ?? `{${index}}`),
};
vm.runInNewContext(fs.readFileSync(process.env.ATTENDANCE_SELECTION_SOURCE || path.join(__dirname,
    '../hrms/hr/page/attendance_import_center/attendance_import_center.js'), 'utf8') +
    '\nglobalThis.Controller = AttendanceImportCenter;', context);

function page() {
    return Object.assign(Object.create(context.Controller.prototype), {
        exception_source_filter: 'attendance_draft', exception_department_filter: '',
        exception_code_filter: '', exception_processing_status_filter: 'pending',
        exception_employee_name_filter: '', exception_employee_code_filter: '',
        exception_sort_field: 'employee_code', exception_sort_order: 'asc',
        processing_result_sources: [], exception_sources: [], exception_department_options: [], exception_page: 1, exception_page_size: 20,
        selected_exception_record_ids: new Set(), select_all_filtered_exceptions: false,
        filtered_pending_exception_count: 100,
    });
}
const rows = [{ record_id: 'R', source_type: 'attendance_draft', daily_exception_lines: [
    { daily_record_id: 'D1', attendance_date: '2026-08-10', exception_codes: ['CLOCK_IN_MISSING'] },
    { daily_record_id: 'D2', attendance_date: '2026-08-13', exception_codes: ['LATE_MARKED'] },
    { daily_record_id: 'D3', attendance_date: '2026-08-14', resolved: true, review_status: '已处理异常' },
] }];
function header(markup) {
    return markup.match(/<input[^>]*data-select-exception-all[^>]*>/)[0];
}
function element(props = {}) {
    return Object.assign({ checked: false, disabled: false, dataset: {}, handlers: {},
        addEventListener(type, callback) { this.handlers[type] = callback; },
        change(checked) { this.checked = checked; this.handlers.change({ target: this }); },
    }, props);
}
function bind(p) {
    const inputs = ['D1', 'D2', 'D3'].map((day, index) => element({
        dataset: { exceptionRecordSelect: JSON.stringify(['R', day]) }, disabled: index === 2,
    }));
    const all = element();
    const bulk = element();
    const acrossPages = element();
    const singles = { '[data-select-exception-all]': all, '[data-bulk-exception-process]': bulk,
        '[data-select-all-filtered-exceptions]': acrossPages };
    p.body = () => ({ querySelector: selector => singles[selector],
        querySelectorAll: selector => selector === '[data-exception-record-select]' ? inputs : [] });
    p.bind_processing_exception_events();
    return { inputs, all, bulk, acrossPages };
}

test('header stays enabled under pending, department and exception filters', () => {
    const p = page();
    for (const filters of [{}, { exception_department_filter: '行政课' }, { exception_code_filter: 'LATE_MARKED' }]) {
        Object.assign(p, filters);
        const html = p.render_processing_exceptions(rows, false, '', { filtered_pending_count: 100 });
        assert.doesNotMatch(header(html), /disabled/);
        assert.match(header(html), /当前页/);
        assert.doesNotMatch(html, /data-select-all-filtered-exceptions/);
    }
    assert.match(header(p.render_processing_exceptions([], false, '', { filtered_pending_count: 100 })), /disabled/);
    assert.match(header(p.render_processing_exceptions(rows, true)), /disabled/);
    p.exception_source_filter = '';
    assert.match(header(p.render_processing_exceptions(rows)), /disabled/);
});

test('header selects only selectable current-page daily keys and clears them on second click', () => {
    const p = page();
    const { inputs, all, bulk } = bind(p);
    all.change(true);
    assert.deepEqual([...p.selected_exception_record_ids], ['["R","D1"]', '["R","D2"]']);
    assert.equal(p.select_all_filtered_exceptions, false);
    assert.equal(inputs[2].checked, false);
    assert.equal(all.checked, true);
    assert.equal(all.indeterminate, false);
    assert.equal(bulk.textContent, '处理已勾选（2）');
    inputs[0].change(false);
    assert.equal(all.checked, false);
    assert.equal(all.indeterminate, true);
    inputs[0].change(true);
    assert.equal(all.checked, true);
    assert.equal(all.indeterminate, false);
    all.change(false);
    assert.equal(p.selected_exception_record_ids.size, 0);
    assert.equal(all.checked, false);
    assert.equal(all.indeterminate, false);
    assert.equal(bulk.disabled, true);
});

test('explicit all-pages button is preserved and header cancellation clears its scope', () => {
    const p = page();
    const { all, acrossPages, bulk, inputs } = bind(p);
    acrossPages.handlers.click();
    assert.equal(p.select_all_filtered_exceptions, true);
    assert.equal(bulk.textContent, '处理当前筛选全部（100）');
    assert.equal(all.checked, true);
    inputs[0].change(false);
    assert.equal(p.select_all_filtered_exceptions, false);
    assert.equal(p.selected_exception_record_ids.size, 1);
    assert.equal(all.indeterminate, true);
    acrossPages.handlers.click();
    all.change(false);
    assert.equal(p.select_all_filtered_exceptions, false);
    assert.equal(p.selected_exception_record_ids.size, 0);
});

test('rendered rows restore explicit selection and initial binding synchronizes header', () => {
    const p = page();
    p.selected_exception_record_ids.add('["R","D1"]');
    const html = p.render_processing_exceptions(rows);
    assert.match(html, /data-exception-record-select="\[&quot;R&quot;,&quot;D1&quot;\]"[^>]*checked/);
    const { all, inputs } = bind(p);
    inputs[0].checked = true;
    p.bind_processing_exception_events();
    assert.equal(all.indeterminate, true);
    assert.equal(all.checked, false);
});
