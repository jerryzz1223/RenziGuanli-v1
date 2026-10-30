const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../hrms/hr/page/attendance_import_center/attendance_import_center.js'), 'utf8');
const ctx = { frappe: { pages: { 'attendance-import-center': {} } }, __: (text, args = []) => text.replace(/\{(\d+)\}/g, (_, i) => args[i] ?? `{${i}}`) };
vm.runInNewContext(source + '\nthis.Controller = AttendanceImportCenter;', ctx);
function page() {
    const body = { innerHTML: '', querySelectorAll: () => [] };
    return Object.assign(Object.create(ctx.Controller.prototype), {
        body: () => body, escape: value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
        company: 'TEST', attendance_month: '2026-08', active_view: 'downstream-exclusions',
        ledger_query_request_id: 0, ensure_company: () => true,
    });
}
test('ledger shows scope, zero exclusion hours, reason and immutable source locator', () => {
    const p = page();
    const html = p.render_downstream_exclusions([{
        employee_code: 'E1', employee_name: '张三', attendance_date: '2026-08-10', scope: '仅工作日加班',
        excluded_standard_hours: 0, excluded_actual_hours: 0, excluded_overtime_hours: 2,
        status: '待审核，暂不计入', reason: '<script>bad</script>', operator: '系统规则',
        source_file: 'A.xlsx', source_sheet: '每日统计', source_row: 10,
    }], false, '', { total_count: 101, page_start: 0, page_length: 100, has_more: true });
    assert.match(html, /仅工作日加班/);
    assert.match(html, /<td>0<\/td><td>0<\/td><td>2<\/td>/);
    assert.match(html, /A.xlsx \/ 每日统计 \/ 10/);
    assert.match(html, /待审核期间自动生效/);
    assert.match(html, /data-exclusion-page="100"/);
    assert.doesNotMatch(html, /<script>/);
});
test('ledger loads selected company/month, pagination and ignores stale responses', () => {
    const p = page();
    const calls = [];
    p.call_processing_api = (method, args, callbacks) => calls.push({ method, args, callbacks });
    p.load_downstream_exclusions(100);
    assert.equal(calls[0].method, 'list_attendance_downstream_exclusions');
    assert.equal(calls[0].args.company, 'TEST');
    assert.equal(calls[0].args.attendance_month, '2026-08');
    assert.equal(calls[0].args.page_start, 100);
    p.load_downstream_exclusions(0);
    calls[1].callbacks.on_success({ items: [], total_count: 0 });
    const latest = p.body().innerHTML;
    calls[0].callbacks.on_success({ items: [], total_count: 99 });
    assert.equal(p.body().innerHTML, latest);
    p.active_view = 'exceptions';
    calls[1].callbacks.on_error('old failure');
    assert.equal(p.body().innerHTML, latest);
});
test('ledger errors are visible and the navigation entry is registered', () => {
    const p = page();
    p.call_processing_api = (_method, _args, options) => options.on_error('没有权限');
    p.load_downstream_exclusions();
    assert.match(p.body().innerHTML, /没有权限/);
    assert.match(source, /key: "downstream-exclusions", label: "不计入下游记录"/);
    assert.match(source, /this.active_view === "downstream-exclusions"\) return this.load_downstream_exclusions/);
    assert.match(source, /data-open-downstream-exclusions/);
});
test('download verifies the current server snapshot and refuses a stale cached URL', () => {
    const p = page();
    p.processing_batch = { first_signed_outputs: { file_url: '/private/files/old.xlsx' } };
    const messages = [];
    const opened = [];
    ctx.frappe.msgprint = text => messages.push(text);
    ctx.window = { open: url => opened.push(url) };
    let callbacks;
    p.call_processing_api = (method, args, options) => {
        assert.equal(method, 'get_monthly_final_preview');
        assert.equal(args.kind, 'first_signed');
        callbacks = options;
    };
    p.download_final_file('first_signed');
    callbacks.on_success({ available: false, stale: true, reason: '规则已更新，请重新生成' });
    assert.deepEqual(opened, []);
    assert.match(messages[0], /重新生成/);
    callbacks.on_success({ available: true, file_url: '/private/files/current.xlsx' });
    assert.deepEqual(opened, ['/private/files/current.xlsx']);
});
