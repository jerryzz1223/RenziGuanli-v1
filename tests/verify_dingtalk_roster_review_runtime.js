const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
class Element {
 constructor() { this.html = ""; this.children = []; this.nodes = new Map(); this.value = ""; this.style = {}; this.dataset = {}; }
 set innerHTML(html) {
  this.html = html; this.nodes.clear(); this.children = [];
  const regex = /<(\w+)\b[^>]*\b(data-[\w-]+)(?:="([^"]*)")?[^>]*>/g;
  for (const m of html.matchAll(regex)) {
   const el = new Element(), attr = m[2], value = m[3] ?? "";
   el.dataset[attr.slice(5)] = value;
   if (m[1] === "select") el.value = "keep";
   this.nodes.set(`[${attr}${m[3] !== undefined ? `="${value}"` : ""}]`, el);
  }
 }
 get innerHTML() { return this.html; }
 appendChild(el) { this.children.push(el); }
 querySelector(key) {
  if (this.nodes.has(key)) return this.nodes.get(key);
  const prefix = key.replace(/\]$/, "");
  for (const [selector, el] of this.nodes) if (selector.startsWith(prefix + "=")) return el;
  for (const child of this.nodes.values()) { if (child.nodes.has(key)) return child.nodes.get(key); }
  const el = new Element(); this.nodes.set(key, el); return el;
 }
 querySelectorAll(key) {
  const checked = key.endsWith(":checked"), prefix = key.replace(":checked", "").slice(0, -1);
  return [...this.nodes.entries()].filter(([selector, el]) => selector.startsWith(prefix + "=") && (!checked || el.checked)).map(([, el]) => el).concat(...[...this.nodes.values()].map(el => el.querySelectorAll(key)));
 }
}
function harness() {
 const sections = new Map([".review-status", ".review-actions", ".review-list", ".review-detail"].map(k => [k, new Element()]));
 const wrapper = {}, requests = [], messages = [], timers = new Map(), controls = [];
 let company = "A", nextTimer = 0;
 const body = { html() {}, find(key) { return [sections.get(key)]; } };
 const context = {
  console, Promise, Map, Set,
  $: () => body, document: { createElement: () => new Element() }, window: {},
  setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { timers.delete(id); },
  __: (s, args = []) => s.replace(/\{(\d+)\}/g, (_, n) => args[n]),
  frappe: {
   pages: { "dingtalk-roster-review": {} }, defaults: { get_user_default: () => company },
   utils: { escape_html: s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") },
   ui: { make_app_page: () => ({ body: {}, set_secondary_action() {} }), form: { make_control(options) { const control = { value: null, set_value(value) { this.value = value; }, get_value() { return this.value; } }; controls.push(control); return control; } } },
   call(options) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    requests.push({ ...options, resolve: value => resolve({ message: value }), reject });
    // Legacy Frappe Deferred exposes then without catch/finally.
    return { then: promise.then.bind(promise) };
   },
   msgprint: s => messages.push(s), show_alert: s => messages.push(s), set_route() {},
  },
 };
 vm.createContext(context);
 vm.runInContext(fs.readFileSync(path.join(__dirname, "../hrms/hr/page/dingtalk_roster_review/dingtalk_roster_review.js"), "utf8"), context);
 const page = context.frappe.pages["dingtalk-roster-review"]; page.on_page_load(wrapper); page.on_page_show(wrapper);
 return { requests, sections, controls, messages, timers, company: c => company = c, show: () => page.on_page_show(wrapper), hide: () => page.on_page_hide(wrapper) };
}
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const listResult = { sync_log: "S1", status: "已完成", total: 232, rows: [{ name: "I1", employee_name: "<img src=x>", import_status: "待人工比对" }], has_more: true, next_start: 100 };
const detailResult = { name: "I1", employee_name: "员工", employee: "E1", employee_modified: "e1", import_modified: "v1", import_status: "待人工比对", source_fields: [{ label: "未映射", value: "<script>" }], source_data: { extra: "完整资料" }, fields: [{ fieldname: "employee_name", label: "姓名", editable: true, different: true, can_apply: true, fieldtype: "Data", system_value: "原姓名", dingtalk_value: "钉钉姓名" }], attachments: [{ index: 0, file_name: "a.png", is_image: true, download_available: true }] };
async function open(h) {
 h.requests[0].resolve(listResult); await tick();
 assert(h.sections.get(".review-list").innerHTML.includes("&lt;img src=x&gt;"));
 h.sections.get(".review-list").querySelector('[data-detail="0"]').onclick();
 h.requests[1].resolve(detailResult); await tick();
}
(async () => {
 {
  const h = harness(); await open(h);
  const d = h.sections.get(".review-detail");
  assert(d.innerHTML.includes("&lt;script&gt;"));
  d.querySelector("[data-reason]").value = "保留系统资料";
  d.querySelector("[data-save]").children[0].onclick(); await tick();
  assert.equal(h.requests[2].args.keep_fieldnames_json, '["employee_name"]');
  assert.equal(h.requests[2].args.fieldnames_json, '[]');
  assert.equal(h.requests[2].args.expected_modified, "e1");
  assert.equal(h.requests[2].args.expected_import_modified, "v1");
 }
 {
  const h = harness(); await open(h);
  const d = h.sections.get(".review-detail"), choice = d.querySelector('[data-choice="0"]');
  choice.value = "custom"; choice.onchange(); h.controls[0].value = "自定义姓名";
  d.querySelector("[data-reason]").value = "人工查验";
  d.querySelector("[data-save]").children[0].onclick(); await tick();
  assert.equal(h.requests[2].args.custom_values_json, '{"employee_name":"自定义姓名"}');
  assert.equal(h.requests[2].args.keep_fieldnames_json, '[]');
 }
 {
  const h = harness(); await open(h);
  const d = h.sections.get(".review-detail"); d.querySelector('[data-file="0"]').checked = true;
  d.querySelector("[data-file-actions]").children[0].onclick(); await tick();
  assert.equal(h.requests[2].args.verify_only, 1);
  assert.equal(h.requests[2].args.indexes_json, '[0]');
  h.requests[2].resolve({ results: [{ index: 0, verified: false, reason: "权限不足" }] }); await tick();
  assert(d.querySelector("[data-file-result]").innerHTML.includes("权限不足"));
 }
 {
  const h = harness(); h.requests[0].resolve({ ...listResult, status: "运行中" }); await tick();
  assert.equal(h.timers.size, 1); h.hide(); assert.equal(h.timers.size, 0);
 }
 {
  const h = harness(); h.company("B"); h.requests[0].resolve(listResult); await tick();
  assert.equal(h.sections.get(".review-list").innerHTML, "");
  h.show(); assert.equal(h.requests[1].args.company, "B"); assert.equal(h.requests[1].args.sync_log, "");
 }
 {
  const h = harness(); h.hide(); h.requests[0].resolve(listResult); await tick();
  assert.equal(h.sections.get(".review-list").innerHTML, "");
 }
 console.log("Review page runtime: dedicated entry, escaped full details, keep/custom decisions, selected attachment verification, legacy Deferred, company/route response isolation passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
