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

console.log("Employee work-nature selection preserves the unsaved form layout.");
