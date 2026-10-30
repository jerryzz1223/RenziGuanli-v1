const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function deferred() {
	let resolveRequest;
	let rejectRequest;
	return {
		then(resolve, reject) {
			resolveRequest = resolve;
			rejectRequest = reject;
		},
		resolve(value) { resolveRequest(value); },
		reject(error) { rejectRequest(error); },
	};
}

function loadPage(call) {
	const source = fs.readFileSync(
		path.join(root, "hrms/hr/page/hrms_model_center/hrms_model_center.js"),
		"utf8",
	);
	const body = { innerHTML: "" };
	const jquery = (target) => ({
		html(value) {
			if (value !== undefined) target.innerHTML = value;
			return this;
		},
		find() { return { 0: null, on() { return this; }, off() { return this; }, removeClass() { return this; }, addClass() { return this; } }; },
	});
	const frappe = {
		pages: { "hrms-model-center": {} },
		call,
		ui: { make_app_page: () => ({ body }) },
		utils: { escape_html: String },
		user_roles: ["System Manager"],
	};
	const context = { __: (value) => value, $: jquery, frappe, window: { frappe } };
	vm.createContext(context);
	vm.runInContext(source, context);
	return { body, onPageLoad: context.frappe.pages["hrms-model-center"].on_page_load };
}

test("model center loads through a then-only Frappe Deferred", async () => {
	const pending = deferred();
	const page = loadPage(() => pending);

	page.onPageLoad({});
	await new Promise((resolve) => setImmediate(resolve));
	pending.resolve({ message: { items: [], summary: { project_model_count: 3 }, guidance: {} } });
	await new Promise((resolve) => setImmediate(resolve));

	assert.match(page.body.innerHTML, /本项目基础模型目录/);
	assert.doesNotMatch(page.body.innerHTML, /无法读取基础模型目录/);
});

test("model center shows its load error after a then-only Deferred rejects", async () => {
	const pending = deferred();
	const page = loadPage(() => pending);

	page.onPageLoad({});
	await new Promise((resolve) => setImmediate(resolve));
	pending.reject(new Error("network unavailable"));
	await new Promise((resolve) => setImmediate(resolve));

	assert.match(page.body.innerHTML, /无法读取基础模型目录/);
});
