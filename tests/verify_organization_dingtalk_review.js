const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

let calls = [], notices = [], resolveCall;
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const context = { __: value => value, frappe: {
  pages: { "organizational-chart": {} }, utils: { escape_html: escape },
  msgprint: value => notices.push(value),
  call: args => { calls.push(args); return new Promise(resolve => { resolveCall = resolve; }); },
} };
vm.createContext(context);
vm.runInContext(fs.readFileSync("hrms/hr/page/organizational_chart/organizational_chart.js", "utf8") + "\nthis.Chart = HybridOrganizationChart;", context);
const chart = Object.create(context.Chart.prototype);
chart.company = "A";
chart.is_active = () => true;

(async () => {
  const pending = chart.show_dingtalk_organization_review();
  await chart.show_dingtalk_organization_review();
  assert.equal(calls.length, 1, "duplicate clicks issue one request");
  assert.equal(calls[0].args.company, "A");
  assert.equal(calls[0].method, "hrms.api.dingtalk_organization_review.preview_organization");
  resolveCall({ message: { mixed_source_batches: true, rows: [{ department_id: "2", source_path: "<script>source</script>", issues: ["<img>"] }], unmatched_system_departments: [{ name: "D", system_path: "<local>" }] } });
  await pending;
  assert.equal(chart.dingtalk_review_loading, false);
  assert(notices[0].message.includes("&lt;script&gt;source&lt;/script&gt;"));
  assert(!notices[0].message.includes("<img>"));
  assert(notices[0].message.includes("&lt;local&gt;"));
  assert(notices[0].message.includes("多个同步批次"));

  notices = [];
  const stale = chart.show_dingtalk_organization_review();
  chart.company = "B";
  resolveCall({ message: {} });
  await stale;
  assert.equal(notices.length, 0, "late response for another company is ignored");

  const inactive = chart.show_dingtalk_organization_review();
  chart.is_active = () => false;
  resolveCall({ message: {} });
  await inactive;
  assert.equal(notices.length, 0, "late response after leaving the page is ignored");

  chart.is_active = () => true;
  context.frappe.call = () => Promise.reject(new Error("fixture"));
  await chart.show_dingtalk_organization_review();
  assert.equal(notices[0].indicator, "red");
  assert.equal(chart.dingtalk_review_loading, false, "failure permits retry");

  // Older Frappe exposes then-only Deferred objects.
  context.frappe.call = () => ({ then: resolve => resolve({ message: {} }) });
  await chart.show_dingtalk_organization_review();
  assert.equal(notices.length, 2);
  assert(notices[1].message.includes("尚未验证为完整快照"));
  console.log("PASS: read-only request, escaped diagnostics, duplicate guard, stale response guards, failure/retry and then-only Deferred");
})().catch(error => { console.error(error); process.exitCode = 1; });
