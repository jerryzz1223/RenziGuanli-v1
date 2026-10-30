const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function createWrapper() {
	return {
		innerHTML: "",
		classList: { add() {}, remove() {} },
		setAttribute() {},
		removeAttribute() {},
	};
}

test("apple tree center coalesces legacy Deferred loads and releases its loading guard", async () => {
	let callCount = 0;
	let resolveRequest;
	const deferred = {
		// Legacy Frappe can return a jQuery thenable without Promise.prototype.finally().
		then(resolve) {
			resolveRequest = resolve;
		},
	};
	const context = {
		URLSearchParams,
		window: { location: { search: "" } },
		frappe: {
			pages: { "apple-tree-center": {} },
			ui: { make_app_page() {} },
			get_route: () => [],
			call() {
				callCount += 1;
				return deferred;
			},
			defaults: { get_user_default: () => "" },
			utils: { escape_html: String },
		},
		__: (value) => value,
	};
	vm.createContext(context);
	vm.runInContext(
		`${fs.readFileSync(path.join(root, "hrms/hr/page/apple_tree_center/apple_tree_center.js"), "utf8")}\nglobalThis.AppleTreeCenter = AppleTreeCenter;`,
		context,
	);

	const center = new context.AppleTreeCenter({ main: [createWrapper()] });
	center.render = () => {};
	const firstLoad = center.load();
	const secondLoad = center.load();
	assert.strictEqual(firstLoad, secondLoad, "concurrent loads must share the in-flight request");

	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(callCount, 1, "a shared in-flight load must issue one RPC");
	resolveRequest({ message: { filters: { year: center.year, company: "" } } });
	await firstLoad;

	assert.equal(center.loadPromise, null, "a completed Deferred load must release the loading guard");
	const refresh = center.load(true);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(callCount, 2, "a forced refresh after completion must issue a new RPC");
	resolveRequest({ message: { filters: { year: center.year, company: "" } } });
	await refresh;
});

test("apple tree center personal detail supports then-only Deferred outcomes", async () => {
	let resolveRequest;
	let rejectRequest;
	const deferred = {
		then(resolve, reject) {
			resolveRequest = resolve;
			rejectRequest = reject;
		},
	};
	const context = {
		URLSearchParams,
		window: { location: { search: "" } },
		frappe: {
			pages: { "apple-tree-center": {} },
			ui: { make_app_page() {} },
			get_route: () => [],
			call() { return deferred; },
			defaults: { get_user_default: () => "" },
			utils: { escape_html: String },
		},
		__: (value) => value,
	};
	vm.createContext(context);
	vm.runInContext(
		`${fs.readFileSync(path.join(root, "hrms/hr/page/apple_tree_center/apple_tree_center.js"), "utf8")}\nglobalThis.AppleTreeCenter = AppleTreeCenter;`,
		context,
	);

	const center = new context.AppleTreeCenter({ main: [createWrapper()] });
	center.activePerson = "EMP-001";
	let rendered = 0;
	center.renderPerson = () => { rendered += 1; };
	const success = center.loadPerson();
	await new Promise((resolve) => setImmediate(resolve));
	resolveRequest({ message: { available: true, person: { employee: "EMP-001" } } });
	await success;
	assert.equal(center.personData.person.employee, "EMP-001");
	assert.equal(center.personRequestKey, "");
	assert.equal(rendered, 1);

	const failure = center.loadPerson();
	await new Promise((resolve) => setImmediate(resolve));
	rejectRequest(new Error("legacy request failed"));
	await failure;
	assert.equal(center.personData.available, false);
	assert.equal(center.personData.reason, "个人明细暂时无法读取，请重试。");
	assert.equal(center.personRequestKey, "");
	assert.equal(rendered, 2);
});
