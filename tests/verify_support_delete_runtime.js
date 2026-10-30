const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const handlers = {};
let request, searched=0, optionsLoaded=0, route, details;
const context={
 __: (text,args=[])=>text.replace('{0}',args[0]||''),
 $:()=>({on:(event,selector,fn)=>{handlers[selector]=fn;}}),
 frappe:{set_route:(...args)=>route=args,pages:{"cross-department-support":{}},utils:{escape_html:value=>String(value).replaceAll('<','&lt;').replaceAll('"','&quot;')},
 confirm:(message,yes)=>yes(),
 call:args=>{request=args;return {then:resolve=>resolve({message:{}})};}}
};
const source=fs.readFileSync(path.join(__dirname,'../hrms/hr/page/cross_department_support/cross_department_support.js'),'utf8');
vm.runInNewContext(source+'\nglobalThis.SupportPage = CrossDepartmentSupportPage;',context);
const page=new context.SupportPage({main:[{}]});
const row={name:'CAP-1',employee:'EMP-1',employee_name:'Test',support_designation:'IPQC'};
assert(!page.render_row(row).includes('data-delete-capability'));
assert(page.render_row(row).includes('data-support-action'), 'every candidate should have a visible support action');
page.can_delete=true;
assert(page.render_row(row).includes('data-delete-capability="CAP-1"'));
page.rows=[row];page.page_number=2;
page.search=()=>searched++;
page.load_filter_options=()=>optionsLoaded++;
page.bind_events();
page.open_support_details=value=>details=value;
let dispatched;
page.open_dispatch_dialog=value=>dispatched=value;
handlers['[data-support-action]']({stopPropagation(){},currentTarget:{dataset:{supportAction:'CAP-1'}}});
assert.equal(dispatched,row);
assert.equal(details,undefined);
handlers['[data-support-employee]']({preventDefault(){},stopPropagation(){},currentTarget:{dataset:{supportEmployee:'EMP-1'}}});
assert.deepEqual(route,['employee-detail','EMP-1']);
handlers['[data-capability]']({target:{closest:()=>false},currentTarget:{dataset:{capability:'CAP-1'}}});
assert.equal(details,row);
details=null;
handlers['[data-capability]']({target:{closest:()=>true},currentTarget:{dataset:{capability:'CAP-1'}}});
assert.equal(details,null);
assert(page.render_row({...row,monthly_count:0,total_count:3}).includes('<td>0</td><td>3</td>'));

handlers['[data-delete-capability]']({stopPropagation(){},currentTarget:{dataset:{deleteCapability:'CAP-1'}}});
setImmediate(()=>{
 assert.equal(request.args.name,'CAP-1');
 assert.equal(page.page_number,1);
 assert.equal(searched,1);
 assert.equal(optionsLoaded,1);
 console.log('support delete visibility, action, Deferred, refresh and last-page handling passed');
});
