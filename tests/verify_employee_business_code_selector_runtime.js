const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
	path.join(__dirname, "..", "hrms", "hr", "employee_business_code_selector.js"),
	"utf8",
);

function selectorWith(getValue) {
	const context = {
		window: {},
		__: (value) => value,
		frappe: { db: { get_value: getValue } },
	};
	vm.createContext(context);
	vm.runInContext(source, context);
	return context.window.hrmsEmployeeBusinessCodeSelector;
}

function form() {
	return {
		doc: { employee: "HR-0001", employee_code_display: "" },
		set_df_property() {},
		set_value(field, value) { this.doc[field] = value; },
		toggle_display() {},
	};
}

test("employee business-code selector accepts Frappe Deferred lookups", async () => {
	const selector = selectorWith(() => ({
		// The installed legacy Frappe client returns a jQuery Deferred-like
		// thenable without Promise.prototype.finally().
		then(resolve) {
			resolve({ message: { custom_employee_code: "E-001", employee_name: "张三" } });
		},
	}));
	const frm = form();

	selector.refresh(frm);
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(frm.doc.employee_code_display, "E-001");
	assert.equal(frm.__hrms_selected_employee_code, "E-001");
	assert.equal(frm.__hrms_loading_employee_code, false, "Deferred completion must release the loading guard");
});

test("employee business-code selector releases its loading guard after a lookup error", async () => {
	const selector = selectorWith(() => Promise.reject(new Error("offline")));
	const frm = form();

	selector.refresh(frm);
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(frm.__hrms_loading_employee_code, false, "failed lookups must not block a retry");
});
