const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
};
const page = (selector = () => null) => ({ main: [{ innerHTML: "", querySelector: selector }], set_title() {} });
const loadClass = (file, className, call) => {
	const context = {
		frappe: { pages: { "hrms-workbench": {}, "personnel-home": {}, "training-learning-center": {}, "employee-separation-effective": {}, "employee-separation-interview": {} }, call, utils: { escape_html: String }, defaults: { get_user_default: () => "A" } },
		window: { hrmsCompanyContext: { getCurrentCompany: () => "A" } },
		__: (value) => value,
		fetch: async () => ({ ok: true, json: async () => ({ features: [] }) }),
	};
	vm.createContext(context);
	vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
	return { PageClass: vm.runInContext(className, context), context };
};

test("system home merges repeat refresh clicks and restores the button", async () => {
	const pending = deferred();
	let calls = 0;
	const button = { disabled: false, isConnected: true, setAttribute() {}, removeAttribute() {} };
	const { PageClass } = loadClass("hrms/hr/page/hrms_workbench/hrms_workbench.js", "HRMSHome", () => { calls++; return pending.promise; });
	const home = new PageClass(page((selector) => selector === "[data-home-refresh]" ? button : null));
	let renders = 0;
	home.render = () => { renders++; };
	const first = home.refresh();
	const second = home.refresh();
	assert.equal(first, second);
	assert.equal(calls, 1);
	assert.equal(button.disabled, true);
	pending.resolve({ message: { ok: true } });
	await first;
	assert.equal(button.disabled, false);
	assert.equal(renders, 1);
	await home.show();
	assert.equal(calls, 1);
});

test("personnel home keeps its DOM on a cache hit and fetches map data once", async () => {
	let calls = 0;
	const { PageClass, context } = loadClass("hrms/hr/page/personnel_home/personnel_home.js", "PersonnelHome", () => { calls++; return Promise.resolve({ message: {} }); });
	const mapHost = { innerHTML: "", querySelectorAll: () => [] };
	const home = new PageClass(page((selector) => selector === ".personnel-home__analytics" ? {} : selector === "[data-province-map]" ? mapHost : null));
	home.data = {};
	home.last_loaded_at = Date.now();
	home.render = () => { throw new Error("cached page must not be rebuilt"); };
	await home.show();
	assert.equal(calls, 0);
	let mapFetches = 0;
	context.fetch = async () => { mapFetches++; return { ok: true, json: async () => ({ features: [] }) }; };
	await home.render_province_map();
	await home.render_province_map();
	assert.equal(mapFetches, 1);
});

test("training home refreshes when the selected company changes", async () => {
	const companies = [];
	const { PageClass, context } = loadClass("hrms/hr/page/training_learning_center/training_learning_center.js", "TrainingLearningHome", ({ args }) => {
		companies.push(args.company);
		return Promise.resolve({ message: { metrics: {} } });
	});
	const home = new PageClass(page((selector) => selector === ".hrms-training-home-metrics" ? {} : null));
	home.render = () => {};
	await home.show();
	await home.show();
	context.window.hrmsCompanyContext.getCurrentCompany = () => "B";
	await home.show();
	assert.deepEqual(companies, ["A", "B"]);
});

test("statistics page merges repeat month requests and ignores an older month", async () => {
	const source = fs.readFileSync(path.join(root, "hrms/hr/page/hrms_data_statistics/hrms_data_statistics.js"), "utf8");
	const loadSource = source.slice(source.indexOf("\tfunction load(month = state.month, force = false) {"), source.indexOf("\n\tfunction loadOperators()"));
	const requests = [];
	let renders = 0;
	const state = {
		month: "2026-08", data: null, operatorData: null, loadRequestId: 0,
		loadPromise: null, loadingKey: "", loadedKey: "", loadedAt: 0, activityRequestId: 0, operatorRequestId: 0,
	};
	const context = {
		state, page: { body: {} }, window: { hrmsCompanyContext: { getCurrentCompany: () => "A" } },
		frappe: { call: (_method, args) => {
			const request = deferred();
			requests.push({ month: args.month, request });
			return request.promise;
		} },
		$: () => ({ html() {} }), __: (value) => value, render: () => { renders++; },
	};
	vm.createContext(context);
	vm.runInContext(loadSource, context);
	const august = context.load("2026-08");
	assert.equal(context.load("2026-08"), august);
	assert.equal(requests.length, 2);
	const september = context.load("2026-09");
	assert.equal(requests.length, 4);
	requests[2].request.resolve({ message: { activity_month: "2026-09" } });
	requests[3].request.resolve({ message: { people: [] } });
	await september;
	requests[0].request.resolve({ message: { activity_month: "2026-08" } });
	requests[1].request.resolve({ message: { people: [] } });
	await august;
	assert.equal(state.month, "2026-09");
	assert.equal(renders, 1);
	await context.load("2026-09");
	assert.equal(requests.length, 4);
});

