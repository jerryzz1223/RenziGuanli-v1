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

for (const marker of ["_summarize_records", "HRMS Monthly Attendance Summary", "list_monthly_attendance_summary", "HRMS Apple Tree History Summary", "apple_tree_history", "preview_history_import", "import_history", "download_history_import_template", "_build_history_import_template", "受奖/惩人工号", "_history_sheet_rows", "get_employee_summary", "employee_doc.check_permission", "employee_code", "person_key", "green_apples", "red_apples", "net_apples", "attendance_month", "月度考勤终稿", "year: str", "month: str", "search: str", "company: str", "start_date: str", "end_date: str", "_parse_custom_date_range"]) {
	if (!server.includes(marker)) throw new Error(`Apple-tree statistics server contract is missing: ${marker}`);
}

for (const marker of ["统计年份", "统计期间", "开始日期", "结束日期", "按日期查询", "data-apple-start-date", "data-apple-end-date", "data-apple-date-apply", "个人季度汇总", "个人年度汇总", "每月明细", "苹果树明细", "monthly-detail", "data-employee-detail", "data-apple-table-sort", "data-apple-table-filter", "data-apple-table-page", "data-apple-history-import", "历史数据导入", "openHistoryImport", "preview_history_import", "import_history", "download_history_import_template", "下载填写模板", "受奖/惩人工号", "disable_file_browser: true", "allow_web_link: false", "allow_take_photo: false", "allow_toggle_private: false", "查看明细", "tablePager"]) {
	if (!script.includes(marker)) throw new Error(`Apple-tree statistics screen is missing: ${marker}`);
}

for (const marker of ['label: "苹果树统计"', 'route: "/desk/apple-tree-center"', "按员工、月份和年份查看苹果树数量与明细"]) {
	if (!navigation.includes(marker)) throw new Error(`More menu is missing Apple-tree entry: ${marker}`);
}

for (const marker of ["personnel-home__apple-tree", "查看苹果树", '["apple-tree-center"]']) {
	if (!personnelHome.includes(marker)) throw new Error(`Personnel home is missing Apple-tree jump: ${marker}`);
}

for (const marker of ['label: "苹果树统计"', 'keys: ["apple-tree-center"]', 'active_slugs: ["apple-tree-center/annual-summary", "apple-tree-center/monthly-detail", "apple-tree-center/person"]', 'route[0] === "apple-tree-center"']) {
	if (!sidebarShell.includes(marker)) throw new Error(`Apple-tree statistics must have its own contextual drawer: ${marker}`);
}
const appleTreeSidebar = sidebarShell.match(/label: "苹果树统计",[\s\S]*?\n\t\t},\n\t\t\{/);
if (!appleTreeSidebar || (appleTreeSidebar[0].match(/type: "link"/g) || []).length !== 1) {
	throw new Error("Apple-tree statistics drawer must keep one entry and use in-page view tabs.");
}

if (!hooks.includes("/assets/hrms/js/hrms_home_redirect_v6.js?v=")) {
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

center.data = {
	records: [
		{ attendance_month: "2026-07", department: "连续课", employee_name: "员工甲", employee_code: "001", green_apples: 8, red_apples: 1, reward_amount: 0, reward_item: "月度考勤终稿", approval_result: "已确认", approval_status: "已锁定" },
		{ reward_date: "2026-06-18", department: "品管课", employee_name: "员工乙", employee_code: "010", green_apples: 2, red_apples: 4, reward_amount: -10, reward_item: "手工补录" },
	],
};
center.table = { page: 1, pageSize: 20, sortKey: "net_apples", sortOrder: "desc", filters: {} };
assert.deepEqual(Array.from(center.monthlyDetailRows(), row => row.employee_code), ["001", "010"]);
center.table.sortOrder = "asc";
assert.deepEqual(Array.from(center.monthlyDetailRows(), row => row.employee_code), ["010", "001"]);
center.table.filters = { attendance_month: "2026-06", reward_item: "手工", final_status: "未提供" };
assert.deepEqual(Array.from(center.monthlyDetailRows(), row => row.employee_code), ["010"]);
const monthlyTable = center.monthlyDetailTable();
assert.match(monthlyTable, /apple-tree-center__monthly-table/);
assert.equal((monthlyTable.match(/data-apple-table-sort=/g) || []).length, 10);
assert.equal((monthlyTable.match(/data-apple-table-filter=/g) || []).length, 10);
assert.match(monthlyTable, />-2<\/td>/);
center.table.filters.department = "不存在的部门";
assert.match(center.monthlyDetailTable(), /没有符合列筛选条件的明细记录/);
console.log("Monthly-detail column filtering and numeric sorting passed.");

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
const frozenGrid = center.personGrid([
	{ field: "attendance_month", label: "月份" },
	{ field: "department", label: "部门" },
	{ field: "employee_name", label: "姓名" },
	{ field: "employee_code", label: "工号" },
	{ field: "green_apples", label: "绿苹果", numeric: true },
]);
for (const marker of ["is-frozen is-month", "is-frozen is-department", "is-frozen is-employee-name", "is-frozen is-employee-code"]) {
	assert.match(frozenGrid, new RegExp(marker), `Personal detail must freeze identity column: ${marker}`);
}
console.log("Twelve-month grid, numeric sorting, four frozen identity columns and fixed totals passed.");
