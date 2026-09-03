const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const doctypeRoot = path.join(root, "hrms/hr/doctype");

function read(relativePath) {
	return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function json(relativePath) {
	return JSON.parse(read(relativePath));
}

function fieldNames(doc) {
	return new Set((doc.fields || []).map((field) => field.fieldname));
}

for (const name of [
	"organization_structure_version",
	"organization_node",
	"organization_position",
	"grade_tag",
	"employee_position_assignment",
]) {
	assert.ok(fs.existsSync(path.join(doctypeRoot, name, `${name}.json`)), `${name} DocType must exist`);
}

const position = json("hrms/hr/doctype/organization_position/organization_position.json");
assert.ok(fieldNames(position).has("suggested_grade_tags"), "positions must support optional grade-tag suggestions");
assert.ok(fieldNames(position).has("designation"), "positions must map optionally to legacy Designation");

const assignment = json("hrms/hr/doctype/employee_position_assignment/employee_position_assignment.json");
const assignmentFields = fieldNames(assignment);
for (const fieldname of ["organization_position", "relationship_type", "is_primary", "effective_from", "effective_to", "grade_tags"]) {
	assert.ok(assignmentFields.has(fieldname), `assignment must include ${fieldname}`);
}

const assignmentCode = read("hrms/hr/doctype/employee_position_assignment/employee_position_assignment.py");
for (const marker of [
	"ACTIVE_STATUS = \"有效\"",
	"PRIMARY_TYPE = \"主职\"",
	"def _validate_no_overlapping_primary",
	"def switch_primary_assignment",
	"def get_effective_primary_assignment",
	"def sync_employee_primary_assignment",
]) {
	assert.ok(assignmentCode.includes(marker), `assignment behavior must include ${marker}`);
}

const chartApi = read("hrms/hr/page/organizational_chart/organizational_chart.py");
assert.ok(chartApi.includes("def preview_multiple_position_organization_import"));
assert.ok(chartApi.includes("def create_multiple_position_organization_draft"));
assert.ok(chartApi.includes("def get_multiple_position_draft_status"));
assert.ok(chartApi.includes("MANUAL_ORGANIZATION_MODE_MESSAGE"));
assert.ok(chartApi.includes("GRADE_TAG_CANDIDATES"));

const chartUi = read("hrms/hr/page/organizational_chart/organizational_chart.js");
assert.ok(chartUi.includes("手动维护组织节点"));
assert.ok(chartUi.includes("维护图谱版本"));
assert.ok(chartUi.includes("独立展示模式"));
assert.ok(chartApi.includes("no HR master data is part of this view"));

console.log("Multiple-position schema and standalone organization chart boundary are wired.");
