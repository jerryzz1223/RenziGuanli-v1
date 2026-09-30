const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../hrms/hr/page/apple_tree_center/apple_tree_center.js"), "utf8");
const pending = [];
const classes = new Set();
const wrapper = {
	innerHTML: "existing table",
	classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
	setAttribute() {}, removeAttribute() {}, querySelector: () => null,
};
let company = "永新";
let alerts = 0;
const context = {
	frappe: {
		pages: { "apple-tree-center": {} }, get_route: () => ["apple-tree-center"],
		call: (args) => new Promise((resolve, reject) => pending.push({ args, resolve, reject })),
		show_alert: () => { alerts++; },
	},
	window: { hrmsCompanyContext: { getCurrentCompany: () => company } },
	__: (value) => value, URLSearchParams,
};
vm.createContext(context);
vm.runInContext(source + "\nthis.Center = AppleTreeCenter;", context);

async function run() {
	const center = new context.Center({ main: [wrapper] });
	let renders = 0;
	center.render = () => { renders++; wrapper.innerHTML = "rendered table"; };
	center.data = { filters: { company, year: "2026" }, people: [] };
	const first = center.load();
	const duplicate = center.load();
	assert.equal(first, duplicate, "repeated requests for the same filters share one in-flight call");
	assert.equal(wrapper.innerHTML, "existing table", "filter changes keep the old table visible");
	assert.equal(classes.has("apple-tree-center--loading"), true);
	await Promise.resolve();
	assert.equal(pending.length, 1);
	assert.equal(pending[0].args.args.include_records, 0, "annual summary skips row-level payload");
	pending.shift().resolve({ message: { filters: { company, year: "2026" }, people: [] } });
	await first;
	assert.equal(renders, 1);
	assert.equal(classes.has("apple-tree-center--loading"), false);
	await center.load();
	assert.equal(pending.length, 0, "recent unchanged data is reused");
	const forced = center.load(true);
	await Promise.resolve();
	assert.equal(pending.length, 1, "explicit refresh bypasses the short cache");
	pending.shift().reject(new Error("network unavailable"));
	await forced;
	assert.equal(wrapper.innerHTML, "rendered table", "failed refresh preserves the last data");
	assert.equal(alerts, 1);
	company = "另一公司";
	const switched = center.load();
	assert.match(wrapper.innerHTML, /正在加载苹果树统计/, "company switches do not show another company's table");
	await Promise.resolve();
	pending.shift().resolve({ message: { filters: { company, year: "2026" }, people: [] } });
	await switched;
	assert.equal(center.data.filters.company, company);
	center.view = "monthly-detail";
	const monthly = center.load();
	await Promise.resolve();
	assert.equal(pending[0].args.args.include_records, 1, "monthly detail requests its rows");
	pending.shift().resolve({ message: { filters: { company, year: "2026" }, people: [], records: [], records_included: true } });
	await monthly;
	console.log("Apple-tree loading: request coalescing, short cache, refresh, retained results and company isolation passed.");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
