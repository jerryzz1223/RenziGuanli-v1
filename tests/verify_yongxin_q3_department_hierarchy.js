const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const hierarchyPath = path.join(root, "hrms", "hr", "page", "organizational_chart", "yongxin_q3_department_hierarchy.json");
const apiPath = path.join(root, "hrms", "hr", "page", "organizational_chart", "organizational_chart.py");
const setupPath = path.join(root, "hrms", "setup.py");
const pagePath = path.join(root, "hrms", "hr", "page", "organizational_chart", "organizational_chart.js");

function check(condition, message) {
	if (!condition) throw new Error(message);
}

const hierarchy = JSON.parse(fs.readFileSync(hierarchyPath, "utf8"));
const api = fs.readFileSync(apiPath, "utf8");
const setup = fs.readFileSync(setupPath, "utf8");
const page = fs.readFileSync(pagePath, "utf8");
const nodes = hierarchy.nodes || [];
const sourceCells = new Set(nodes.map((node) => node.source_cell));

check(hierarchy.version === "2026Q3", "Q3 hierarchy must declare its source version.");
check(nodes.length === 57, "Q3 workbook hierarchy must preserve all 57 folder and leaf nodes.");
check(nodes.filter((node) => node.roster_assignable === 1).length === 37, "Only the 37 source team leaves may receive roster employees.");
check(nodes.filter((node) => node.is_group === 1).length === 20, "Management, division, and course cards must remain folders.");
check(nodes.every((node) => !node.parent_source_cell || sourceCells.has(node.parent_source_cell)), "Every Q3 node must have a valid parent source identity.");
check(new Set(nodes.map((node) => node.source_cell)).size === nodes.length, "Source cells must keep duplicate display labels distinct.");

const nodeBySource = new Map(nodes.map((node) => [node.source_cell, node]));
check(nodeBySource.get("ES18").parent_source_cell === "EN10", "量试组 must be a peer of 生管课 under 逯瑜分管.");
check(nodeBySource.get("CS18").parent_source_cell === "CI13", "业务组 must live under 总办室.");
check(!nodes.some((node) => node.source_label === "设备组"), "设备组 is not present in the approved Q3 source tree.");
check(nodeBySource.get("C18").name !== nodeBySource.get("H18").name, "Repeated 生产组 labels need stable distinct system names.");
check(nodeBySource.get("AN18").name !== nodeBySource.get("AS18").name, "Repeated IPQC labels need stable distinct system names.");

for (const marker of [
	"def preview_yongxin_q3_department_hierarchy(",
	"def import_yongxin_q3_department_hierarchy(",
	"YONGXIN_Q3_DEPARTMENT_HIERARCHY",
	"YONGXIN_Q3_HIERARCHY_CONFIRMATION",
	"legacy_employee_assignments",
	"hrms_roster_assignable",
	"source_to_existing_name",
	"confirmation != preview[\"confirmation_text\"]",
	"frappe.db.savepoint(savepoint)",
]) {
	check(api.includes(marker), `Q3 folder import is missing: ${marker}`);
}

check(api.includes("legacy_employee_assignments"), "Q3 preview must report employees still assigned to folders.");
const q3Import = api.slice(api.indexOf("def import_yongxin_q3_department_hierarchy("), api.indexOf("def import_yongxin_q2_org_structure("));
check(!q3Import.includes('frappe.get_doc("Employee"'), "Q3 hierarchy sync must not automatically change employee assignments.");

check(setup.includes('"fieldname": "hrms_roster_assignable"'), "Department must store the roster leaf flag.");
check(page.includes("import_yongxin_q3_department_hierarchy"), "Organization page must expose Q3 folder synchronization.");
check(page.includes("同步2026Q3架构"), "Q3 synchronization must be a visible department-management action.");

console.log("Q3 department hierarchy, roster leaf boundary, and import safeguards are wired.");
