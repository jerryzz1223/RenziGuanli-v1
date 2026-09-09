const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = {__: x=>x, frappe:{pages:{'organizational-chart':{}}}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('hrms/hr/page/organizational_chart/organizational_chart.js','utf8')+'\nthis.Chart=HybridOrganizationChart;',context);
const chart = Object.create(context.Chart.prototype);
const person = (name,role)=>({employee_name:name,role});
const leaf = {node_id:'staff',name:'人员',people:Array.from({length:82},(_,i)=>person(`员工${i}`,i===0?'组长（任职待确认）':'员工')),children:[],has_staffing_plan:false,current_headcount:82};
const group = {node_id:'group',name:'试验组',people:[person('王传瑞','组长（任职待确认）')],children:[leaf]};
const other = {node_id:'other',name:'客服组',people:[person('王传瑞','组长（任职待确认）')],children:[]};
chart.tree={root:{node_id:'root',name:'公司<&"测试',children:[group,other]}};
chart.search_term='';chart.collapsed_nodes=new Set(['group']);
const before=JSON.stringify(chart.tree);
let output=chart.build_visual_export(true);
assert.equal(output.nodeCount,4);
for(let i=0;i<82;i++) assert(output.svg.includes(`员工${i}</text>`),`missing employee ${i}`);
assert.equal((output.svg.match(/组长（任职待确认）：王传瑞/g)||[]).length,2,'multiple appointments retained');
assert(output.svg.includes('公司&lt;&amp;&quot;测试'));
assert(!output.svg.includes('<foreignObject')&&!output.svg.includes('<script')&&!output.svg.includes('data-action'));
// All variable-height cards and their text must remain inside the document.
for(const match of output.svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)){
 const [,x,y,w,h]=match.map(Number);
 assert(x>=0&&y>=0&&x+w<=output.width&&y+h<=output.height);
}
assert.equal(chart.build_visual_export(false).nodeCount,3,'collapsed branch omitted only in current scope');
chart.tree_focus_id='group';
assert.equal(chart.build_visual_export(false).nodeCount,1,'current focus respected');
assert.equal(chart.build_visual_export(true).nodeCount,4,'complete ignores focus and collapse');
chart.search_term='员工81';
output=chart.build_visual_export(false);
assert.equal(output.nodeCount,3,'search retains ancestor path');
assert(output.svg.includes('员工81</text>')&&!output.svg.includes('员工80</text>'));
assert.equal(chart.build_visual_export(true).nodeCount,4,'complete ignores search');
chart.search_term='no-match';
assert.throws(()=>chart.build_visual_export(false),/没有匹配/);
assert.equal(JSON.stringify(chart.tree),before,'export must not mutate tree data');
assert.deepEqual([...chart.collapsed_nodes],['group'],'export must not change expansion state');
console.log('PASS: full/current exports, 82 people, multiple roles, focus/search, XML escaping, bounds, no data mutation');
