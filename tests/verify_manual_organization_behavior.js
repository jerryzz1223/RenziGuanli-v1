const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('hrms/hr/page/organizational_chart/organizational_chart.js', 'utf8');
let dialog;
const requests = [];
const wrapper = {html() { return this; }, find() { return this; }, on() { return this; }};
const context = { __: text => text, frappe: {
  pages: {'organizational-chart': {}},
  utils: { escape_html: text => text },
  call: async args => { requests.push(args); return {message: {roster_department: '品保课', rows: [{employee:'E1',designation:'技术总监'}], employees:[{name:'E1',designation:'技术总监'}]}}; },
  ui: {Dialog: class {
    constructor(config) { Object.assign(this, config); this.values = Object.fromEntries(config.fields.map(field => [field.fieldname,field.default])); this.fields_dict = Object.fromEntries(config.fields.map(field=>[field.fieldname,{...field,$wrapper:wrapper}])); dialog=this; }
    get_value(key) {return this.values[key];}
    set_value(key,value) {this.values[key]=value;}
    show() {}
  }},
}};
vm.createContext(context);
vm.runInContext(source+'\nthis.Chart = HybridOrganizationChart;', context);
const chart = Object.create(context.Chart.prototype);
chart.company = '永新';
chart.tree = {root:{node_id:'company:永新',node_type:'company',children:[
 {node_id:'organization_node:A',name:'同名课',organization_node_type:'课',department:'品保课',children:[{node_id:'organization_node:B',name:'下级组',organization_node_type:'组',children:[]}]},
 {node_id:'organization_node:C',name:'同名课',organization_node_type:'课',children:[]},
]}};
assert(chart.manual_child_kinds('organization_node:A').includes('课'));
assert(chart.manual_child_kinds('company:永新').includes('岗位'));
const parents=chart.manual_parent_options('课','A');
assert(!parents.some(option=>['A','B'].includes(option.value)));
assert(parents.some(option=>option.value==='C'));
assert.equal(new Set(chart.manual_parent_options('课').map(option=>option.label)).size,4);
chart.show_manual_node_dialog(null,'organization_node:A');
setImmediate(()=>{
 assert.equal(dialog.fields_dict.parent_node_label.fieldtype,'Autocomplete');
 assert(!dialog.fields_dict.department.mandatory_depends_on);
 assert(!dialog.fields_dict.manager_employee.mandatory_depends_on);
 assert.equal(dialog.get_value('parent_node'),'A');
 dialog.set_value('node_kind','岗位');
 dialog.set_value('role_title','课长');
 const candidates=dialog.fields_dict.primary_employee.get_query().filters.name[1];
 assert(candidates.includes('E1'),'main 技术总监 must remain selectable for local 课长');
 assert.equal(dialog.get_value('assignment_mode'),'自动');
 assert.equal(requests[0].args.department,'品保课');
 console.log('PASS: manual parents, cycle exclusions, duplicate labels, empty framework dialog, acting candidates');
});
