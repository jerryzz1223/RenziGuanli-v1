const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../hrms/hr/page/attendance_import_center/attendance_import_center.js'), 'utf8');
const context = { frappe: { pages: { 'attendance-import-center': {} } }, __: (text) => text };
vm.runInNewContext(`${source}\nglobalThis.Center = AttendanceImportCenter;`, context);
function makeCenter() {
 const center = Object.create(context.Center.prototype);
 Object.assign(center, {
  company: 'test-company', attendance_month: '2026-11',
  ensure_company: () => true, normalize_processing_batch: (data) => data,
  update_processing_kpis: () => {}, render_current_processing_view: () => {},
  escape: (text) => String(text).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
 });
 return center;
}
test('simultaneous overview reads share one request and notify every caller', () => {
 const center = makeCenter();
 const requests = [];
 center.call_processing_api = (method, args, options) => requests.push({ args, options });
 const received = [];
 center.load_processing_batch({ on_loaded: (data) => received.push(data) });
 center.load_processing_batch({ on_loaded: (data) => received.push(data) });
 assert.equal(requests.length, 1);
 requests[0].options.on_success({ batch_id: 'batch-1' });
 assert.equal(received.length, 2);
 assert.equal(center.processing_batch_requests.size, 0);
 center.load_processing_batch();
 assert.equal(requests.length, 2, 'later refreshes must read current server data');
 requests[1].options.on_error('offline');
 assert.equal(center.processing_batch_requests.size, 0);
});
test('company changes discard old responses and release pending requests', () => {
 const center = makeCenter();
 const requests = [];
 center.call_processing_api = (method, args, options) => requests.push(options);
 let oldCallback = false;
 center.load_processing_batch({ on_loaded: () => { oldCallback = true; } });
 center.company = 'other-company';
 center.load_processing_batch();
 requests[0].on_success({ batch_id: 'old' });
 assert.equal(oldCallback, false);
 assert.equal(center.processing_batch, undefined);
 assert.equal(center.processing_batch_requests.size, 1);
 requests[1].on_success({ batch_id: 'new' });
 assert.equal(center.processing_batch.batch_id, 'new');
 assert.equal(center.processing_batch_requests.size, 0);
});
test('loading tables preserve column counts, escape messages, and announce status', () => {
 const center = makeCenter();
 for (const count of [4, 5, 8, 10, 11, 18]) {
  const html = center.render_loading_rows(count, '<test>');
  assert.match(html, new RegExp(`colspan="${count}"`));
  assert.equal((html.match(/<td>/g) || []).length, count * 5);
  assert.match(html, /role="status"/);
  assert.match(html, /&lt;test&gt;/);
  assert.doesNotMatch(html, /<test>/);
 }
});

test('opening and refreshing exceptions reads saved results without a policy recheck', () => {
 const center = makeCenter();
 const body = { innerHTML: '' };
 const requests = [];
 Object.assign(center, {
  body: () => body, active_view: 'exceptions', exception_query_request_id: 0,
  selected_exception_record_ids: new Set(), exception_page_record_ids: new Set(),
  exception_page: 1, exception_page_size: 20,
  render_processing_exceptions: () => 'saved-results', bind_processing_exception_events: () => {},
  restore_exception_scroll_position: () => {},
  ensure_current_exception_policies: () => { throw Error('viewing must never recalculate'); },
  call_processing_api: (method, args, options) => requests.push({ method, args, options }),
 });
 center.load_processing_exceptions({ reuseSnapshot: true });
 assert.equal(requests.length, 1);
 assert.equal(requests[0].method, 'list_processing_exceptions');
 requests[0].options.on_success({ review_rows: [], filtered_parent_count: 0 });
 assert.equal(body.innerHTML, 'saved-results');
 center.load_processing_exceptions();
 assert.equal(requests[1].method, 'list_processing_exceptions');
 assert.equal(requests[1].args.snapshot_token, undefined, 'refresh must query current records');
});

