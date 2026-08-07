const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
	path.join(root, "hrms", "hr", "page", "employee_detail", "employee_detail.js"),
	"utf8",
);

let route = ["employee-detail", "EMP-A"];
const requests = [];
const main = { innerHTML: "" };
const page = {
	main: [main],
	title: "",
	set_secondary_action() {},
	set_title(title) {
		this.title = title;
	},
};

function createRequest(options) {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	requests.push({ options, resolve, reject });
	return promise;
}

const context = {
	Promise,
	console,
	document: { body: { classList: { add() {} } } },
	window: {},
	__: (value) => value,
	frappe: {
		pages: { "employee-detail": {} },
		ui: { make_app_page: () => page },
		utils: { escape_html: (value) => String(value || "") },
		get_route: () => route,
		call: createRequest,
		set_route() {},
	},
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(`${source}\nglobalThis.EmployeeDetailPageForTest = EmployeeDetailPage;`, context);

context.EmployeeDetailPageForTest.prototype.render = function () {
	this.wrapper.rendered_employee = this.detail.header.employee_name;
	this.page.set_title(this.detail.header.employee_name);
};

function resolveEmployee(employee, displayName) {
	const matching = requests.filter((request) => request.options.args.employee === employee && !request.resolved);
	assert.strictEqual(matching.length, 2, `${employee} should have one detail and one navigation request.`);
	matching.forEach((request) => {
		request.resolved = true;
		if (request.options.method.endsWith("get_employee_detail_navigation")) {
			request.resolve({ message: { previous: "", next: "" } });
		} else {
			request.resolve({ message: { header: { employee_name: displayName } } });
		}
	});
}

async function flushPromises() {
	await new Promise((resolve) => setImmediate(resolve));
}

async function run() {
	const wrapper = {};
	context.frappe.pages["employee-detail"].on_page_load(wrapper);
	context.frappe.pages["employee-detail"].on_page_show(wrapper);
	assert.strictEqual(requests.length, 2, "Initial load/show must share the in-flight request.");

	route = ["employee-detail", "EMP-B"];
	context.frappe.pages["employee-detail"].on_page_show(wrapper);
	assert.strictEqual(requests.length, 4, "Changing the route must request the new employee.");
	assert.match(main.innerHTML, /正在加载员工档案/, "Old employee details must be cleared while loading.");

	resolveEmployee("EMP-B", "Employee B");
	await flushPromises();
	assert.strictEqual(main.rendered_employee, "Employee B");
	assert.strictEqual(page.title, "Employee B");

	resolveEmployee("EMP-A", "Employee A");
	await flushPromises();
	assert.strictEqual(main.rendered_employee, "Employee B", "A stale response must not replace the current employee.");

	context.frappe.pages["employee-detail"].on_page_show(wrapper);
	assert.strictEqual(requests.length, 4, "Showing a fresh cached page must not repeat its detail requests.");

	wrapper.employee_detail.last_loaded_at -= wrapper.employee_detail.cache_ttl + 1;
	context.frappe.pages["employee-detail"].on_page_show(wrapper);
	assert.strictEqual(requests.length, 6, "An expired cached page must refresh the current employee.");
	resolveEmployee("EMP-B", "Employee B refreshed");
	await flushPromises();
	assert.strictEqual(main.rendered_employee, "Employee B refreshed");

	console.log("Employee detail follows the current route and ignores stale responses.");
}

run().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
