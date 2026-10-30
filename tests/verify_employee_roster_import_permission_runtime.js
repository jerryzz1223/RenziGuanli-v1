const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
	path.join(root, "hrms/hr/page/employee_roster_import/employee_roster_import.js"),
	"utf8",
);
const permissionLoader = source.slice(
	source.indexOf("\tfunction load_import_permission()"),
	source.indexOf("\n\tfunction require_import_permission()"),
);

const loadPermission = (call, user = "test@example.com") => {
	const context = {
		state: { capabilities_loaded: false, can_import: null },
		frappe: { session: { user }, call },
		Promise,
	};
	vm.createContext(context);
	vm.runInContext(`${permissionLoader}\nthis.load_import_permission = load_import_permission;`, context);
	return { context, load: context.load_import_permission };
};

test("roster import permission check accepts legacy Deferred results", async () => {
	const { context, load } = loadPermission(() => ({
		// Older Frappe returns a thenable without native Promise catch/finally.
		then(resolve) {
			resolve({ message: { capabilities: ["roster_import_submit"] } });
		},
	}));

	await assert.doesNotReject(load());
	assert.equal(context.state.capabilities_loaded, true);
	assert.equal(context.state.can_import, true);
});

test("roster import permission check safely denies when legacy Deferred rejects", async () => {
	const { context, load } = loadPermission(() => ({
		then(_resolve, reject) {
			reject(new Error("permission endpoint unavailable"));
		},
	}));

	await assert.doesNotReject(load());
	assert.equal(context.state.capabilities_loaded, true);
	assert.equal(context.state.can_import, false);
});
