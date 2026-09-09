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
    constructor(config) { Object.assign(this, config); this.values = Object.fromEntries(config.fields.map(field => [field.fieldname,field.default])); this.fields_dict = Object.fromEntries(config.fields.map(field=>[field.fieldname,{...field,$wrapper:wrapper, make_input: () => { this.values[field.fieldname] = []; }, set_value: value => { this.values[field.fieldname] = value; }, refresh() {}}])); dialog=this; }
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
setImmediate(async ()=>{
 assert.equal(dialog.fields_dict.parent_node_label.fieldtype,'Autocomplete');
	assert.equal(dialog.fields_dict.department.mandatory_depends_on,"eval:doc.node_kind!='管理层'&&doc.node_kind!='分管'&&doc.node_kind!='员工'");
 assert(!dialog.fields_dict.manager_employee.mandatory_depends_on);
 assert.equal(dialog.get_value('parent_node'),'A');
 assert.equal(dialog.fields_dict.assigned_employees.depends_on,"eval:doc.node_kind=='岗位'||doc.roster_subset");
 dialog.set_value('node_kind','岗位');
 dialog.fields_dict.node_kind.onchange();
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(dialog.get_value('department'),'品保课','new position should start with the parent department');
 dialog.set_value('role_title','课长');
	const departmentFilters=dialog.fields_dict.department.get_query().filters;
	assert.equal(departmentFilters.company,'永新');
	assert.equal(dialog.fields_dict.designation.mandatory_depends_on,"eval:doc.node_kind=='岗位'&&!doc.roster_subset");
 const candidates=dialog.fields_dict.primary_employee.get_query().filters.name[1];
 assert(candidates.includes('E1'),'main 技术总监 must remain selectable for local 课长');
 assert.equal(dialog.get_value('assignment_mode'),'自动');
	assert.equal(requests[0].args.department,'');
	assert.equal(requests[0].args.inherit_parent,false);
	chart.show_manual_node_dialog({name:'A',source_text:JSON.stringify({manual_organization:true,node_kind:'课',department:'品保课',assigned_employees:['E1']})});
	assert.equal(dialog.get_value('assigned_employees').length,0,'legacy unit selections must not be reintroduced');
	chart.show_manual_node_dialog({name:'P',source_text:JSON.stringify({manual_organization:true,node_kind:'岗位',department:'品保课',designation:'技术总监',roster_auto_sync:true,assigned_employees:['E1']})});
	assert.equal(dialog.get_value('assigned_employees').join(','),'E1','initially read-only multiselect must retain members when made editable');
	assert.equal(dialog.get_value('roster_auto_sync'),true);
	chart.show_manual_node_dialog({name:'G',source_text:JSON.stringify({manual_organization:true,node_kind:'组',department:'品保课',roster_subset:true,assigned_employees:['E1']})});
	assert.equal(dialog.get_value('assigned_employees').join(','),'E1','department subgroups must retain their own members');
	assert(!dialog.fields_dict.department.get_query().filters.department_name,'a subgroup links its containing department, not a fake department with the group name');
	console.log('PASS: manual parents, cycle exclusions, business links, acting candidates, direct downstream selection and automatic unit membership');
});
