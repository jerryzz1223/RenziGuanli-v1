const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
class Element {
 constructor() { this.html = ""; this.children = []; this.nodes = new Map(); this.value = ""; this.style = {}; this.dataset = {}; }
 set innerHTML(html) {
  this.renderCount = (this.renderCount || 0) + 1;
  this.html = html; this.nodes.clear(); this.children = [];
  const regex = /<(\w+)\b[^>]*\b(data-[\w-]+)(?:="([^"]*)")?[^>]*>/g;
  for (const m of html.matchAll(regex)) {
   const el = new Element(), attr = m[2], value = m[3] ?? "";
   el.dataset[attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
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
 const wrapper = {}, requests = [], messages = [], confirmations = [], timers = new Map(), controls = [], dialogs = [];
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
   ui: { Dialog: function(options) { Object.assign(this, options); this.fields_dict = {}; for (const field of options.fields || []) { const root = new Element(); root.innerHTML = field.options || ""; this.fields_dict[field.fieldname] = { $wrapper: [root] }; } this.show = () => {}; this.hide = () => {}; dialogs.push(this); }, make_app_page: () => ({ body: {}, set_secondary_action() {} }), form: { make_control(options) { const control = { value: null, set_value(value) { this.value = value; }, get_value() { return this.value; } }; control.change = options.df.change; controls.push(control); return control; } } },
   call(options) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    requests.push({ ...options, resolve: value => resolve({ message: value }), reject });
    // Legacy Frappe Deferred exposes then without catch/finally.
    return { then: promise.then.bind(promise) };
   },
   confirm: (s, yes) => confirmations.push({ message: s, yes }), msgprint: s => messages.push(s), show_alert: s => messages.push(s), set_route() {},
  },
 };
 vm.createContext(context);
 vm.runInContext(fs.readFileSync(path.join(__dirname, "../hrms/hr/page/dingtalk_roster_review/dingtalk_roster_review.js"), "utf8"), context);
 const page = context.frappe.pages["dingtalk-roster-review"]; page.on_page_load(wrapper); page.on_page_show(wrapper);
 return { requests, sections, controls, dialogs, messages, confirmations, timers, company: c => company = c, show: () => page.on_page_show(wrapper), hide: () => page.on_page_hide(wrapper) };
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
  const h = harness(); h.requests[0].resolve(listResult); await tick();
  const list = h.sections.get(".review-list"), grid = list.querySelector(".review-grid-scroll"), renderCount = list.renderCount;
  grid.scrollTop = 460; grid.scrollLeft = 90;
  const row = list.querySelector('[data-select-row="0"]'); row.checked = true; row.onchange();
  assert.equal(list.renderCount, renderCount, "checking a person must not rebuild the table");
  assert.equal(list.querySelector(".review-grid-scroll"), grid);
  assert.equal(grid.scrollTop, 460); assert.equal(grid.scrollLeft, 90);
  const all = list.querySelector("[data-select-visible]"); all.checked = false; all.onchange();
  assert.equal(row.checked, false); assert.equal(list.renderCount, renderCount);
  row.checked = true; row.onchange();
  const update = list.querySelector("[data-direct-selected]").children[0];
  assert.equal(update.disabled, false); update.onclick(); await tick();
  assert(h.requests[1].method.endsWith("preview_direct_roster_update"));
  assert.equal(h.requests[1].args.import_names_json, '["I1"]');
  h.requests[1].resolve({ can_update: true, preview_token: "BULK1", rows: [{ name: "I1", employee_name: "员工", fields: [
   { fieldname: "employee_name", label: "姓名", fieldtype: "Data", system_value: "原姓名", dingtalk_value: "钉钉姓名", can_apply: true },
   { fieldname: "department", label: "部门", fieldtype: "Link", options: "Department", system_value: "原部门", dingtalk_value: "钉钉部门", can_apply: true }
  ] }] }); await tick();
  const dialog = h.dialogs[0], root = dialog.fields_dict.comparisons.$wrapper[0];
  assert.equal(h.requests.length, 2, "no writes before review confirmed");
  dialog.primary_action(); await tick(); assert.equal(h.requests.length, 2, "pending differences must block writes");
  const first = root.querySelector('[data-bulk-choice="0"]'); first.value = "keep"; first.onchange();
  const second = root.querySelector('[data-bulk-choice="1"]'); second.value = "custom"; second.onchange();
  h.controls[0].value = "手动部门"; h.controls[0].change();
  assert.equal(root.querySelector('[data-bulk-result="1"]').textContent, "手动部门");
  dialog.primary_action(); await tick();
  const decisions = JSON.parse(h.requests[2].args.decisions_json);
  assert.equal(decisions.I1.employee_name.choice, "keep");
  assert.equal(decisions.I1.department.value, "手动部门");
  h.requests[2].resolve({ updated: 1, unchanged: 0, updated_fields: 1 }); await tick();
  h.requests[3].resolve(listResult); await tick();
  assert.equal(list.querySelector(".review-grid-scroll").scrollTop, 460, "refresh after saving preserves table scroll");
  assert.equal(list.querySelector(".review-grid-scroll").scrollLeft, 90);
 }

 {
  const h = harness();
  h.requests[0].resolve({ ...listResult, status: "运行中", rows: [], progress: { stage: "正在逐人比对资料", completed: 25, total: 100, failed: 2, stale_seconds: 95 } }); await tick();
  const html = h.sections.get(".review-status").innerHTML;
  assert(html.includes('max="100" value="25"'));
  assert(html.includes("25 / 100 人（25%）"));
  assert(html.includes("95 秒未收到新进度"));
  assert(h.sections.get(".review-list").innerHTML.includes("完成后显示名单"));
  assert.equal(h.sections.get(".review-actions").children[0].disabled, true);
  const poll = [...h.timers.values()][0]; poll();
  h.requests[1].resolve({ ...listResult, status: "已完成" }); await tick();
  assert(!h.sections.get(".review-status").innerHTML.includes("<progress"));
 }
 {
  const h = harness(); h.requests[0].resolve({ ...listResult, status: "运行中", progress: { stage: "正在读取企业通讯录", completed: 10, total: null } }); await tick();
  const html = h.sections.get(".review-status").innerHTML;
  assert(html.includes("已发现 10 人"));
  assert(!html.includes('value="10"'));
  [...h.timers.values()][0](); h.requests[1].reject(new Error("offline")); await tick();
  assert(h.sections.get(".review-status").innerHTML.includes("5 秒后自动重试"));
  assert(h.timers.size > 0);
 }

 {
  const h = harness(); h.requests[0].resolve(listResult); await tick();
  h.sections.get(".review-list").querySelector('[data-detail="0"]').onclick();
  h.requests[1].resolve({ ...detailResult, employee: "", fields: [
   { ...detailResult.fields[0], system_value: null },
   { fieldname: "custom_employee_code", label: "公司工号", editable: true, different: false, can_apply: true, fieldtype: "Data", dingtalk_value: "" }
  ] }); await tick();
  const d = h.sections.get(".review-detail");
  assert(d.innerHTML.includes("采用钉钉值"));
  assert(!d.innerHTML.includes("data-reason"));
  assert(d.innerHTML.includes("暂不录入"));
  const save = d.querySelector("[data-save]").children[0];
  assert.equal(save.textContent, "预检并新建员工");
  save.onclick(); await tick(); assert.equal(h.requests.length, 2);
  const name = d.querySelector('[data-choice="0"]'); name.value = "dingtalk"; name.onchange();
  const code = d.querySelector('[data-choice="1"]'); code.value = "custom"; code.onchange();
  h.controls[0].value = "1001"; h.controls[0].change();
  save.onclick(); await tick();
  assert(h.requests[2].method.endsWith("preview_roster_new_employee"));
  assert.equal(h.requests[2].args.reason, undefined);
  assert.equal(JSON.parse(h.requests[2].args.decisions_json).custom_employee_code.value, "1001");
  h.requests[2].resolve({ can_create: true, values: { employee_name: "钉钉姓名" }, labels: { employee_name: "姓名" }, preview_token: "P1" }); await tick();
  assert.equal(h.requests.length, 3, "preview must not create an employee");
  h.dialogs[0].primary_action(); await tick();
  assert(h.requests[3].method.endsWith("create_roster_new_employee"));
  assert.equal(h.requests[3].args.preview_token, "P1");
 }

 {
  const h = harness(); await open(h);
  const d = h.sections.get(".review-detail");
  assert(d.innerHTML.includes("&lt;script&gt;"));
  assert.equal(h.sections.get(".review-list").hidden, true);
  assert.equal(d.hidden, false);
  assert(d.innerHTML.includes("review-field-conflict"));
  assert.equal(d.querySelector('[data-choice="0"]').value, "pending");
  d.querySelector("[data-save]").children[0].onclick(); await tick();
  assert.equal(h.requests.length, 2, "unresolved conflicts must block saving");
  const choice = d.querySelector('[data-choice="0"]'); choice.value = "keep"; choice.onchange();
  assert.equal(d.querySelector('[data-result="0"]').textContent, "原姓名");
  d.querySelector("[data-save]").children[0].onclick(); await tick();
  assert.equal(h.requests[2].args.keep_fieldnames_json, '["employee_name"]');
  assert.equal(h.requests[2].args.fieldnames_json, '[]');
  assert.equal(h.requests[2].args.expected_modified, "e1");
  assert.equal(h.requests[2].args.expected_import_modified, "v1");
 }
 {
  const h = harness(); await open(h);
  const d = h.sections.get(".review-detail"), choice = d.querySelector('[data-choice="0"]');
  choice.value = "custom"; choice.onchange(); h.controls[0].value = "自定义姓名"; h.controls[0].change();
  assert.equal(d.querySelector('[data-result="0"]').textContent, "自定义姓名");
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
 {
  const h = harness(); await open(h);
  const d = h.sections.get(".review-detail"), choice = d.querySelector('[data-choice="0"]');
  choice.value = "dingtalk"; choice.onchange();
  assert.equal(d.querySelector('[data-result="0"]').textContent, "钉钉姓名");
  d.querySelector("[data-detail-back]").children[0].onclick();
  assert.equal(h.confirmations.length, 1);
  assert.equal(d.hidden, false, "unsaved edits stay visible until discard confirmed");
  h.confirmations[0].yes();
  assert.equal(d.hidden, true); assert.equal(h.sections.get(".review-list").hidden, false);
 }
 {
  const h = harness(); h.requests[0].resolve(listResult); await tick();
  const actions = h.sections.get(".review-actions"), search = actions.children[5];
  const selected = h.sections.get(".review-list").querySelector('[data-select-row="0"]'); selected.checked = true; selected.onchange();
  search.value = "第二百名员工"; search.oninput(); search.onkeydown({ key: "Enter" });
  assert.equal(h.requests[1].args.query, "第二百名员工");
  assert.equal(h.requests[1].args.start, 0);
  h.requests[1].resolve({ ...listResult, total: 232, filtered_total: 1, rows: [{ name: "I200", employee_name: "第二百名员工" }], has_more: false }); await tick();
  assert(h.sections.get(".review-list").innerHTML.includes("查询匹配 1 人"));
  assert(h.sections.get(".review-actions").children[3].textContent.includes("1"), "search preserves selections");
  const sorting = h.sections.get(".review-actions").children[8]; sorting.value = "date_of_joining"; sorting.onchange();
  assert.equal(h.requests[2].args.sort_by, "date_of_joining");
  assert.equal(h.requests[2].args.query, "第二百名员工");
  h.requests[2].resolve({ ...listResult, filtered_total: 1 }); await tick();
  h.sections.get(".review-actions").children[9].onclick();
  assert.equal(h.requests[3].args.sort_order, "desc");
  h.requests[3].resolve({ ...listResult, filtered_total: 1 }); await tick();
  const filter = h.sections.get(".review-actions").children[4]; filter.value = "same"; filter.onchange();
  assert.equal(h.requests[4].args.review_filter, "same");
  h.requests[4].resolve({ ...listResult, rows: [], filtered_total: 0, has_more: false }); await tick();
  assert(h.sections.get(".review-list").innerHTML.includes("没有符合条件"));
  h.sections.get(".review-actions").children[7].onclick();
  assert.equal(h.requests[5].args.query, ""); assert.equal(h.requests[5].args.review_filter, "all");

 }
 {
  const h = harness(); h.requests[0].resolve(listResult); await tick();
  const list = h.sections.get(".review-list"), d = h.sections.get(".review-detail");
  list.querySelector('[data-detail="0"]').onclick();
  d.querySelector("[data-detail-back]").children[0].onclick();
  h.requests[1].resolve(detailResult); await tick();
  assert.equal(d.hidden, true, "late detail response must not reopen editor");
 }
 {
  const h = harness(); h.requests[0].resolve(listResult); await tick();
  let list = h.sections.get(".review-list"), actions = h.sections.get(".review-actions");
  let check = list.querySelector('[data-select-row="0"]'); check.checked = true; check.onchange();
  assert.equal(actions.children[3].disabled, false);
  assert(actions.children[3].textContent.includes("1"));
  list.querySelector(".review-pager").children[2].onclick();
  h.requests[1].resolve({ ...listResult, rows: [{ name: "I2", employee_name: "第二页" }] }); await tick();
  check = list.querySelector('[data-select-visible]'); check.checked = true; check.onchange();
  actions = h.sections.get(".review-actions"); actions.children[3].onclick(); await tick();
  assert.equal(h.requests[2].args.import_names_json, '["I1","I2"]');
  h.requests[2].resolve({ sync_log: "S1", selected_count: 2, can_import: true, preview_token: "TOKEN", warnings: ["缺少入职日期<待补>"] }); await tick();
  assert(h.dialogs[0].title.includes("所选"));
  assert(h.dialogs[0].fields[0].options.includes("缺少入职日期&lt;待补&gt;"));
  assert(h.dialogs[0].primary_action_label.includes("人工审核确认"));
  h.dialogs[0].primary_action(); await tick();
  assert.equal(h.requests[3].args.import_names_json, '["I1","I2"]');
  assert.equal(h.requests[3].args.preview_token, "TOKEN");
 }
 {
  const h = harness(); h.requests[0].resolve(listResult); await tick();
  const actions = h.sections.get(".review-actions"); actions.children[2].onclick(); await tick();
  assert.equal(h.requests[1].args.import_names_json, undefined, "all update must omit selection");
  const check = h.sections.get(".review-list").querySelector('[data-select-row="0"]'); check.checked = true; check.onchange();
  h.company("B"); h.show(); h.requests[2].resolve({ ...listResult, sync_log: "S2" }); await tick();
  assert.equal(h.sections.get(".review-actions").children[3].disabled, true, "company change clears selection");
 }

 console.log("Review page runtime: dedicated entry, escaped full details, keep/custom decisions, selected attachment verification, legacy Deferred, company/route response isolation passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
