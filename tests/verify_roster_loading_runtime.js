const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../hrms/public/js/erpnext/employee_list.js'), 'utf8');

function harness() {
 const requests = [], storage = new Map(), values = new Map();
 let company = 'A', renders = 0;
 const wrapper = {querySelector(selector) {
  if (!selector.includes('__value')) return null;
  if (!values.has(selector)) values.set(selector, {textContent: ''});
  return values.get(selector);
 }};
 const context = {
  console, URL, URLSearchParams, Map, Set, Date, Promise,
  sessionStorage: {getItem: key => storage.get(key) || null, setItem: (key,value) => storage.set(key,value)},
  document: {querySelector: () => null},
  window: {location: {assign() {throw Error('Must not reload Desk');}}},
  frappe: {listview_settings: {}, get_meta: () => ({fields: ['company','custom_work_nature'].map(fieldname => ({fieldname}))}),
   defaults: {get_user_default: () => company}, call: options => {requests.push(options);},
   utils: {escape_html: value => value}},
  __: value => value,
  recordRender: () => renders++,
 };
 vm.createContext(context);
 vm.runInContext(source.replace(/\}\)\(\);\s*$/, `
  globalThis.testAPI = {load_roster_table_records, get_roster_table_state, get_visible_roster_table_rows,
   update_roster_counts, apply_roster_filters_to_live_listview};
  ensure_roster_empty_result_header = recordRender;
  clear_roster_native_search_input = () => {};
 })();`), context);
 const listview = {page: {main: [wrapper]}};
 return {api: context.testAPI, listview, requests, storage, values, company: value => company = value, renders: () => renders};
}

(async () => {
 const h = harness(), s = h.api.get_roster_table_state(h.listview);
 h.storage.set('hrms_roster_active_card', '在职 · 正式');
 h.api.load_roster_table_records(h.listview, s);
 h.api.load_roster_table_records(h.listview, s);
 assert.equal(h.requests.length, 1, 'concurrent identical table loads share one request');
 h.storage.set('hrms_roster_active_card', '离职');
 h.api.load_roster_table_records(h.listview, s);
 h.requests[1].callback({message: {rows: [{name: 'left', custom_work_nature: '离职'}]}});
 h.requests[0].callback({message: {rows: [{name: 'active', custom_work_nature: '在职·正式'}]}});
 assert.equal(s.records[0].name, 'left', 'late response cannot overwrite the current card');
 assert.equal(h.renders(), 1, 'stale callback must not redraw');
 h.company('B');
 h.api.load_roster_table_records(h.listview, s);
 assert.equal(s.records, null, 'changing company removes prior-company rows while loading');
 h.requests[2].error();
 h.api.load_roster_table_records(h.listview, s);
 assert.equal(h.requests.length, 3, 'failure must not cause a request/render loop');
 assert.equal(s.error, true);
 h.listview.data = [{name: 'stale-native', custom_work_nature: '离职'}];
 assert.equal(h.api.get_visible_roster_table_rows(h.listview, [], s).length, 0, 'failure cannot substitute native stale rows');
 s.error = false; s.source_key = '';
 h.api.load_roster_table_records(h.listview, s);
 h.requests[3].callback({message: {rows: []}});
 assert.equal(s.records.length, 0);
 assert.equal(h.api.get_visible_roster_table_rows(h.listview, [], s).length, 0, 'successful empty result stays empty');

 const counts = harness();
 counts.api.update_roster_counts(counts.listview);
 counts.api.update_roster_counts(counts.listview);
 assert.equal(counts.requests.length, 1, 'six cards and overlapping refreshes share one summary call');
 counts.company('B'); counts.api.update_roster_counts(counts.listview);
 counts.requests[1].callback({message: [{label: '全部', count: 2}]});
 counts.requests[0].callback({message: [{label: '全部', count: 999}]});
 assert.equal([...counts.values.values()][0].textContent, 2, 'late company count must be ignored');

 const sync = harness(); let release, clears = 0, written = null, urlUpdates = 0;
 sync.listview.filter_area = {
  clear_filters: () => {clears++; return clears === 1 ? new Promise(resolve => release = resolve) : Promise.resolve();},
  set: filters => {written = filters; return Promise.resolve();},
 };
 sync.listview.update_url_with_filters = () => urlUpdates++;
 const first = sync.api.apply_roster_filters_to_live_listview(sync.listview, {custom_work_nature: '在职·正式'});
 await Promise.resolve();
 const last = sync.api.apply_roster_filters_to_live_listview(sync.listview, {custom_work_nature: '离职', company: 'B'});
 release(); await Promise.all([first,last]);
 assert.equal(written[0][3], '离职', 'rapid filter changes settle on the latest card');
 assert.equal(written[1][3], 'B');
 assert.equal(urlUpdates, 1, 'only latest filter transaction updates the URL');
 console.log('Roster runtime: deduplication, stale replies, company changes, errors/retry, empty rows, batched counts and rapid filter writes passed.');
})().catch(error => {console.error(error); process.exitCode = 1;});
