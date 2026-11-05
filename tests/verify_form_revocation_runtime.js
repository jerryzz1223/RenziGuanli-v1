const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
let dialog, calls = [], refreshes = 0, messages = [];
const context = {
 window: {}, __: value => value,
 frappe: {utils:{escape_html:escape}, msgprint:message=>messages.push(message), ui:{Dialog:class {
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
page.render_record_rows([{name:'F1',file_url:'/private/files/test.pdf',entry_status:'已撤销',revocation_reason:'<script>test</script>',revoked_by:'<script>hr</script>',revoked_at:'2026-10-30 10:00:00'}]);
assert(view.innerHTML.includes('已撤销'));
assert(view.innerHTML.includes('&lt;script>'));
assert(!view.innerHTML.includes('撤销原因'));
assert(view.innerHTML.includes('data-restore-file="F1"'));
assert(view.innerHTML.includes('最近撤销记录'));
assert(!view.innerHTML.includes('data-revoke-file='));
assert(view.innerHTML.includes('/private/files/test.pdf'));
page.render_record_rows([{name:'F2',file_url:'/private/files/test.pdf',entry_status:'已录入'}]);
assert(view.innerHTML.includes('data-revoke-file="F2"'));
page.revoke_record('F2');
assert(dialog.options.fields.every(field=>field.fieldtype === 'HTML'));
(async()=>{
 await dialog.options.primary_action();
 assert.equal(calls[0].args.file_name,'F2');
 assert.equal(calls[0].args.form_type,'employee_talk');
 assert(!('reason' in calls[0].args));
 assert(calls[0].method.endsWith('.revoke_employee_form_entry'));
 assert.equal(refreshes,1);
 assert(dialog.hidden);
 page.revoke_record('F3', true);
 const retryDialog = dialog;
 let rejectRequest;
 context.frappe.call = args => {
   calls.push(args);
   return {then(resolve, reject){rejectRequest=reject;}};
 };
 const pending = retryDialog.options.primary_action();
 retryDialog.options.primary_action();
 page.revoke_record('F3', true);
 assert.strictEqual(dialog, retryDialog);
 // Let the native Promise assimilate the legacy then-only Deferred.
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,2);
 assert(calls[1].method.endsWith('.restore_employee_form_entry'));
 assert(!('reason' in calls[1].args));
 rejectRequest(new Error('network unavailable'));
 await pending;
 assert(!retryDialog.hidden, 'Failure must keep the dialog available for retry.');
 assert.equal(refreshes,1, 'Failure must not report a successful refresh.');
 assert(messages.some(message=>message.includes('恢复未完成')));
 context.frappe.call = args => {calls.push(args); return Promise.resolve({message:{}});};
 await retryDialog.options.primary_action();
 assert(retryDialog.hidden);
 assert.equal(refreshes,2);
 console.log('form revocation rendering, reason-free revoke/restore, Deferred compatibility, duplicate protection, and failure/retry runtime passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