test('explicit policy recheck previews changes and waits for the update decision', () => {
 const center = makeCenter();
 const requests = [];
 let accept;
 const body = { innerHTML: '' };
 Object.assign(center, {
  body: () => body, active_view: 'exceptions', render_processing_exceptions: () => 'checking',
  call_processing_api: (method, args, options) => requests.push({ method, args, options }),
  load_processing_exceptions: () => {}, load_processing_batch: () => {},
 });
 context.frappe.confirm = (message, yes) => { accept = yes; };
 center.ensure_current_exception_policies();
 assert.equal(requests[0].method, 'recheck_attendance_policy');
 assert.equal(requests[0].args.execute, undefined);
 requests[0].options.on_success({ changed_count: 3, preview_token: 'current-preview' });
 assert.equal(requests.length, 1, 'preview must not silently write records');
 accept();
 assert.equal(requests[1].args.execute, 1);
 assert.equal(requests[1].args.preview_token, 'current-preview');
});

function cacheFixture() {
 const center = makeCenter();
 const requests = [], displays = [];
 const notice = { textContent: '' };
 Object.assign(center, { active_view: 'exceptions', processing_api: 'test.api',
  body: () => ({ insertAdjacentHTML() {}, querySelector: () => notice }),
 });
 context.frappe.call = (request) => { requests.push(request); return Promise.resolve({}); };
 context.frappe.session = { user: 'test-user' };
 const args = () => ({ company: center.company, attendance_month: center.attendance_month, page_start: 0 });
 const options = { on_success: (data) => displays.push(data) };
 return { center, requests, displays, args, options, notice };
}
test('returning to a recently read view displays its cached data without another request', () => {
 const f = cacheFixture();
 f.center.call_processing_api('list_processing_exceptions', f.args(), f.options);
 f.requests[0].callback({ message: { review_rows: [{ name: 'row-1' }], filtered_parent_count: 1 } });
 f.displays[0].review_rows[0].name = 'renderer-mutated';
 f.center.reuse_navigation_reads = true;
 f.center.call_processing_api('list_processing_exceptions', f.args(), f.options);
 assert.equal(f.requests.length, 1);
 assert.equal(f.displays[1].review_rows[0].name, 'row-1', 'renderers must receive independent copies');
 // Manual refresh bypasses navigation reuse.
 f.center.reuse_navigation_reads = false;
 f.center.call_processing_api('list_processing_exceptions', f.args(), f.options);
 assert.equal(f.requests.length, 2);
});
test('older cached results paint before a background refresh; failures retain the visible result', () => {
 const f = cacheFixture();
 f.center.call_processing_api('list_processing_exceptions', f.args(), f.options);
 f.requests[0].callback({ message: { review_rows: [], filtered_parent_count: 7 } });
 [...f.center.navigation_read_cache.values()][0].loaded_at = Date.now() - 20_000;
 f.center.reuse_navigation_reads = true;
 f.center.call_processing_api('list_processing_exceptions', { ...f.args(), snapshot_record_ids: '["old"]', snapshot_token: 'old' }, f.options);
 assert.equal(f.displays.length, 2, 'cached content must be rendered synchronously');
 assert.equal(f.requests.length, 2);
 assert.equal(f.requests[1].args.snapshot_token, undefined, 'background refresh must recompute current counts');
 f.requests[1].error({});
 assert.equal(f.displays.length, 2);
 assert.match(f.notice.textContent, /保留上次结果/);
});
test('mutations invalidate cached reads and older in-flight reads cannot restore them', () => {
 const f = cacheFixture();
 f.center.call_processing_api('list_processing_exceptions', f.args(), f.options);
 f.center.call_processing_api('process_source_slot', f.args());
 f.requests[0].callback({ message: { review_rows: [], filtered_parent_count: 99 } });
 assert.equal(f.center.navigation_read_cache.size, 0);
 assert.equal(f.displays.length, 0);
});
test('navigation caches are isolated by company, month and signed-in user', () => {
 const f = cacheFixture();
 f.center.call_processing_api('list_processing_exceptions', f.args(), f.options);
 f.requests[0].callback({ message: { review_rows: [] } });
 f.center.reuse_navigation_reads = true;
 f.center.company = 'other-company';
 f.center.call_processing_api('list_processing_exceptions', f.args(), f.options);
 assert.equal(f.requests.length, 2);
 f.center.company = 'test-company';
 f.center.attendance_month = '2026-12';
 f.center.call_processing_api('list_processing_exceptions', f.args(), f.options);
 assert.equal(f.requests.length, 3);
 f.center.attendance_month = '2026-11';
 context.frappe.session.user = 'other-user';
 f.center.call_processing_api('list_processing_exceptions', f.args(), f.options);
 assert.equal(f.requests.length, 4);
 assert.equal(f.displays.length, 1);
});
