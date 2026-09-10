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
	window: {},
	frappe: { ui: { form: { on() {} } } },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
	`${source}\nglobalThis.applyEmployeeRehireAutofill = apply_employee_rehire_autofill;`,
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
	console.log("Employee rehire autofill only fills supported blank fields.");
}

run().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
