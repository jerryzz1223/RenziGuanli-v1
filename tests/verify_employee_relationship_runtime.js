const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "hrms/hr/page/employee_relationship/employee_relationship.js"), "utf8");

const thenOnly = (message) => ({
	then(resolve) {
		resolve({ message });
	},
});

test("employee relationship reads accept Frappe Deferred responses", async () => {
	const statisticHost = { innerHTML: "" };
	const listHost = { innerHTML: "" };
	const search = { value: "王" };
	const calls = [];
	const context = {
		frappe: {
			pages: { "employee-relationship": {} },
			get_route: () => [],
			call: (options) => {
				calls.push(options);
				return thenOnly(options.method.endsWith("get_employee_relationship_statistics") ? { total: 3 } : { items: [{ name: "REL-001" }], count: 1 });
			},
			utils: { escape_html: String },
		},
		__: (value) => value,
	};
	vm.createContext(context);
	vm.runInContext(source, context, { filename: "employee_relationship.js" });
	const PageClass = vm.runInContext("EmployeeRelationshipPage", context);
	const view = Object.create(PageClass.prototype);
	view.wrapper = {
		querySelector(selector) {
			return {
				"[data-relationship-statistics]": statisticHost,
				"[data-relationship-search]": search,
				"[data-relationship-list]": listHost,
			}[selector] || null;
		},
	};
	view.statistics_request_id = 0;
	view.list_request_id = 0;
	view.employee_filter = "EMP-001";
	view.relationship_filters = { relationship: "同学" };
	view.relationship_sort_field = "submitted_on";
	view.relationship_sort_order = "desc";
	let statistics;
	let relationships;
	view.render_relationship_statistics = (data) => { statistics = data; };
	view.render_relationship_list = (data) => { relationships = data; };

	assert.doesNotThrow(() => {
		view.load_relationship_statistics();
		view.load_relationships();
	});
	await Promise.resolve();
	await Promise.resolve();

	assert.deepEqual(statistics, { total: 3 });
	assert.deepEqual(relationships, { items: [{ name: "REL-001" }], count: 1 });
	assert.equal(calls.length, 2);
	assert.equal(calls[1].args.search, "王");
	assert.equal(calls[1].args.employee, "EMP-001");
	assert.equal(calls[1].args.filters, JSON.stringify({ relationship: "同学" }));
	assert.equal(calls[1].args.sort_field, "submitted_on");
	assert.equal(calls[1].args.sort_order, "desc");
	assert.equal(calls[1].args.limit, 100);
});
