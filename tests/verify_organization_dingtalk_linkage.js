const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
let dialog, timers = [], calls = [], notices = [], reloads = 0, previewCount = 0;
const escape = value => String(value).replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const context = { __: x => x, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {}, frappe: {
  pages: { "organizational-chart": {} }, utils: { escape_html: escape },
  msgprint: value => notices.push(value), confirm: (message, yes) => yes(),
  call: args => {
    calls.push(args);
    const method = args.method.split(".").at(-1);
    let message;
    if (method === "queue_pull") message = { token: "TOKEN" };
    if (method === "pull_status") message = { status: "ready" };
    if (method === "setup_rows") message = { rows: [{ external_id: "2", department_name: "<外部名称>", parent_id: "1", decision: "保留人工结果" }], node_names: ["N1"], initial: false, pulled_at: "fixture" };
    if (method === "preview") { previewCount++; message = { rows: [{ external_id: "2", node: "N1", department: "D1", current_name: "人工名字", department_name: "<外部名称>", parent_id: "1", status: "人工调整，默认保留" }], fingerprint: "F", scope_notice: "notice", missing_source: [] }; }
    if (method === "apply") message = { changed: 1, audit_file: "/private/files/fixture.json" };
    // Mimic the site's then-only Frappe Deferred.
    return { then: resolve => resolve({ message }) };
  }, ui: { Dialog: class {
    constructor(config) {
      Object.assign(this, config); dialog = this; this.fields_dict = {};
      for (const field of config.fields) this.fields_dict[field.fieldname] = { df: field, grid: { refresh() {} }, $wrapper: { html: html => { this[field.fieldname + "_html"] = html; } } };
      this.reason = "测试首次建立／后续同步";
    }
    get_value(field) { return this[field]; }
    show() {}
    hide() { this.onhide(); }
  } },
} };
vm.createContext(context);
vm.runInContext(fs.readFileSync("hrms/hr/page/organizational_chart/organizational_chart.js", "utf8") + "\nthis.Chart=HybridOrganizationChart;", context);
const chart = Object.create(context.Chart.prototype);
chart.company = "A"; chart.is_active = () => true; chart.load_tree = () => reloads++;
const click = name => dialog.fields_dict[name].df.click();

(async () => {
  chart.show_dingtalk_linkage();
  await click("pull");
  await click("pull");
  assert.equal(calls.length, 1, "duplicate pull prevented while polling");
  await timers.shift()();
  assert.equal(dialog.fields_dict.departments.df.data[0].decision, "保留人工结果");
  await click("preview");
  assert.equal(previewCount, 2, "suggested mappings become explicit and are re-signed");
  assert.equal(dialog.fields_dict.departments.df.data[0].target_node, "N1");
  dialog.primary_action();
  assert(!calls.some(call => call.method.endsWith(".apply")), "keeping all rows never applies changes");
  await click("select_all");
  dialog.primary_action();
  // Confirmation callback runs asynchronously.
  await new Promise(resolve => setImmediate(resolve));
  const applied = calls.find(call => call.method.endsWith(".apply"));
  assert(applied);
  assert.equal(applied.args.company, "A");
  assert.equal(applied.args.token, "TOKEN");
  assert.equal(JSON.parse(applied.args.decisions_json)["2"], "source");
  assert.equal(JSON.parse(applied.args.bindings_json)["2"], "N1");
  assert.equal(reloads, 1);
  assert.equal(notices.length, 1);

  chart.show_dingtalk_linkage();
  await click("pull"); await timers.pop()(); await click("preview");
  dialog.fields_dict.departments.df.data[0].target_node = "CHANGED";
  const before = calls.length;
  dialog.primary_action();
  assert.equal(calls.length, before, "changed mapping requires a fresh preview");
  assert(dialog.status_html.includes("重新预览"));
  chart.company = "B";
  const staleBefore = calls.length;
  await click("pull");
  assert.equal(calls.length, staleBefore, "dialog from previous company cannot mutate state");
  console.log("PASS: pull/poll, default keep, explicit candidate confirmation, apply, refresh, mapping invalidation and company guard");
})().catch(error => { console.error(error); process.exitCode = 1; });
