const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('hrms/hr/page/organizational_chart/organizational_chart.js', 'utf8');
const routes = [];
const context = { __: text => text, frappe: {
  pages: {'organizational-chart': {}}, set_route: (...route) => routes.push(route),
  utils: {escape_html: value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')},
}};
vm.createContext(context);
vm.runInContext(source + '\nthis.Chart = HybridOrganizationChart;', context);
const chart = Object.create(context.Chart.prototype);
const leaf = {node_id:'organization_node:U', node_type:'organization_section', name:'连续课', title:'课', lines:[], children:[], current_headcount:8, has_staffing_plan:false};
const scope = {node_id:'organization_node:S',node_type:'organization_supervisor',name:'分管一',title:'分管',lines:['负责人：甲','代理人：乙'],children:[leaf]};
chart.tree = {source_mode:'manual',root:{node_id:'company:X',node_type:'company',name:'永新公司',children:[scope]},unplaced_departments:[]};
chart.mode = 'list'; chart.source_mode = 'manual'; chart.search_term = ''; chart.collapsed_nodes = new Set();
const host = {innerHTML:''};
chart.wrapper = {querySelector: selector => selector === '[data-level-list]' ? host : selector === '[data-search]' ? {value:''} : {classList:{toggle(){}}}};
chart.list_node_id = scope.node_id;
chart.render_level_list();
assert(host.innerHTML.includes('负责人：甲') && host.innerHTML.includes('代理人：乙'));
assert(host.innerHTML.includes('连续课') && host.innerHTML.includes('未设置'));
assert.equal(chart.node_path(leaf.node_id).map(n=>n.name).join('/'),'永新公司/分管一/连续课');
chart.selected_node = {node_id:scope.node_id};
chart.handle_action('view-chart');
assert.equal(routes.pop()[0],'organizational-chart');
chart.handle_action('view-list');
assert.equal(routes.pop()[1],'list');
assert.equal(chart.list_node_id, scope.node_id);
chart.select_node = (id,type) => chart.selected_node = {node_id:id,node_type:type};
chart.browse_node(leaf.node_id);
assert.equal(chart.selected_node.node_id, leaf.node_id);
assert(host.innerHTML.includes('暂无下级机构'));
chart.list_node_id = 'deleted-node'; chart.render_level_list();
assert.equal(chart.list_node_id,'company:X');
chart.search_term='连续'; chart.render_level_list();
assert(host.innerHTML.includes('全组织搜索结果') && host.innerHTML.includes('永新公司 / 分管一'));
leaf.name='<script>test</script>'; chart.search_term=''; chart.list_node_id=scope.node_id; chart.render_level_list();
assert(host.innerHTML.includes('&lt;script>') && !host.innerHTML.includes('<script>'));
assert.equal(chart.staffing_value({...leaf,has_staffing_plan:true,planned_headcount:0},'planned_headcount'),0);
console.log('PASS: shared navigation, role/proxy display, breadcrumbs, search paths, missing-node recovery, escaping, unknown vs explicit zero staffing');

// Department and position members are visible without opening the side panel.
const peopleHost = {innerHTML:''};
chart.wrapper = {querySelector: selector => selector === '[data-inline-people]' ? peopleHost : null};
chart.list_node_id = leaf.node_id;
chart.resolve_employee_code_value = person => person.employee_code;
chart.resolve_employee_route_value = person => person.name;
const detail = {node_id:leaf.node_id,employee_match_mode:'department',employees:[
  {name:'E1',employee_code:'001',employee_name:'甲',designation:'课长'},
  {name:'E2',employee_code:'002',employee_name:'乙',designation:'课长（代）'},
  {name:'E3',employee_code:'003',employee_name:'<丙>',designation:'作业员'},
]};
chart.render_inline_people(detail);
assert.equal((peopleHost.innerHTML.match(/data-roster-employee=/g)||[]).length,3);
assert(peopleHost.innerHTML.includes('课长（代）') && peopleHost.innerHTML.includes('&lt;丙>'));
chart.render_inline_people(detail,'002');
assert.equal((peopleHost.innerHTML.match(/data-roster-employee=/g)||[]).length,1);
assert(peopleHost.innerHTML.includes('乙') && !peopleHost.innerHTML.includes('甲'));
const previous = peopleHost.innerHTML;
chart.render_inline_people({...detail,node_id:'old-node'});
assert.equal(peopleHost.innerHTML,previous);
chart.list_node_id = chart.tree.root.node_id;
chart.tree.root.unassigned_employees = [detail.employees[2]];
chart.render_inline_people({node_id:chart.tree.root.node_id,employees:detail.employees});
assert(peopleHost.innerHTML.includes('待补齐后分配'));
assert.equal((peopleHost.innerHTML.match(/data-roster-employee=/g)||[]).length,1);
console.log('PASS: inline roster membership, employee ID search, acting title, escaping, stale-node rejection and missing-department isolation');
