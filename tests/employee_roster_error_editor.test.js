const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../hrms/hr/page/employee_roster_import/employee_roster_import.js"), "utf8");
function setup() {
	const state = {
		step: 4, mode: "insert", manual_mappings: { 3: "__skip__", 4: "custom_marital_status" }, row_overrides: {},
		parse_result: {
			headers: ["custom_employee_code", "custom_is_confirmed", "custom_marital_status", "ignored", "unmatched"].map((fieldname, column_index) => ({fieldname, column_index})),
			fields: ["custom_employee_code", "custom_is_confirmed", "custom_marital_status", "ignored"].map((fieldname) => ({fieldname, field_label: fieldname})),
		},
		import_result: {
			errors: [{row: 163, fieldname: "", field_label: "整行", message: "是否转正不能为3"}],
			failed_rows: [{row: 163, values: [4063, "3", "旧映射", "不导入", "离婚"]}],
		},
	};
	const context = vm.createContext({state, __: (s) => s, frappe: {
		utils: {escape_html: (s) => String(s)},
		ui: {Dialog: function (options) { context.dialog = options; this.show = () => {}; this.hide = () => {}; }},
	}, request_preview: () => { context.previewCalls = (context.previewCalls || 0) + 1; }});
	for (const name of ["render_errors", "get_error_row_fields", "open_error_row_editor", "_can_defer_field"]) {
		const start = source.indexOf(`\tfunction ${name}(`);
		const end = source.indexOf("\n\tfunction ", start + 1);
		vm.runInContext(source.slice(start, end), context);
	}
	return context;
}

test("save-time whole-row errors show an editor with original cells and effective mappings", () => {
	const app = setup();
	assert.match(app.render_errors(app.state.import_result.errors, "", true), /data-action="edit-error-row" data-row-index="163"/);
	assert.doesNotMatch(app.render_errors(app.state.import_result.errors, "", true), /请修正后重新上传/);
	app.open_error_row_editor(163, app.state.import_result);
	assert.deepEqual(Array.from(app.dialog.fields, (f) => [f.fieldname, f.default]), [
		["custom_employee_code", 4063], ["custom_is_confirmed", "3"], ["custom_marital_status", "离婚"],
	]);
	app.dialog.primary_action({custom_employee_code: "4063", custom_is_confirmed: "是", custom_marital_status: "离异"});
	assert.deepEqual(JSON.parse(JSON.stringify(app.state.row_overrides)), {163: {custom_is_confirmed: "是", custom_marital_status: "离异"}});
	assert.equal(app.previewCalls, 1);
	assert.equal(app.state.mode, "insert");
});

test("field-specific corrections retain prior overrides and allow clearing values", () => {
	const app = setup();
	app.state.row_overrides["163"] = {custom_employee_code: "4063", custom_is_confirmed: "否"};
	app.state.import_result.errors = [{row: 163, fieldname: "custom_is_confirmed", current_value: "3"}];
	app.open_error_row_editor(163, app.state.import_result);
	assert.equal(app.dialog.fields.length, 1);
	assert.equal(app.dialog.fields[0].default, "否");
	app.dialog.primary_action({});
	assert.deepEqual(JSON.parse(JSON.stringify(app.state.row_overrides["163"])), {custom_employee_code: "4063", custom_is_confirmed: ""});
});

test("preview errors stay editable; unlocatable errors never show a dead button", () => {
	const app = setup();
	app.state.step = 3;
	app.state.preview_result = {errors: [{row: 168, fieldname: "relieving_date", current_value: ""}]};
	assert.match(app.render_errors(app.state.preview_result.errors, "", true), /data-row-index="168"/);
	app.open_error_row_editor(168);
	assert.equal(app.dialog.fields[0].fieldname, "relieving_date");
	app.state.preview_result = {errors: [{row: "", fieldname: "", message: "覆盖失败"}]};
	assert.doesNotMatch(app.render_errors(app.state.preview_result.errors, "", true), /data-action="edit-error-row"/);
	app.state.preview_result = {errors: [{row: 163, fieldname: ""}], failed_rows: []};
	assert.doesNotMatch(app.render_errors(app.state.preview_result.errors, "", true), /data-action="edit-error-row"/);
});
