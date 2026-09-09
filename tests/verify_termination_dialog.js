const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../hrms/hr/page/payroll_input_center/payroll_input_center.js"), "utf8");
let dialog;
const calls = [];
const messages = [];
const context = {
  employee_name: "测试员工", employee_code: "TEST-1", source_hash: "source-v1", saved: {}, decision: {},
  inputs: { base_salary: 2660, standard_hours: 184, basic_attendance_hours: 32 },
  fields: ["base_salary", "standard_hours", "basic_attendance_hours"].map(fieldname => ({ fieldname, label: fieldname })),
};
const frappe = {
  pages: { "payroll-input-center": {} }, utils: { escape_html: value => String(value) },
  datetime: { get_today: () => "2026-09-07" }, msgprint: message => messages.push(message), show_alert: () => {},
  ui: { Dialog: class {
    constructor(options) {
      this.options = options;
      this.values = Object.fromEntries(options.fields.map(field => [field.fieldname, field.default ?? null]));
      this.fields_dict = { preview: { $wrapper: { html: value => { this.preview = value; } } } };
      dialog = this;
    }
    get_value(field) { return this.values[field]; }
    show() {}
    hide() {}
  } },
  call: request => {
    calls.push(request);
    if (request.method.endsWith("get_termination_settlement_context")) request.callback({ message: context });
    if (request.method.endsWith("preview_termination_settlement")) request.callback({ message: { calculated: { gross_pay: 936.52, net_pay: 868.87 }, formula_trace: [] } });
  },
};
const sandbox = { frappe, console };
vm.runInNewContext(source + "\nthis.Center = PayrollInputCenter;", sandbox);
const page = Object.create(sandbox.Center.prototype);
let scope = { company: "ACME", payroll_month: "2026-07", attendance_lock_version: "lock-v1" };
page.scope_args = () => scope;
page.format_money = value => Number(value).toFixed(2);
page.load_active_tab = () => {};
page.open_termination_settlement("TEST-1");
const saveValues = { decision_reason: "核对样例", settlement_basis: "样例表", settlement_date: "2026-09-07" };

dialog.options.primary_action(saveValues);
assert.match(messages.at(-1), /先试算/);
assert.equal(calls.some(call => call.method.endsWith("save_monthly_payroll_participation_decision")), false);

dialog.options.secondary_action();
assert.equal(JSON.parse(calls.at(-1).args.inputs_json).income_tax_override, null);
assert.match(dialog.preview, /868.87/);
dialog.values.base_salary = 2700;
dialog.options.primary_action(saveValues);
assert.match(messages.at(-1), /重新试算/);

dialog.values.base_salary = 2660;
dialog.values.use_confirmed_income_tax = 1;
dialog.values.income_tax_override = 0;
dialog.options.secondary_action();
assert.equal(JSON.parse(calls.at(-1).args.inputs_json).income_tax_override, 0);
dialog.options.primary_action(saveValues);
let saved = calls.at(-1);
assert.match(saved.method, /save_monthly_payroll_participation_decision$/);
assert.equal(saved.args.employee, "TEST-1");
assert.equal(saved.args.decision, "离职结算");
assert.equal(JSON.parse(saved.args.termination_inputs_json).inputs.income_tax_override, 0);
assert.equal(JSON.parse(saved.args.termination_inputs_json).source_hash, "source-v1");

scope = { ...scope, company: "OTHER" };
const count = calls.length;
dialog.options.primary_action(saveValues);
assert.equal(calls.length, count);
assert.match(messages.at(-1), /已切换/);
console.log("PASS: preview required, changed inputs blocked, default tax vs explicit zero, approved scope payload, company switch blocked");
