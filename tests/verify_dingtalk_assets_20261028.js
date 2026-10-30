const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../hrms/hr/page/attendance_import_center/attendance_import_center.js"), "utf8");
function harness() {
 const requests = [], messages = [];
 const context = {frappe: {pages: {"attendance-import-center": {}}, call: options => requests.push(options), msgprint: message => messages.push(message)},
  __: (text, args=[]) => text.replace(/\{(\d+)\}/g, (_, i) => args[i])};
 vm.createContext(context);
 vm.runInContext(source + "\nglobalThis.Center = AttendanceImportCenter;", context);
 const page = Object.create(context.Center.prototype);
 Object.assign(page, {company: "A", active_view: "dingtalk", ensure_company: () => true, is_active: () => true,
  escape: value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), read_dingtalk_error: () => "failed"});
 return {page, requests, messages};
}
{
 const h = harness();
 h.page.preview_dingtalk_organization();
 assert.equal(h.requests[0].method, "hrms.api.dingtalk_organization_review.preview_organization");
 assert.equal(h.requests[0].args.company, "A");
 h.requests[0].callback({message: {read_only: true, source_count: 1, rows: [{department_id: "2", department_name: "<img src=x>", issues: ["上下级不一致"]}]}});
 assert.equal(h.messages.length, 1);
 assert.ok(h.messages[0].message.includes("&lt;img src=x&gt;"));
 assert.ok(h.messages[0].message.includes("上下级不一致"));
 assert.equal(h.requests.length, 1, "preview must not submit a sync or mutation");
}
for (const change of [p => p.company = "B", p => p.active_view = "daily", p => p.is_active = () => false]) {
 const h = harness(); h.page.preview_dingtalk_organization(); change(h.page);
 h.requests[0].callback({message: {rows: [{department_name: "stale"}]}});
 assert.equal(h.messages.length, 0, "stale organization response must not appear in another company or page");
}
console.log("PASS: read-only organization preview, escaped data, and stale-response guards");
