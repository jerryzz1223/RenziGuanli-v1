// Local browser harness with simulated Frappe controls and sample data; does not connect to a live site.
// Run with Playwright installed: node tests/manual_employee_transfer_editor_browser.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const output = process.env.HRMS_TRANSFER_PREVIEW_DIR || '/tmp/hrms-transfer-editor-preview';
fs.mkdirSync(output, { recursive: true });
(async () => {
 const browser = await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page = await browser.newPage({viewport:{width:1360,height:1080},deviceScaleFactor:1});
 await page.setContent(`<html lang="zh-CN"><head><meta charset="utf-8"><style>body{margin:0;background:#f5f7fa;font:14px -apple-system,BlinkMacSystemFont,"Arial",sans-serif;color:#243247;--text-color:#243247;--text-muted:#526175;--card-bg:#fff;--subtle-fg:#f3f6fa;--border-color:#e2e8f0}main{max-width:1120px;margin:28px auto;padding:28px;background:#fff;border:1px solid #e2e8f0;border-radius:12px}h2{margin:0 0 8px;font-size:21px}p{color:#526175;margin-bottom:24px}label{display:block;font-size:13px;margin-bottom:8px}.form-control{box-sizing:border-box;width:100%;font-size:14px;padding:8px}button,input{font:inherit} @media(max-width:720px){main{margin:8px;padding:14px}}</style></head><body><main><h2>员工调岗 <small style="color:#a86a08;font-size:13px">草稿</small></h2><p>异动明细 · 提交后更新员工档案并写入任职记录</p><div id="field"><div id="grid"></div></div></main></body></html>`);
 await page.evaluate(() => {
 class Q {
  constructor(nodes){this.nodes=nodes;this.length=nodes.length;nodes.forEach((n,i)=>this[i]=n)}
  find(s){return new Q(this.nodes.flatMap(n=>[...n.querySelectorAll(s)]))}
  html(s){if(s===undefined)return this[0]?.innerHTML;this.nodes.forEach(n=>n.innerHTML=s);return this}
  text(s){this.nodes.forEach(n=>n.textContent=s);return this}
  addClass(s){this.nodes.forEach(n=>n.classList.add(s));return this}
  remove(){this.nodes.forEach(n=>n.remove());return this}
  before(q){this.nodes.forEach(n=>q.nodes.forEach(c=>n.before(c)));return this}
  append(...args){this.nodes.forEach(n=>args.forEach(q=>q.nodes.forEach(c=>n.append(c))));return this}
  appendTo(n){this.nodes.forEach(c=>n.append(c));return this}
  empty(){return this.html('')}
  attr(k,v){if(v===undefined)return this[0]?.getAttribute(k);this.nodes.forEach(n=>n.setAttribute(k,v));return this}
  detach(){this.nodes.forEach(n=>n.remove());return this}
  each(cb){this.nodes.forEach((n,i)=>cb.call(n,i,n));return this}
  prop(k,v){this.nodes.forEach(n=>n[k]=v);return this}
  off(event){this.nodes.forEach(n=>{const list=n._listeners||[];list.filter(l=>l.event===event).forEach(l=>n.removeEventListener(l.type,l.cb));n._listeners=list.filter(l=>l.event!==event)});return this}
  on(event,selector,cb){if(typeof selector==='function'){cb=selector;selector=null}this.nodes.forEach(n=>{const type=event.split('.')[0];const listener=e=>{const t=selector?e.target.closest(selector):n;if(t)cb.call(t,e)};n.addEventListener(type,listener);(n._listeners||(n._listeners=[])).push({event,type,cb:listener})});return this}
  val(s){if(s===undefined)return this[0].value;this.nodes.forEach(n=>n.value=s);return this}
 }
 window.$=(s,attrs)=>{let nodes;if(typeof s==='string'&&s.trim().startsWith('<')){const t=document.createElement('template');t.innerHTML=s;nodes=[...t.content.children]}else nodes=typeof s==='string'?[...document.querySelectorAll(s)]:[s];const q=new Q(nodes);if(attrs)Object.entries(attrs).forEach(([k,v])=>q.attr(k,v));return q};
 window.__=(s,args=[])=>s.replace(/\{(\d+)\}/g,(_,n)=>args[n]);
 const fields=[['department','部门','Link'],['designation','岗位','Link'],['employment_type','工作性质','Select'],['custom_direct_indirect','直间接','Select'],['reports_to','直属上级','Link'],['grade','职级','Link'],['custom_is_confirmed','是否转正','Select']].map(([fieldname,label,fieldtype])=>({fieldname,label,fieldtype}));
 window.cur_frm={doctype:'Employee Transfer'};
 window.TRANSFER_WORK_NATURE_OPTIONS=['在职 · 正式','在职 · 试用期','退休返聘','待离职','离职'];
 window.frappe={ui:{form:{on(){},make_control({parent,df}){const label=$('<label>').text(df.label+' *');const input=$('<input>').addClass('form-control').attr('placeholder','请选择'+df.label.split(' · ')[0]);parent.append(label,input);const control={get_value:()=>input.val(),set_value:v=>input.val(v)};input.on('change',()=>df.change());return control}}},meta:{get_docfield:(d,f)=>fields.find(x=>x.fieldname===f)},get_meta:()=>({fields})};
 window.previewFields=fields;
 });
 await page.addScriptTag({content:fs.readFileSync(path.join(root, 'hrms/hr/employee_property_update.js'),'utf8')});
 await page.evaluate(()=>{
 window.frm={doc:{employee:'DEMO',docstatus:0,transfer_details:[{name:'d',fieldname:'department',property:'部门',current:'生产一部',new:''},{name:'p',fieldname:'designation',property:'岗位',current:'作业员',new:''}]},fields_dict:{transfer_details:{grid:{wrapper:$('#grid')},$wrapper:$('#field')}}};
 setup_transfer_property_editor(frm,'transfer_details',previewFields.map(f=>({value:f.fieldname,label:f.label})));
 });
 await page.evaluate(async()=>{
  const assert=(condition,message)=>{if(!condition)throw Error(message)};
  const table='transfer_details';
  frm.doc.transfer_details.forEach(r=>r.doctype='Employee Property History');
  frm.refresh_field=()=>{};frm.dirty=()=>{};
  frm.add_child=(table,row)=>{frm.doc[table].push({...row,name:'row-'+Math.random(),doctype:'Employee Property History'})};
  frappe.throw=message=>{throw Error(message)};
  frappe.msgprint=()=>{};
  frappe.model={set_value(dt,name,field,value){frm.doc.transfer_details.find(r=>r.name===name)[field]=value},clear_doc(dt,name){frm.doc.transfer_details=frm.doc.transfer_details.filter(r=>r.name!==name)}};
  let confirm;
  frappe.confirm=(msg,callback)=>{confirm=callback};
  const propertyCalls=[];
  frappe.call=opts=>{propertyCalls.push(opts)};
  const dept=document.querySelector('[data-transfer-property-group="department"] input');
  dept.value='D2';dept.dispatchEvent(new Event('change',{bubbles:true}));
  const position=document.querySelectorAll('[data-transfer-property-group="department"] input')[1];
  position.value='P2';position.dispatchEvent(new Event('change',{bubbles:true}));
  assert(frm.doc.transfer_details[1].new==='P2','岗位值未保存');
  const pending=add_inline_transfer_property(frm,table,'grade');
  assert(dept===document.querySelector('[data-transfer-property-group="department"] input'),'读取期间已有输入框被重建');
  assert(position.value==='P2','岗位内容丢失');
  propertyCalls.shift().callback({message:{value:'G1',label:'职级'}});
  await pending;
  assert(dept===document.querySelector('[data-transfer-property-group="department"] input'),'添加新项目重建了已有输入框');
  dept.value='D3';dept.dispatchEvent(new Event('change',{bubbles:true}));
  assert(position.value==='' && frm.doc.transfer_details[1].new==='','换部门未清空岗位');
  remove_inline_transfer_property(frm,table,'department');
  assert(document.querySelector('[data-transfer-property-group="department"]'),'确认前已移除');
  confirm();
  assert(!document.querySelector('[data-transfer-property-group="department"]'),'确认后未移除');
  assert(document.querySelector('[data-transfer-property-group="grade"]'),'移除部门影响其他项目');
  // Replacing document objects after save must reconnect controls to the new rows.
  const grade=document.querySelector('[data-transfer-property-group="grade"] input');
  frm.doc.transfer_details=frm.doc.transfer_details.map(r=>({...r,new:'G2'}));
  render_transfer_property_editor(frm,table);
  assert(grade!==document.querySelector('[data-transfer-property-group="grade"] input'),'重新加载后的控件仍绑定旧明细');
  assert(document.querySelector('[data-transfer-property-group="grade"] input').value==='G2','重新加载值未显示');
  frm.doc.docstatus=1;render_transfer_property_editor(frm,table);
  assert(!document.querySelector('[data-add-transfer-property]')&&!document.querySelector('[data-remove-transfer-property]')&&!document.querySelector('#field input'),'已提交状态仍能编辑');
  frm.doc.docstatus=0;frm.perm=[{read:1,write:0}];render_transfer_property_editor(frm,table);
  assert(!document.querySelector('#field input'),'只读权限仍能编辑');
  delete frm.perm;
  frm.doc.transfer_details=[{name:'manager',doctype:'Employee Property History',fieldname:'reports_to',property:'直属上级',current:'M0',new:''}];
  render_transfer_property_editor(frm,table);
  let managerInput=document.querySelector('[data-transfer-property-group="reports_to"] input');
  assert(managerInput.disabled,'读取上级候选时输入框应禁用');
  propertyCalls.shift().error();
  document.querySelector('[data-transfer-property-group="reports_to"] .hrms-transfer-property-target button').click();
  assert(propertyCalls.length===1,'重新加载按钮失效');
  propertyCalls.shift().callback({message:[{name:'M1',employee_code:'1001',employee_name:'同名'},{name:'M2',employee_code:'1002',employee_name:'同名'},{name:'DEMO',employee_code:'9999',employee_name:'本人'}]});
  assert(!managerInput.disabled,'读取完成后上级输入未启用');
  managerInput.value='同名';managerInput.dispatchEvent(new Event('input',{bubbles:true}));
  assert(frm.doc.transfer_details[0].new==='','同名误匹配');
  managerInput.value='1002';managerInput.dispatchEvent(new Event('input',{bubbles:true}));managerInput.dispatchEvent(new Event('change',{bubbles:true}));
  assert(frm.doc.transfer_details[0].new==='M2'&&managerInput.value==='1002 · 同名','工号未精确匹配');
  managerInput.value='不存在';managerInput.dispatchEvent(new Event('input',{bubbles:true}));
  assert(frm.doc.transfer_details[0].new==='','无效输入保留了旧上级值');
  assert(![...document.querySelectorAll('datalist option')].some(o=>o.value.includes('本人')),'上级候选含本人');
  frm.doc.transfer_details=[{name:'d',doctype:'Employee Property History',fieldname:'department',property:'部门',current:'生产一部',new:''},{name:'p',doctype:'Employee Property History',fieldname:'designation',property:'岗位',current:'作业员',new:''}];
  render_transfer_property_editor(frm,table);
 });
 console.log('Browser interaction checks passed: preserved inputs, dependent clearing, confirmed removal, document reload, submitted/read-only state.');
 await page.screenshot({path:path.join(output, 'desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:path.join(output, 'mobile.png'),fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 if(overflow)throw Error('Mobile horizontal overflow');
 console.log('Desktop/mobile renderer previews generated; no mobile horizontal overflow.');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
