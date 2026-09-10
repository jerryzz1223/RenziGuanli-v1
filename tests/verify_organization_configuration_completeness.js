const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let dialog, html = '', notice;
const data = {file_url:'/private/files/test.xlsx',file_name:'test.xlsx',errors:[],warnings:['文件未配置等级'],
  completeness:{nodes:191,person_references:416,unbound_references:19,source_grade_nodes:17,grade_definitions:0,graded_nodes:0},
  create_count:191,update_count:0,retained_count:0,person_rows:416,grades:[],
  preview:[{id:'N1',name:'员工',node_kind:'岗位',parent:'P1',parent_name:'业务组',role:'业务',
    source_grade_tags:'文师级<script>',source_grade_status:'待确认',source_grade_reference:'原表"来源',grade:''}]};
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const context = {__:x=>x, document:{createElement:()=>({click(){}})}, frappe:{pages:{'organizational-chart':{}},utils:{escape_html:escape},
  call: async()=>({message:data}),msgprint:args=>{notice=args;return {$wrapper:{find(){return {on(){}};}}};},ui:{Dialog:class {
    constructor(config){Object.assign(this,config);this.fields_dict={preview:{$wrapper:{html:value=>{html=value;}}}};dialog=this;}
    get_values(){return {company:'永新',file_url:data.file_url,auto_sync:0};}
    get_primary_btn(){return {prop(){return this;},text(){return this;}};}
    show(){} hide(){}
  }}}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('hrms/hr/page/organizational_chart/organizational_chart.js','utf8')+'\nthis.Chart=HybridOrganizationChart;',context);
(async()=>{
  const chart=Object.create(context.Chart.prototype);chart.company='永新';
  await chart.export_configuration();
  assert.equal(notice.indicator,'orange');
  assert(notice.message.includes('17 个节点有记录')&&notice.message.includes('未绑定原表引用 19 条'));
  assert(!notice.message.includes('包含上下级、人员任职和职级定义'));
  chart.import_configuration();await dialog.run_configuration_action();
  assert(html.includes('原表职级标签')&&html.includes('图中职务')&&html.includes('未配置等级'));
  assert(html.includes('文师级&lt;script&gt;')&&html.includes('原表&quot;来源'));
  assert.equal(chart.source_grade_text({source_grade_tags:'直线级\n文师级',source_grade_status:'待确认'}),'原表职级：直线级、文师级（待确认）');
  console.log('PASS: export completeness counts, pending warnings, preview distinguishes roles/labels/ranks and escapes source text');
})().catch(error=>{console.error(error);process.exitCode=1;});
