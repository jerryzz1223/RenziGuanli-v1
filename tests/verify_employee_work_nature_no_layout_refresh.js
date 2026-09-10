const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "hrms", "public", "js", "erpnext", "employee.js"), "utf8");
const context = {
	Object,
	setTimeout,
	window: {},
	$: () => ({ addClass() {} }),
	__: (value) => value,
	frappe: { ui: { form: { on() {} } } },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${source}\nglobalThis.applyWorkNatureForTest = apply_employee_work_nature_choice;`, context);

const refreshedFields = [];
let dirtyCalls = 0;
let setValueCalls = 0;
const frm = {
	is_new: () => false,
	doc: {
		custom_work_nature: "退休返聘",
		employment_type: "Full-time",
		status: "Active",
		custom_is_confirmed: "是",
		relieving_date: "2026-09-03",
	},
	fields_dict: { relieving_date: {} },
	refresh_field(fieldname) {
		refreshedFields.push(fieldname);
	},
	dirty() {
		dirtyCalls += 1;
	},
	set_value() {
		setValueCalls += 1;
	},
	toggle_display() {},
	set_df_property() {},
};

context.applyWorkNatureForTest(frm, "退休返聘");

assert.strictEqual(frm.doc.employment_type, "Full-time");
assert.strictEqual(frm.doc.status, "Active");
assert.strictEqual(frm.doc.relieving_date, "2026-09-03");
assert.deepStrictEqual(refreshedFields, []);
assert.strictEqual(dirtyCalls, 0);
assert.strictEqual(setValueCalls, 0, "Changing 工作性质 must not update implementation fields before Save.");

context.applyWorkNatureForTest(frm, "离职");
assert.deepStrictEqual(refreshedFields, []);
assert.strictEqual(dirtyCalls, 0);
assert.strictEqual(setValueCalls, 0);

// New employees must not inherit departure controls from roster filters or
// depend on a successful asynchronous field-template response to hide them.
vm.runInContext(`
	globalThis.setupWorkNatureForTest = setup_employee_work_nature_field;
	globalThis.renderForTest = show_employee_form_as_one_page;
	globalThis.calculateAgeForTest = calculate_employee_age;
	globalThis.updateAgeForTest = update_employee_age;
	setup_employee_roster_layout = () => {};
`, context);
context.window.requestAnimationFrame = (callback) => callback();
const visible = {};
const properties = {};
const newFrm = {
	is_new: () => true,
	doc: { custom_work_nature: "离职", relieving_date: "2026-09-03" },
	fields_dict: { custom_work_nature: {}, relieving_date: {}, custom_probation_months: {}, final_confirmation_date: {} },
	layout: { tabs: [{
		df: { fieldname: "exit" },
		refresh() { this.hidden = Boolean(this.df.hidden); visible.exit = !this.hidden; },
		wrapper: { addClass() {} },
	}] },
	toggle_display(fieldname, value) { visible[fieldname] = value; },
	set_df_property(fieldname, property, value) { properties[`${fieldname}.${property}`] = value; },
	set_value(fieldname, value) { this.doc[fieldname] = value; },
};
context.renderForTest(newFrm);
assert.strictEqual(visible.naming_series, false);
assert.strictEqual(properties["naming_series.reqd"], false);
assert.strictEqual(visible.relieving_date, false);
assert.strictEqual(visible.exit, false);
assert.strictEqual(properties["relieving_date.reqd"], false);
context.setupWorkNatureForTest(newFrm);
assert.strictEqual(properties["custom_work_nature.options"], "在职·正式\n在职·试用期\n退休返聘");
assert.strictEqual(newFrm.doc.custom_work_nature, "在职·正式");
for (const value of ["在职·正式", "在职·试用期", "退休返聘", "待离职", "离职"]) {
	newFrm.doc.custom_work_nature = value;
	visible.relieving_date = true; // Simulate template/native visibility reset.
	visible.naming_series = true;
	properties["naming_series.reqd"] = true;
	context.renderForTest(newFrm);
	assert.strictEqual(visible.naming_series, false);
	assert.strictEqual(properties["naming_series.reqd"], false);
	assert.strictEqual(visible.relieving_date, false);
	assert.strictEqual(properties["relieving_date.reqd"], false);
	assert.strictEqual(visible.custom_probation_months, value === "在职·试用期");
	assert.strictEqual(visible.final_confirmation_date, value === "在职·试用期");
	for (const fieldname of ["custom_roster_sequence", "education", "educational_qualification", "custom_is_confirmed"]) {
		assert.strictEqual(visible[fieldname], false);
	}
}
newFrm.doc.final_confirmation_date = "2026-12-09";
for (const value of ["在职·试用期", "在职·正式", "在职·试用期"]) {
	context.applyWorkNatureForTest(newFrm, value);
	assert.strictEqual(visible.custom_probation_months, value === "在职·试用期");
	assert.strictEqual(visible.final_confirmation_date, value === "在职·试用期");
	assert.strictEqual(newFrm.doc.final_confirmation_date, "2026-12-09", "Hiding fields must preserve recorded dates.");
}
// Existing employees retain the complete departure workflow and stored date.
newFrm.is_new = () => false;
context.setupWorkNatureForTest(newFrm);
context.renderForTest(newFrm);
assert.strictEqual(properties["custom_work_nature.options"], "在职·正式\n在职·试用期\n退休返聘\n待离职\n离职");
assert.strictEqual(visible.relieving_date, true);
assert.strictEqual(visible.exit, true);
assert.strictEqual(properties["relieving_date.reqd"], true);
assert.strictEqual(newFrm.doc.relieving_date, "2026-09-03");

for (const [birth, today, expected] of [
	["1989-06-01", "2026-09-09", 37],
	["2000-09-10", "2026-09-09", 25],
	["2000-09-09", "2026-09-09", 26],
	["2000-02-29", "2026-02-28", 25],
	["2000-02-29", "2026-03-01", 26],
	["", "2026-09-09", null],
	["2027-01-01", "2026-09-09", null],
	["2000-02-30", "2026-09-09", null],
]) assert.strictEqual(context.calculateAgeForTest(birth, today), expected);
context.frappe.datetime = { get_today: () => "2026-09-09" };
newFrm.fields_dict.custom_age = {};
newFrm.doc.date_of_birth = "1989-06-01";
context.updateAgeForTest(newFrm);
assert.strictEqual(newFrm.doc.custom_age, 37);
assert.strictEqual(properties["custom_age.read_only"], 1);
newFrm.doc.date_of_birth = "";
context.updateAgeForTest(newFrm);
assert.strictEqual(newFrm.doc.custom_age, null);

console.log("Employee work-nature selection preserves the unsaved form layout.");
