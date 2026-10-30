const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../hrms/hr/page/attendance_import_center/attendance_import_center.js"), "utf8");
function harness() {
 const requests = [], timers = [], states = [];
 const context = {frappe: {pages: {"attendance-import-center": {}}, call: options => requests.push(options)},
  __: value => value, setTimeout: callback => timers.push(callback)};
 vm.createContext(context);
 vm.runInContext(source + "\nglobalThis.Center = AttendanceImportCenter;", context);
 const page = Object.create(context.Center.prototype);
 Object.assign(page, {company: "A", active_view: "dingtalk", ensure_company: () => true, is_active: () => true,
  set_dingtalk_sync_progress: state => states.push(state), load_dingtalk_status() {this.refreshed = true;}, read_dingtalk_error: () => "request failed"});
 return {page, requests, timers, states};
}
{
 const h = harness();
 h.page.sync_dingtalk_full_roster();
 assert.equal(h.requests[0].method, "hrms.api.dingtalk_roster_tasks.queue_roster_comparison");
 h.requests[0].callback({message: {sync_log: "S1"}});
 assert.equal(h.requests[1].args.company, "A");
 h.requests[1].callback({message: {status: "运行中"}});
 assert.equal(h.timers.length, 1);
 h.timers.shift()();
 h.requests[2].callback({message: {status: "已完成", received: 2}});
 assert.equal(h.states.at(-1).done, true);
 assert.equal(h.page.refreshed, true);
}
{
 const h = harness();
 h.page.sync_dingtalk_full_roster();
 h.requests[0].callback({message: {sync_log: "S1"}});
 h.requests[1].callback({message: {status: "部分失败", failed: 1, error_message: "permission missing"}});
 assert.equal(h.states.at(-1).failed, true);
 assert.equal(h.states.at(-1).error, "permission missing");
 assert.equal(h.timers.length, 0);
}
for (const change of [p => p.company = "B", p => p.active_view = "daily", p => p.roster_comparison_watch = "new", p => p.is_active = () => false]) {
 const h = harness();
 h.page.sync_dingtalk_full_roster();
 h.requests[0].callback({message: {sync_log: "S1"}});
 const count = h.states.length;
 change(h.page);
 h.requests[1].callback({message: {status: "已完成"}});
 assert.equal(h.states.length, count, "stale task response must not redraw current view");
 assert.equal(h.timers.length, 0);
}
{
 const h = harness();
 h.page.sync_dingtalk_full_roster();
 h.requests[0].callback({message: {sync_log: "S1"}});
 h.requests[1].error({});
 assert.equal(h.states.at(-1).failed, true);
 assert.equal(h.timers.length, 0, "permission/network error should not poll forever");
}
{
 const h = harness();
 h.page.sync_dingtalk_full_roster();
 h.requests[0].callback({message: {}});
 assert.equal(h.states.at(-1).failed, true);
 assert.equal(h.requests.length, 1);
}
console.log("PASS: roster queue, terminal states, stale responses, and polling errors");
