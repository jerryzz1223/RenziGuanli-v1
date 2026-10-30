const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadPage(call) {
	const source = fs.readFileSync(
		path.join(root, "hrms/hr/page/salary_architecture/salary_architecture.js"),
		"utf8",
	);
	const classSource = source.slice(source.indexOf("class SalaryArchitecture"));
	const context = {
		__: (value) => value,
		frappe: { call, utils: { escape_html: String } },
	};
	vm.createContext(context);
	vm.runInContext(`${classSource}\nthis.SalaryArchitecture = SalaryArchitecture;`, context);
	const wrapper = { innerHTML: "" };
	const page = { main: [wrapper] };
	const salaryArchitecture = new context.SalaryArchitecture(page);
	salaryArchitecture.render = () => { salaryArchitecture.renderCount = (salaryArchitecture.renderCount || 0) + 1; };
	return salaryArchitecture;
}

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

test("salary architecture loads through a then-only Frappe Deferred", async () => {
	const pending = deferred();
	let callCount = 0;
	const page = loadPage(() => {
		callCount += 1;
		return callCount === 1 ? pending : Promise.resolve({ message: [] });
	});

	page.load();
	await new Promise((resolve) => setImmediate(resolve));
	pending.resolve({ message: [{ name: "V2I", structure_version: "2I", grade_count: 1 }] });
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(page.selectedVersion, "V2I");
	assert.equal(page.renderCount, 1);
	assert.equal(callCount, 2, "the selected version must load its salary grades after the versions request");
	assert.equal(page.levels.length, 20, "an empty selected version must expose the default twenty salary levels");
	assert.equal(page.levels[0].level, 1);
	assert.equal(page.levels[19].level, 20);
	assert.equal(page.levels[0].base_salary, 0);
	assert.equal(page.levels[0].function_allowance, 0);
});

test("salary architecture shows its load error after a then-only Deferred rejects", async () => {
	const pending = deferred();
	const page = loadPage(() => pending);

	page.load();
	await new Promise((resolve) => setImmediate(resolve));
	pending.reject(new Error("network unavailable"));
	await new Promise((resolve) => setImmediate(resolve));

	assert.match(page.wrapper.innerHTML, /无法读取薪级表/);
});
