const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
function load(page, name, call) {
 const context = { window: {}, console, __: text => text,
  frappe: { pages: { [page]: {} }, call, session: { user: 'tester' } },
 };
 const file = page.replaceAll('-', '_');
 const source = fs.readFileSync(path.join(root, `hrms/hr/page/${file}/${file}.js`), 'utf8');
 vm.runInNewContext(`${source}\nglobalThis.PageClass = ${name};`, context);
 return { context, view: Object.create(context.PageClass.prototype) };
}
function pending() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }

test('payroll shares simultaneous reads, returns cached data and manual reads bypass it', async () => {
 const requests = [];
 const f = load('payroll-input-center', 'PayrollInputCenter', opts => {
  const p = pending(); requests.push({opts,...p}); return p.promise;
 });
 Object.assign(f.view, { company:'A', payroll_month:'2026-11', active_tab:'monthly-workbench', has_unsaved_salary_changes:()=>false });
 const rendered = [];
 const options = {method:'hrms.api.payroll_input.get_payroll_home_dashboard',args:{company:'A'},callback:r=>rendered.push(r.message.count)};
 const first = f.view.call_payroll_api(options);
 const second = f.view.call_payroll_api(options);
 assert.equal(requests.length,1);
 const response = {message:{count:2}};
 requests[0].opts.callback(response); requests[0].resolve(response);
 await Promise.all([first,second]);
 assert.deepEqual(rendered,[2,2]);
 f.view.reuse_navigation_reads=true;
 await f.view.call_payroll_api(options);
 assert.equal(requests.length,1);
 f.view.reuse_navigation_reads=false;
 f.view.call_payroll_api(options);
 assert.equal(requests.length,2,'explicit refresh reaches server');
});
test('payroll writes invalidate cached reads; late callbacks cannot overwrite pending edits', () => {
 const requests=[];
 const f=load('payroll-input-center','PayrollInputCenter', opts => {requests.push(opts); return new Promise(()=>{});});
 let edited=false, renders=0;
 Object.assign(f.view,{company:'A',payroll_month:'2026-11',active_tab:'salary-register',has_unsaved_salary_changes:()=>edited});
 const options={method:'hrms.api.standing_pay.list_register',args:{company:'A'},callback:()=>renders++};
 f.view.call_payroll_api(options);
 edited=true;
 requests[0].callback({message:{rows:[]}});
 assert.equal(renders,0);
 f.view.call_payroll_api({method:'hrms.api.standing_pay.submit_contribution',args:{}});
 assert.equal(f.view.page_read_cache.size,0);
 assert.equal(f.view.page_read_requests.size,0);
 requests[0].callback({message:{rows:[]}});
 assert.equal(f.view.page_read_cache.size,0,'pre-save response cannot restore old cache');
});
test('recruitment merges load/show requests and retains rows during a later refresh', async () => {
 const requests=[];
 const f=load('recruitment-center','RecruitmentCenter',opts=>{const p=pending();requests.push({opts,...p});return p.promise;});
 const results={innerHTML:'',setAttribute(){},removeAttribute(){}};
 const controls=new Map();
 const control=selector=>{
  if(selector==='[data-register-results]')return results;
  if(!controls.has(selector))controls.set(selector,{value:'',disabled:false,textContent:''});
  return controls.get(selector);
 };
 Object.assign(f.view,{mode:'register',start:0,request_id:0,
  wrapper:{querySelector:control,querySelectorAll:()=>[]},company_control:{get_value:()=> 'A'},
  empty:()=> 'loading',render_register_rows(data){this.register_data=data;results.innerHTML='rows';},
 });
 const first=f.view.refresh_register();
 const second=f.view.refresh_register({reuse:true});
 assert.equal(first,second);
 await Promise.resolve();
 assert.equal(requests.length,1);
 requests[0].resolve({message:{rows:[{name:'one'}],can_create:false}});
 await first;
 await f.view.refresh_register({reuse:true});
 assert.equal(requests.length,1);
 const next=f.view.refresh_register();
 assert.equal(results.innerHTML,'rows','do not blank the already loaded table');
 await Promise.resolve();
 requests[1].resolve({message:{rows:[],can_create:false}});
 await next;
});
test('organization shares sync/read work and never uses a global freeze for reading the tree', async () => {
 const requests=[];
 const f=load('organizational-chart','HybridOrganizationChart',opts=>{const p=pending();requests.push({opts,...p});return p.promise;});
 const host={innerHTML:'existing tree'};
 Object.assign(f.view,{company:'A',source_mode:'manual',mode:'chart',tree_request_id:0,
  tree:{root:{node_id:'root'}},wrapper:{querySelector:()=>host},is_active:()=>true,
  collapsed_nodes:new Set(),collect_node_ids:()=>['root'],render_summary(){},render_source_label(){},render_tree(){},
  find_node:()=>null,select_node(){},
 });
 const first=f.view.load_tree(),second=f.view.load_tree();
 assert.equal(first,second);
 assert.equal(host.innerHTML,'existing tree');
 await Promise.resolve();
 assert.equal(requests.length,1);
 requests[0].resolve({message:{}});
 for(let i=0;i<4;i++)await Promise.resolve();
 assert.equal(requests.length,2);
 assert.equal(requests[1].opts.freeze,false);
 requests[1].resolve({message:{root:{node_id:'root',children:[]}}});
 await first;
 assert.equal(f.view.tree_load_promise,null);
 assert.ok(f.view.last_refresh_at>0);
});

test('announcement lists and details are nonblocking; writes keep their operation freeze', async () => {
 const requests=[],hrms={};
 const context={window:{hrms},hrms,frappe:{call:options=>{requests.push(options);return Promise.resolve({message:{}});}}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'hrms/public/js/hrms_announcement.js'),'utf8'),context);
 await hrms.announcement.call('hrms.api.announcement.list_announcements');
 await hrms.announcement.call('hrms.api.announcement.get_announcement');
 await hrms.announcement.call('hrms.api.announcement.review_announcement');
 assert.deepEqual(requests.map(r=>r.freeze),[false,false,true]);
});

test('payroll source initializers and approvals must never be served from the read cache', () => {
 const requests=[];
 const f=load('payroll-input-center','PayrollInputCenter',options=>{requests.push(options);return new Promise(()=>{});});
 Object.assign(f.view,{has_unsaved_salary_changes:()=>false,reuse_navigation_reads:true});
 for(const method of ['hrms.api.payroll_input.list_payroll_variable_source_types','hrms.api.standing_pay.review_decision']){
  f.view.call_payroll_api({method,freeze:true});
  f.view.call_payroll_api({method,freeze:true});
 }
 assert.equal(requests.length,4);
 assert.ok(requests.every(r=>r.freeze===true));
});
