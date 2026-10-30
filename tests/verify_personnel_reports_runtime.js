const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function createJQueryStub() {
	return () => ({
		addClass() { return this; },
		html() { return this; },
		on() { return this; },
		off() { return this; },
	});
}

test("personnel reports coalesces legacy Frappe Deferred loads and releases the guard", async () => {
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
		body: {},
		set_primary_action() {},
		add_action_item() {},
	};
	const context = {
		$: createJQueryStub(),
		document: {},
		frappe: {
			pages: { "personnel-reports": {} },
			ui: { make_app_page: () => page },
			call() {
				callCount += 1;
				return deferred;
			},
			utils: {
				debounce: (handler) => handler,
				escape_html: String,
				icon: () => "",
			},
		},
		__: (value) => value,
		window: { open() {} },
	};
	vm.createContext(context);
	vm.runInContext(
		fs.readFileSync(path.join(root, "hrms/hr/page/personnel_reports/personnel_reports.js"), "utf8"),
		context,
	);

	context.frappe.pages["personnel-reports"].on_page_load(wrapper);
	const firstLoad = wrapper.personnel_reports.refresh();
	const secondLoad = wrapper.personnel_reports.refresh();
	assert.strictEqual(firstLoad, secondLoad, "concurrent refreshes must share one in-flight request");
	assert.equal(callCount, 1, "a shared in-flight request must issue one RPC");

	await new Promise((resolve) => setImmediate(resolve));
	resolveRequest({ message: { groups: [] } });
	await firstLoad;

	wrapper.personnel_reports.refresh();
	assert.equal(callCount, 2, "a completed Deferred request must release the refresh guard");
});
