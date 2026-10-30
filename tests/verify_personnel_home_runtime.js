const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

const loadPersonnelHome = (call) => {
	const context = {
		frappe: {
			pages: { "personnel-home": {} },
			ui: { make_app_page() {} },
			call,
			utils: { escape_html: String },
		},
		__: (value) => value,
	};
	vm.createContext(context);
	vm.runInContext(
		fs.readFileSync(path.join(root, "hrms/hr/page/personnel_home/personnel_home.js"), "utf8"),
		context,
	);
	return vm.runInContext("PersonnelHome", context);
};

test("personnel home accepts Frappe Deferred responses and releases its loading guard", async () => {
	const PersonnelHome = loadPersonnelHome(() => ({
		// Legacy Frappe may return a jQuery thenable without Promise.prototype.finally().
		then(resolve) {
			resolve({ message: { cards: {} } });
		},
	}));
	const refreshButton = {
		disabled: false,
		isConnected: true,
		setAttribute() {},
		removeAttribute() {},
	};
	const home = new PersonnelHome({
		main: [{ innerHTML: "", querySelector: (selector) => selector === "[data-personnel-refresh]" ? refreshButton : null }],
		set_title() {},
	});
	home.render = () => {};

	await assert.doesNotReject(home.show(true));
	assert.deepEqual(home.data, { cards: {} });
	assert.equal(home.load_promise, null, "completed Deferred reads must release the in-flight request");
	assert.equal(refreshButton.disabled, false, "cleanup must re-enable the refresh button");
});
