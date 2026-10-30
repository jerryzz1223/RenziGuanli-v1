const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
	path.join(root, "hrms/hr/page/employee_roster_export/employee_roster_export.js"),
	"utf8",
);

function tick() {
	return new Promise((resolve) => setImmediate(resolve));
}

test("employee roster export accepts legacy Deferred values for schema and history reads", async () => {
	const calls = [];
	const page = {
		body: [{}],
		set_primary_action() {},
		set_secondary_action() {},
	};
	const context = {
		window: {},
		sessionStorage: { getItem: () => null, removeItem() {} },
		$: () => ({ addClass() {}, html() {}, on() {} }),
		__: (value) => value,
		frappe: {
			pages: { "employee-roster-export": {} },
			ui: { make_app_page: () => page },
			defaults: { get_user_default: () => "" },
			utils: { escape_html: String },
			set_route() {},
			call(request) {
				calls.push(request);
				const method = typeof request === "string" ? request : request.method;
				const message = method.endsWith("get_employee_import_export_schema")
					? { categories: [], fields: [], multi_record_categories: [] }
					: [{ filename: "history.xlsx" }];
				// Deployed legacy Frappe can return a jQuery thenable without .catch/.finally.
				return { then(resolve) { resolve({ message }); } };
			},
		},
	};

	vm.createContext(context);
	vm.runInContext(source, context);
	context.frappe.pages["employee-roster-export"].on_page_load({});
	await tick();
	await tick();

	assert.equal(calls.length, 2);
	assert.equal(calls[0], "hrms.api.employee_field_template.get_employee_import_export_schema");
	assert.equal(calls[1].method, "hrms.api.employee_field_template.get_employee_export_records");
});