for (const [file, className] of [
	["employee_separation_effective/employee_separation_effective.js", "EmployeeSeparationEffectivePage"],
	["employee_separation_interview/employee_separation_interview.js", "EmployeeSeparationInterviewPage"],
]) {
	test(`${className} merges matching reads and ignores stale search results`, () => {
		const requests = [];
		const { PageClass } = loadClass(`hrms/hr/page/${file}`, className, (options) => { requests.push(options); });
		const search = { value: "", addEventListener() {} };
		const list = { innerHTML: "", addEventListener() {} };
		const empty = { classList: { add() {}, toggle() {}, remove() {} }, textContent: "" };
		const wrapper = {
			querySelector: (selector) => ({ "[data-search]": search, "[data-list]": list, "[data-empty]": empty, "[data-refresh]": { addEventListener() {} } })[selector],
			addEventListener() {},
		};
		const view = new PageClass({ main: [wrapper] });
		view.render_rows = () => {};
		view.refresh();
		view.refresh();
		assert.equal(requests.length, 1);
		search.value = "3362";
		view.refresh();
		assert.equal(requests.length, 2);
		requests[0].callback({ message: { rows: [{ employee_code: "old" }] } });
		assert.equal(view.rows.length, 0);
		requests[1].callback({ message: { rows: [{ employee_code: "3362" }] } });
		assert.equal(view.rows[0].employee_code, "3362");
	});
}

test("data operations refresh keeps the selected modules in the same scope", async () => {
	const source = fs.readFileSync(path.join(root, "hrms/hr/page/hrms_data_operations/hrms_data_operations.js"), "utf8");
	const loadSource = source.slice(source.indexOf("\tfunction loadAll() {"), source.indexOf("\n\tloadAll();"));
	const requests = [];
	let renders = 0;
	const state = {
		loaded: true, loadPromise: null, loadRequestId: 0,
		company: "A", cleanupMonth: "2026-08", selected: new Set(["attendance", "removed"]),
		preview: { plan_token: "stale" }, context: { modules: [] },
	};
	const context = {
		state, page: { body: {} }, window: { hrmsCompanyContext: { getCurrentCompany: () => "A" } },
		frappe: { call: () => { const request = deferred(); requests.push(request); return request.promise; } },
		$: () => ({ html() {} }), __: (value) => value, render: () => { renders++; },
	};
	vm.createContext(context);
	vm.runInContext(loadSource, context);
	const first = context.loadAll();
	assert.equal(context.loadAll(), first);
	assert.equal(requests.length, 2);
	requests[0].resolve({ message: {} });
	requests[1].resolve({ message: { company: "A", cleanup_month: "2026-08", modules: [{ key: "attendance", monthly_supported: true }] } });
	await first;
	assert.deepEqual([...state.selected], ["attendance"]);
	assert.equal(state.preview, null);
	assert.equal(renders, 1);
});

for (const pageName of ["announcement_approval", "announcement_signed_upload", "announcement_signed_records"]) {
	test(`${pageName} merges the page-load and page-show reads`, async () => {
		const source = fs.readFileSync(path.join(root, `hrms/hr/page/${pageName}/${pageName}.js`), "utf8");
		const loadSource = source.slice(source.indexOf("\tfunction load("), source.indexOf("\n\tfunction open_detail("));
		const requests = [];
		const list = { innerHTML: "", querySelectorAll: () => [] };
		const context = {
			list, loaded: false, loadPromise: null, load_promise: null, requestId: 0, request_id: 0,
			routeName: "", openedRoute: false, esc: String, time: String,
			hrms: { announcement: { call: () => { const request = deferred(); requests.push(request); return request.promise; }, bind_file_links() {} } },
			frappe: {}, __: (value) => value,
		};
		vm.createContext(context);
		vm.runInContext(loadSource, context);
		const first = context.load();
		assert.equal(context.load(), first);
		assert.equal(requests.length, 1);
		requests[0].resolve({ message: [] });
		await first;
		const second = context.load();
		assert.equal(requests.length, 2);
		requests[1].resolve({ message: [] });
		await second;
	});
}
