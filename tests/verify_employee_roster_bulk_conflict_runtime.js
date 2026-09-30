const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
	path.join(__dirname, "../hrms/hr/page/employee_roster_import/employee_roster_import.js"),
	"utf8",
);
const start = source.indexOf("\tfunction render_conflict_summary(rows) {");
const end = source.indexOf("\n\tfunction open_conflict_editor(", start);
assert(start >= 0 && end > start, "conflict summary and bulk field handler must exist");
assert(source.includes('if (action === "resolve-matching-conflicts") resolve_matching_conflicts(this.dataset.fieldname, this.dataset.choice);'));

const state = {
	preview_result: { conflicts: [
		{ row: 7, fields: [{ fieldname: "custom_age" }, { fieldname: "department" }] },
		{ row: 29, fields: [{ fieldname: "custom_age" }, { fieldname: "department" }] },
		{ row: 36, fields: [{ fieldname: "custom_age" }] },
		{ row: 47, fields: [{ fieldname: "custom_work_nature" }] },
	] },
	field_resolutions: { "7": { department: "existing" }, "29": { custom_age: "existing" } },
	row_overrides: { "36": { custom_age: "45" } },
};
let previews = 0;
const context = {
	state,
	request_preview: () => { previews++; },
	frappe: { utils: { escape_html: (value) => String(value) } },
	__: (message, args = []) => message.replace(/\{(\d+)\}/g, (_, index) => args[Number(index)]),
};
vm.runInNewContext(source.slice(start, end), context);

const html = context.render_conflict_summary(state.preview_result.conflicts.map((row) => ({
	...row, employee_code: String(row.row), fields: row.fields.map((field) => ({
		...field, choice: "", field_label: field.fieldname,
	})),
})));
assert.match(html, /custom_age：2 条差异/);
assert.match(html, /department：2 条差异/);
assert.doesNotMatch(html, /custom_work_nature：1 条差异/);
assert.match(html, /data-choice="import"/);
assert.match(html, /data-choice="existing"/);

context.resolve_matching_conflicts("custom_age", "import");
assert.equal(previews, 1);
assert.equal(state.field_resolutions["7"].custom_age, "import");
assert.equal(state.field_resolutions["7"].department, "existing");
assert.equal(state.field_resolutions["29"].custom_age, "import");
assert.equal(state.field_resolutions["36"], undefined, "manual age correction remains untouched");
assert.equal(state.field_resolutions["47"], undefined, "other fields remain untouched");

context.resolve_matching_conflicts("custom_age", "existing");
assert.equal(previews, 2);
assert.equal(state.field_resolutions["7"].custom_age, "existing");
assert.equal(state.field_resolutions["29"].custom_age, "existing");
context.resolve_matching_conflicts("custom_age", "custom");
assert.equal(previews, 2, "unsupported choices must not trigger a preview");

context.resolve_matching_conflicts("department", "import");
assert.equal(previews, 3);
assert.equal(state.field_resolutions["7"].department, "import");
assert.equal(state.field_resolutions["7"].custom_age, "existing");
assert.equal(state.field_resolutions["29"].department, "import");

console.log("Bulk field choices affect only matching conflicts and preserve manual corrections.");
