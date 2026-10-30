const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function createJQueryStub() {
	return () => ({
		html() { return this; },
	});
}

test("company management coalesces legacy Frappe Deferred loads and releases its refresh guard", async () => {
	let callCount = 0;
	let resolveRequest;
	const deferred = {
		// Legacy Frappe can return a jQuery thenable without Promise.prototype.finally().
		then(resolve) {
			resolveRequest = resolve;
		},
	};
	const wrapper = {};
	const page = {
		body: [{ querySelectorAll: () => [] }],
		set_primary_action() {},
	};
	const context = {
		$: createJQueryStub(),
		window: {},
		frappe: {
			pages: { "company-management": {} },
			ui: { make_app_page: () => page },
			call() {
				callCount += 1;
				return deferred;
			},
			utils: { escape_html: String },
		},
		__: (value) => value,
	};
	vm.createContext(context);
	vm.runInContext(
		fs.readFileSync(path.join(root, "hrms/hr/page/company_management/company_management.js"), "utf8"),
		context,
	);

	context.frappe.pages["company-management"].on_page_load(wrapper);
	const firstLoad = wrapper.company_management.refresh();
	const secondLoad = wrapper.company_management.refresh();
	assert.strictEqual(firstLoad, secondLoad, "concurrent refreshes must share one in-flight request");
	assert.equal(callCount, 1, "a shared in-flight request must issue one RPC");

	await new Promise((resolve) => setImmediate(resolve));
	resolveRequest({ message: { companies: [] } });
	await firstLoad;

	const refresh = wrapper.company_management.refresh(true);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(callCount, 2, "a completed Deferred request must release the refresh guard");
	resolveRequest({ message: { companies: [] } });
	await refresh;
});
