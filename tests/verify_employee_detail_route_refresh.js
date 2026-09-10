const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
	path.join(root, "hrms", "hr", "page", "employee_detail", "employee_detail.js"),
	"utf8",
);

for (const marker of [
	"get_employee_summary",
	"load_apple_tree_summary",
	"render_apple_tree_summary",
	"苹果树汇总",
	"在职信息-苹果树汇总",
	"hrms-employee-detail-collapse-row",
	"data-action=\"open-apple-tree-detail\"",
	'frappe.set_route("apple-tree-center", "person", button.dataset.applePerson, button.dataset.appleYear)',
]) {
	assert(source.includes(marker), `Employee detail must provide Apple-tree summary and precise drilldown: ${marker}`);
}
for (const marker of ["user-select: text !important", "-webkit-user-select: text !important", "has_text_selection(container)"]) {
	assert(source.includes(marker), `Employee detail must keep rendered record text copyable: ${marker}`);
}
assert.match(
	source,
	/row\.addEventListener\("click", \(\) => \{[\s\S]*?if \(this\.has_text_selection\(row\)\) return;[\s\S]*?toggle_related_block/,
	"Selecting text in a related-record row must not collapse it before it can be copied.",
);
assert(!source.includes("hrms-employee-apple-tree"), "Apple-tree summary must reuse related-record collapse styling, not a separate card.");
for (const marker of [
	'__("员工花名册 / 员工档案")',
	'__("返回员工花名册")',
	"return_to_roster()",
	'frappe.set_route("List", "Employee")',
]) {
	assert(source.includes(marker), `Employee detail must retain a visible, direct return path to the roster: ${marker}`);
}

let route = ["employee-detail", "EMP-A"];
const requests = [];
const main = { innerHTML: "" };
const breadcrumbs = {
	items: [],
	add(item) {
		this.items = [item];
	},
	append_breadcrumb_element(route, label, cssClass) {
		this.items.push({ route, label, cssClass });
	},
};
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
	breadcrumbs,
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
	const matching = requests.filter((request) => request.options.args.employee === employee && !request.resolved && !request.options.method.endsWith("get_employee_summary"));
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
	assert.strictEqual(JSON.stringify(breadcrumbs.items), JSON.stringify([
		{ type: "Custom", route: "/desk/employee", label: "员工花名册" },
		{ route: "", label: "员工档案", cssClass: "hrms-employee-detail-current" },
	]), "Employee detail must show a roster breadcrumb and a non-clickable current page.");
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
	assert.strictEqual(requests.length, 5, "Showing a fresh cached page must not repeat its detail or Apple-tree requests.");

	wrapper.employee_detail.last_loaded_at -= wrapper.employee_detail.cache_ttl + 1;
	context.frappe.pages["employee-detail"].on_page_show(wrapper);
	assert.strictEqual(requests.length, 7, "An expired cached page must refresh the current employee.");
	resolveEmployee("EMP-B", "Employee B refreshed");
	await flushPromises();
	assert.strictEqual(main.rendered_employee, "Employee B refreshed");
	assert.strictEqual(requests.length, 8, "A refreshed employee page must reload its Apple-tree summary.");

	console.log("Employee detail follows the current route and ignores stale responses.");
}

run().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
