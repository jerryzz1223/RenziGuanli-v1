const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
let dialog, calls = [], refreshes = 0;
const context = {
 window: {}, __: value => value,
 frappe: {utils:{escape_html:escape}, msgprint:()=>{}, ui:{Dialog:class {
   constructor(options) { this.options=options; dialog=this; }
   show() {} hide() {this.hidden=true;}
 }}, call:args => {calls.push(args); return {then(resolve){resolve({message:{}});}};}}
};
const source = fs.readFileSync(path.join(root,'hrms/public/js/hrms_employee_form_entry.js'),'utf8')
 .replace('window.HRMSEmployeeFormSubmitPage = {','window.TestPage = EmployeeFormSubmitPage; window.HRMSEmployeeFormSubmitPage = {');
vm.runInNewContext(source,context);
const page = Object.create(context.window.TestPage.prototype);
const view = {innerHTML:'', querySelectorAll:()=>[]};
Object.assign(page,{wrapper:{querySelector:()=>view},form:{label:'员工谈话表'},form_type:'employee_talk',load_record_rows:()=>refreshes++});
page.render_record_rows([{name:'F1',file_url:'/private/files/test.pdf',entry_status:'已撤销',revocation_reason:'<script>test</script>',revoked_by:'hr'}]);
assert(view.innerHTML.includes('已撤销'));
assert(view.innerHTML.includes('&lt;script>'));
assert(!view.innerHTML.includes('data-revoke-file='));
assert(view.innerHTML.includes('/private/files/test.pdf'));
page.render_record_rows([{name:'F2',file_url:'/private/files/test.pdf',entry_status:'已录入'}]);
assert(view.innerHTML.includes('data-revoke-file="F2"'));
page.revoke_record('F2');
dialog.options.primary_action({reason:'  '});
assert.equal(calls.length,0);
(async()=>{
 await dialog.options.primary_action({reason:'录入错误'});
 assert.equal(calls[0].args.file_name,'F2');
 assert.equal(calls[0].args.form_type,'employee_talk');
 assert.equal(calls[0].args.reason,'录入错误');
 assert.equal(refreshes,1);
 assert(dialog.hidden);
 console.log('form revocation render, escaping, required reason, and Deferred runtime passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
