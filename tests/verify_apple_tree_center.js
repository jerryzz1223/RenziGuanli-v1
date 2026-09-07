const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const pagePath = "hrms/hr/page/apple_tree_center";
const page = JSON.parse(read(`${pagePath}/apple_tree_center.json`));
const script = read(`${pagePath}/apple_tree_center.js`);
const server = read(`${pagePath}/apple_tree_center.py`);
const navigation = read("hrms/public/js/hrms_top_nav.js");
const personnelHome = read("hrms/hr/page/personnel_home/personnel_home.js");
const sidebarShell = read("hrms/public/js/hrms_home_redirect_v6.js");
const hooks = read("hrms/hooks.py");

if (page.name !== "apple-tree-center" || page.title !== "苹果树统计") {
	throw new Error("Apple-tree statistics must be a dedicated HRMS page.");
}

for (const marker of ["_summarize_records", "HRMS Monthly Attendance Summary", "list_monthly_attendance_summary", "get_employee_summary", "employee_doc.check_permission", "employee_code", "person_key", "green_apples", "red_apples", "net_apples", "attendance_month", "月度考勤终稿", "year: str", "month: str", "search: str", "company: str"]) {
	if (!server.includes(marker)) throw new Error(`Apple-tree statistics server contract is missing: ${marker}`);
}

for (const marker of ["统计年份", "统计期间", "个人季度汇总", "个人年度汇总", "每月明细", "苹果树明细", "monthly-detail", "data-employee-detail", "data-apple-table-sort", "data-apple-table-filter", "data-apple-table-page", "查看明细", "tablePager"]) {
	if (!script.includes(marker)) throw new Error(`Apple-tree statistics screen is missing: ${marker}`);
}

for (const marker of ['label: "苹果树统计"', 'route: "/desk/apple-tree-center"', "按员工、月份和年份查看苹果树数量与明细"]) {
	if (!navigation.includes(marker)) throw new Error(`More menu is missing Apple-tree entry: ${marker}`);
}

for (const marker of ["personnel-home__apple-tree", "查看苹果树", '["apple-tree-center"]']) {
	if (!personnelHome.includes(marker)) throw new Error(`Personnel home is missing Apple-tree jump: ${marker}`);
}

for (const marker of ['label: "苹果树统计"', 'keys: ["apple-tree-center"]', 'label: "个人年度汇总"', 'label: "每月明细"', 'route: "/desk/apple-tree-center/monthly-detail"', 'route[0] === "apple-tree-center"']) {
	if (!sidebarShell.includes(marker)) throw new Error(`Apple-tree statistics must have its own contextual drawer: ${marker}`);
}

if (!hooks.includes("/assets/hrms/js/hrms_home_redirect_v6.js?v=20260907c")) {
	throw new Error("The sidebar route correction must have a fresh JavaScript cache version.");
}

console.log("Apple-tree statistics page, navigation, and personnel jump contracts passed.");

// Exercise direct employee routes, the name link and the return-to-summary state.
const assert = require("node:assert/strict");
const vm = require("node:vm");
let route = ["apple-tree-center", "person", "001", "2025"];
const context = {
	frappe: { pages: { "apple-tree-center": {} }, get_route: () => route, utils: { escape_html: String } },
	__: (text) => text,
};
vm.createContext(context);
vm.runInContext(script + "\nthis.Center = AppleTreeCenter;", context);
const center = new context.Center({ main: [{}] });
let loads = 0;
center.loadPerson = () => { loads++; center.personRequestKey = "pending"; };
center.show();
assert.equal(center.activePerson, "001");
assert.equal(center.year, "2025");
assert.equal(loads, 1);
center.refreshFromRoute();
assert.equal(loads, 1, "Repeated page-show must not issue a duplicate detail request");
center.data = { filters: { year: "2025" }, people: [{ employee: "001", employee_code: "001", employee_name: "员工甲" }] };
assert.match(center.annualSummaryTable(), /href="\/desk\/apple-tree-center\/person\/001\/2025"/);
let rendered = false;
center.render = () => { rendered = true; };
route = ["apple-tree-center"];
center.refreshFromRoute();
assert.equal(center.activePerson, "");
assert.equal(rendered, true);
assert.match(center.detailValue(null, true), /—/);
assert.equal(center.detailValue(0, true), "0");
console.log("Employee route, name link, return state and missing-value checks passed.");

center.year = "2026";
center.personData = {
	person: { employee_code: "001", employee_name: "员工甲" },
	rows: [{ attendance_month: "2026-07", employee_code: "001", green_apples: 86, red_apples: 0 }],
};
const calendar = center.personMonthRows();
assert.equal(calendar.length, 12);
assert.equal(calendar[0].attendance_month, "2026-01");
assert.equal(calendar[11].attendance_month, "2026-12");
assert.equal(calendar[6].green_apples, 86);
assert.equal(calendar[0].green_apples, undefined, "An unrecorded month must not invent zero apples");
const cols = [{ field: "attendance_month", label: "月份" }, { field: "green_apples", label: "绿苹果", numeric: true }];
assert.match(center.personGrid(cols), /2601/);
assert.match(center.personGrid(cols), /2612/);
assert.match(center.personGrid(cols), /is-year-end/);
assert.equal((center.personGrid(cols).match(/>86<\/td>/g) || []).length, 2, "One July value and one total, with no placeholder inflation");
const sortRows = [
	{ attendance_month: "2026-01", green_apples: 10 },
	{ attendance_month: "2026-02", green_apples: null },
	{ attendance_month: "2026-03", green_apples: 2 },
	{ attendance_month: "2026-04", green_apples: 0 },
];
center.personSort = { field: "green_apples", direction: "asc" };
assert.equal(JSON.stringify(center.sortPersonRows(sortRows, cols).map(row => row.green_apples)), "[0,2,10,null]");
center.personSort.direction = "desc";
assert.equal(JSON.stringify(center.sortPersonRows(sortRows, cols).map(row => row.green_apples)), "[10,2,0,null]");
center.personSort = { field: "attendance_month", direction: "desc" };
assert.equal(center.sortPersonRows(calendar, cols)[0].attendance_month, "2026-12");
const sortedGrid = center.personGrid(cols);
assert.match(sortedGrid, /aria-sort="descending"/);
assert.ok(sortedGrid.indexOf("<tfoot>") > sortedGrid.indexOf("</tbody>"));
assert.doesNotMatch(sortedGrid, /data-person-filter/);
console.log("Twelve-month grid, numeric sorting, empty values and fixed totals passed.");
