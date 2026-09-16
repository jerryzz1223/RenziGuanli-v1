const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const js = read("hrms", "hr", "page", "organizational_chart", "organizational_chart.js");
const css = read("hrms", "hr", "page", "organizational_chart", "organizational_chart.css");
const py = read("hrms", "hr", "page", "organizational_chart", "organizational_chart.py");
const template = read("hrms", "api", "organization_template.py");
const portable = read("hrms", "api", "organization_package.py");

function includes(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}

for (const marker of [
	"show_organization_position_picker",
	"assign-organization-position",
	"已有合适岗位时直接选择",
	"进入部门",
	"确认分配到此位置",
	"没有合适岗位？",
	"建立岗位并分配",
	"data-picker-role",
	"parent_node_name",
	"role_title",
	"已建立岗位 {0} 并完成分配",
	"员工基本资料未修改",
	"待分配组织位置",
]) includes(js, marker, "Pending staff must use the hierarchical organization-position picker.");

for (const marker of [
	".hrms-org-position-picker",
	".hrms-org-position-path",
	".hrms-org-position-option",
	".hrms-org-position-confirm",
	".hrms-org-position-create",
]) includes(css, marker, "Organization-position picker styles are incomplete.");

for (const source of [py, template, portable]) {
	includes(source, "organization_placements", "Organization-only placements must use an isolated config field.");
}

const api = py.slice(
	py.indexOf("def assign_employee_organization_position"),
	py.indexOf("def delete_manual_organization_node"),
);
for (const forbidden of [
	'frappe.db.set_value("Employee"',
	"employee_doc.save(",
	"employee_doc.db_set(",
]) {
	if (api.includes(forbidden)) throw new Error(`Organization placement must not mutate Employee: ${forbidden}`);
}
includes(api, '"employee_master_updated": False', "The API response must make the no-master-write contract explicit.");
includes(api, 'if not parent or _manual_node_kind(parent) not in ROSTER_UNIT_KINDS', "Inline position creation must stay under a roster unit.");
includes(api, 'roster_subset=1', "A manually named local role must be created as a scoped chart position.");
includes(api, '"position_created": position_created', "The caller must know whether a new chart position was created.");
includes(py, "e.name not in placed_employee_ids", "Placed employees must leave the pending queue without changing roster department.");
if (py.includes('children.append({"node_id": f"unassigned:')) {
	throw new Error("Pending employees are a company-level work queue, not a child organization node.");
}
includes(py, '"unassigned_employees": [_employee_row(employee) for employee in missing]', "Pending employees must remain available as a separate company-level list.");

console.log("PASS: pending staff use a drill-down position picker backed by organization-only config");
