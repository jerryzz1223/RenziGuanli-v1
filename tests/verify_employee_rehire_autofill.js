const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(
	path.join(__dirname, "..", "hrms", "public", "js", "erpnext", "employee.js"),
	"utf8",
);
const context = {
	Promise,
	console,
	__: (value) => value,
	window: {},
	frappe: { ui: { form: { on() {} } } },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
	`${source}\nglobalThis.applyEmployeeRehireAutofill = apply_employee_rehire_autofill;\n` +
		"globalThis.setupEmployeeRehireFields = setup_employee_rehire_fields;",
	context,
);

async function run() {
	const doc = { first_name: "已填姓名", cell_number: "", department: "新部门" };
	const fields_dict = { first_name: {}, cell_number: {}, department: {} };
	let submitted = null;
	const frm = {
		doc,
		fields_dict,
		set_value(values) {
			submitted = values;
			Object.assign(doc, values);
			return Promise.resolve();
		},
	};

	const filled = await context.applyEmployeeRehireAutofill(frm, {
		first_name: "原档姓名",
		cell_number: "13800000000",
		department: "原部门",
		designation: "原岗位",
	});
	assert.strictEqual(filled, 1);
	assert.deepStrictEqual(JSON.parse(JSON.stringify(submitted)), { cell_number: "13800000000" });
	assert.strictEqual(doc.first_name, "已填姓名", "Existing form values must not be overwritten.");
	assert.strictEqual(doc.department, "新部门", "Current-employment values must stay unchanged.");

	const properties = [];
	const visibility = [];
	const rehireForm = {
		doc: { custom_previous_employee_code: "22002", custom_employee_code: "" },
		fields_dict: { custom_previous_employee_code: {}, custom_employee_code: {} },
		set_df_property(fieldname, property, value) {
			properties.push([fieldname, property, value]);
		},
		toggle_display(fieldname, visible) {
			visibility.push([fieldname, visible]);
		},
	};
	context.setupEmployeeRehireFields(rehireForm);
	assert.deepStrictEqual(JSON.parse(JSON.stringify(visibility)), [["custom_previous_employee_code", true]]);
	assert(properties.some(([field, property, value]) =>
		field === "custom_previous_employee_code" && property === "read_only" && value === 1));
	assert(properties.some(([field, property, value]) =>
		field === "custom_employee_code" && property === "label" && value === "新工号"));
	assert(properties.some(([field, property, value]) =>
		field === "custom_employee_code" && property === "reqd" && value === 1));
	console.log("Employee rehire autofill only fills supported blank fields.");
}

run().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
