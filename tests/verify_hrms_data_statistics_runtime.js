const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

test("statistics operator refresh accepts a legacy Frappe Deferred", async () => {
	const source = fs.readFileSync(
		path.join(root, "hrms/hr/page/hrms_data_statistics/hrms_data_statistics.js"),
		"utf8",
	);
	const start = source.indexOf("\tfunction loadOperators() {");
	const end = source.indexOf("\n\tfunction loadActivity(", start);
	assert.notEqual(start, -1, "statistics operator loader must remain available");
	assert.notEqual(end, -1, "statistics activity loader must follow the operator loader");

	let callCount = 0;
	const state = { month: "2026-10", operatorRequestId: 0, operatorData: null };
	const context = {
		state,
		window: { hrmsCompanyContext: { getCurrentCompany: () => "Main Company" } },
		frappe: {
			call(method, args) {
				callCount += 1;
				assert.equal(method, "hrms.api.data_statistics.get_hrms_operator_statistics");
				assert.equal(args.company, "Main Company");
				assert.equal(args.month, "2026-10");
				return {
					// Legacy Frappe can return a jQuery thenable without catch/finally.
					then(resolve) {
						resolve({ message: { people: [{ user: "auditor@example.test" }], forms: [] } });
					},
				};
			},
		},
		$: () => ({ html() {} }),
		__: (value) => value,
		render() {},
	};
	vm.createContext(context);
	vm.runInContext(source.slice(start, end), context);

	await assert.doesNotReject(context.loadOperators());
	assert.equal(callCount, 1);
	assert.deepEqual(state.operatorData, { people: [{ user: "auditor@example.test" }], forms: [] });
});
