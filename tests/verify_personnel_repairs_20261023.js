const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(root,p), "utf8");
const handlers = {};
const calls = [];
const frappe = {
 ui: {form: {on: (name, events) => {handlers[name] = events;}, QuickEntryForm: class {
  constructor(doc) {this.doc = doc; this.dialog = {set_df_property: (...args) => calls.push(args)};}
  render_dialog() {calls.push("render");}
 }}},
 get_route: () => ["Form", "Employee Promotion", "PROMO-1"],
 new_doc: (...args) => calls.push(args),
 show_alert: () => {},
};
const context = vm.createContext({frappe, window: {}, __: s=>s});
vm.runInContext(read("hrms/hr/doctype/employee_promotion/employee_promotion.js").replace(/{%[^%]*%}/g,""),context);
for (const [doc, expected] of [
 [{custom_is_confirmation_interview:1}, "转正日期"],
 [{promotion_details:[{fieldname:"final_confirmation_date"}]}, "转正日期"],
 [{promotion_details:[{fieldname:"designation"}]}, "Promotion Date"],
]) {
 calls.length=0;
 context.configure_confirmation_interview({doc, set_df_property:(...args)=>calls.push(args),toggle_display:()=>{}});
 assert.strictEqual(calls.find(c=>c[0]==="promotion_date")[2],expected);
}
for (const flag of [0,1]) {
 calls.length=0;
 new frappe.ui.form.EmployeePromotionQuickEntryForm({custom_is_confirmation_interview:flag}).render_dialog();
 assert.strictEqual(calls[0],"render");
 assert.strictEqual(calls.length,flag ? 2 : 1);
 if (flag) assert.strictEqual(calls[1][2],"转正日期");
}
calls.length=0;
frappe.get_route=()=>["List","Employee Promotion","List"];
new frappe.ui.form.EmployeePromotionQuickEntryForm({}).render_dialog();
assert.strictEqual(calls[1][2],"转正日期","Confirmation management popup must use the confirmation label without changing workflow flags");
const employee = read("hrms/public/js/erpnext/employee.js");
vm.runInContext(employee,context);
const fields = ["job_applicant","personal_email","company_email","prefered_contact_email"];
for (const account of [false,true]) {
 calls.length=0;
 context.setup_employee_optional_recruitment_fields({doc:{create_user_automatically:account},fields_dict:Object.fromEntries(fields.map(f=>[f,{}])),set_df_property:(...a)=>calls.push(a)});
 assert(calls.some(c=>c[0]==="job_applicant" && c[1]==="reqd" && c[2]===false));
 assert.strictEqual(calls.some(c=>c[0]==="personal_email"),!account);
}
const list=read("hrms/public/js/erpnext/employee_list.js");
function extract(name) {
 const start=list.indexOf(`\tfunction ${name}(`);
 assert(start>=0,name);
 const end=list.indexOf("\n\tfunction ",start+1);
 return list.slice(start,end);
}
vm.runInContext(["get_roster_date_only","is_roster_contract_expiry_warning","render_roster_table_cell"].map(extract).join("\n"),context);
context.get_roster_table_cell_value=emp=>emp.contract_end_date;
const today="2026-09-15";
assert.strictEqual(context.is_roster_contract_expiry_warning("2026-11-15",today,{status:"Active"}),true);
assert.strictEqual(context.is_roster_contract_expiry_warning("2026-11-16",today,{status:"Active"}),false);
for (const emp of [{status:"Left"},{custom_work_nature:"离职"},{custom_work_nature:"已离职"}]) {
 assert.strictEqual(context.is_roster_contract_expiry_warning("2026-09-01",today,{...emp,contract_expiry_warning:true}),false);
 context.document={createElement:()=>({classList:{add:()=>{throw Error("Departed employee highlighted");}}})};
 context.render_roster_table_cell({...emp,contract_end_date:"2026-09-01"},{fieldname:"contract_end_date"},1);
}
assert.strictEqual(context.is_roster_contract_expiry_warning("2026-09-01",today,{status:"Active",contract_expiry_warning:false}),false,"Server date is authoritative across browser timezones");
let highlighted=false;
context.document={createElement:()=>({classList:{add:()=>{highlighted=true;}}})};
context.render_roster_table_cell({status:"Active",contract_end_date:"2026-09-01",contract_expiry_warning:true},{fieldname:"contract_end_date"},1);
assert(highlighted,"Active employee reminder remains visible");
console.log("Personnel runtime regressions passed: optional entry, confirmation form and Quick Entry, departure reminder rendering.");
