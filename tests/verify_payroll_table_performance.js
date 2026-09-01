const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../hrms/hr/page/payroll_input_center/payroll_input_center.js"), "utf8");

assert.match(source, /new MutationObserver\(\(\) => this\.schedule_table_controls_decoration\(\)\)/,
	"Table-control decoration should be coalesced instead of running for every mutation.");
assert.match(source, /window\.setTimeout\(\(\) => this\.filter_table_rows\(input\.closest\("table"\)\), 120\)/,
	"Column filtering should wait briefly for a pause in typing.");
assert.ok(!source.includes("visibleRows.indexOf(row)"),
	"Pagination must not do a linear lookup for every visible row.");
assert.match(source, /cell\?\.textContent/, "Filtering should avoid layout-dependent innerText reads.");

console.log("Payroll table performance contract passed.");
