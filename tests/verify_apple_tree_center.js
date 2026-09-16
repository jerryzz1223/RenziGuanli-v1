const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const pagePath = "hrms/hr/page/apple_tree_center";
const page = JSON.parse(read(`${pagePath}/apple_tree_center.json`));
const script = read(`${pagePath}/apple_tree_center.js`);
const styles = read(`${pagePath}/apple_tree_center.css`);
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

for (const marker of ["统计年份", "统计期间", "开始日期", "结束日期", "按日期查询", "data-apple-start-date", "data-apple-end-date", "data-apple-date-apply", "个人季度汇总", "个人年度汇总", "每月明细", "苹果树明细", "monthly-detail", "data-employee-detail", "data-apple-table-sort", "data-apple-table-filter", "data-apple-table-page", "data-apple-export", "导出 Excel", "exportCurrentView", "download_export", "column_filters", "sort_key", "detail_start_date", "detail_search", "personUrl", "outerFilterParams", "data-person-detail-start-date", "data-person-detail-search", "data-person-detail-apply", "data-apple-history-import", "历史数据导入", "openHistoryImport", "preview_history_import", "import_history", "download_history_import_template", "下载填写模板", "受奖/惩人工号", "disable_file_browser: true", "allow_web_link: false", "allow_take_photo: false", "allow_toggle_private: false", "查看明细", "tablePager"]) {
	if (!script.includes(marker)) throw new Error(`Apple-tree statistics screen is missing: ${marker}`);
}
if (!/\.apple-tree-center__data-table thead tr:first-child th,[\s\S]*position: sticky; top: var\(--page-head-height, 48px\)/.test(styles)) {
	throw new Error("Annual Apple-tree table header must stick to the top while scrolling.");
}
if (!/\.apple-tree-center__data-table thead tr:nth-child\(2\) th,[\s\S]*position: sticky; top: calc\(var\(--page-head-height, 48px\) \+ 41px\)/.test(styles)) {
	throw new Error("Annual Apple-tree filter row must stay below the sticky header while scrolling.");
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
	URLSearchParams,
	window: { hrmsCompanyContext: { getCurrentCompany: () => "永新" }, open: (url) => { context.openedUrl = url; } },
};
vm.createContext(context);
vm.runInContext(script + "\nthis.Center = AppleTreeCenter;", context);
const center = new context.Center({ main: [{}] });
assert.equal(center.monthDateRange("2026-06").startDate, "2026-06-01");
assert.equal(center.monthDateRange("2026-06").endDate, "2026-06-30", "June must use its real last day, not the invalid June 31");
assert.equal(center.monthDateRange("2024-02").endDate, "2024-02-29");
let loads = 0;
center.loadPerson = () => { loads++; center.personRequestKey = "pending"; };
center.show();
assert.equal(center.activePerson, "001");
assert.equal(center.year, "2025");
assert.equal(loads, 1);
center.refreshFromRoute();
assert.equal(loads, 1, "Repeated page-show must not issue a duplicate detail request");
center.data = { filters: { year: "2025" }, people: [{ employee: "EMP-001", employee_code: "001", employee_name: "员工甲" }] };
assert.match(center.annualSummaryTable(), /href="\/desk\/apple-tree-center\/person\/001\/2025"/);
center.month = "2025-06";
center.startDate = "2025-06-10";
center.endDate = "2025-06-18";
center.search = "保养";
assert.match(center.personUrl("001"), /\/desk\/apple-tree-center\/person\/001\/2025\?month=2025-06&start_date=2025-06-10&end_date=2025-06-18&search=%E4%BF%9D%E5%85%BB/);
let rendered = false;
center.render = () => { rendered = true; };
route = ["apple-tree-center"];
center.refreshFromRoute();
assert.equal(center.activePerson, "");
assert.equal(rendered, true);
assert.match(center.detailValue(null, true), /—/);
assert.equal(center.detailValue(0, true), "0");
center.view = "monthly-detail";
center.year = "2026";
center.month = "2026-08";
center.table = { page: 1, pageSize: 20, sortKey: "net_apples", sortOrder: "desc", filters: { department: "连续课" } };
center.exportCurrentView();
assert.match(context.openedUrl, /download_export/);
assert.match(context.openedUrl, /view=monthly-detail/);
assert.match(context.openedUrl, /month=2026-08/);
assert.match(decodeURIComponent(context.openedUrl), /"department":"连续课"/);
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
	person: { employee: "EMP-388", department: "连续课", employee_code: "388", employee_name: "孔红西" },
	rows: [
		{ sequence: 1, created_at: "2026-06-01 08:50:07", reward_date: "2026-06-01", department: "连续课", employee_code: "388", employee_name: "孔红西", green_apples: 68, red_apples: 0, reward_item: "连续课/绿苹果/支援", note: "配合部门生产连续夜班", created_by_name: "管理员" },
	],
	columns: [
		{ field: "sequence", label: "序号" }, { field: "created_at", label: "创建时间" }, { field: "reward_date", label: "奖/惩日期" },
		{ field: "department", label: "受奖/惩人部门" }, { field: "employee_name", label: "受奖/惩人" },
		{ field: "green_apples", label: "绿苹果", numeric: true }, { field: "red_apples", label: "红苹果", numeric: true },
		{ field: "reward_item", label: "奖/惩项目" }, { field: "note", label: "备注" }, { field: "created_by_name", label: "创建人" },
		{ field: "signature", label: "签名" }, { field: "note_2", label: "备注" },
	],
	totals: { green_apples: 68, red_apples: 0 },
};
assert.equal(center.personRecordedMonthCount(), 1);
const detailGrid = center.personGrid(center.personDetailColumns());
assert.match(detailGrid, /创建时间/);
assert.match(detailGrid, /奖\/惩项目/);
assert.match(detailGrid, /2026-06-01/);
assert.match(detailGrid, />68<\/td>/);
assert.match(detailGrid, />0<\/td>/);
assert.equal((detailGrid.match(/<th class=/g) || []).length, 12);
assert.equal((detailGrid.match(/<tbody>.*?<tr>/s) || []).length, 1);
assert.ok(detailGrid.indexOf("<tfoot>") > detailGrid.indexOf("</tbody>"));
assert.match(detailGrid, /apple-tree-center__apple-detail-table/);
center.month = "2026-06";
center.startDate = "2026-06-01";
center.endDate = "2026-06-30";
center.personFilters = center.personDefaultFilters();
const inheritedFilters = center.personDetailFilters();
assert.match(inheritedFilters, /value="2026-06-01"/);
assert.match(inheritedFilters, /value="2026-06-30"/);
center.personData.rows.push({ sequence: 2, reward_date: "2026-06-18", department: "连续课", employee_code: "388", employee_name: "孔红西", green_apples: 2, red_apples: 0, reward_item: "连续课/绿苹果/保养", note: "保养Y线" });
center.personFilters = { startDate: "2026-06-10", endDate: "2026-06-18", search: "保养Y" };
assert.equal(center.personDetailRows().length, 1);
assert.match(center.personGrid(center.personDetailColumns()), /保养Y线/);
center.view = "person";
center.activePerson = "388";
center.month = "2026-06";
center.startDate = "2026-06-01";
center.endDate = "2026-06-30";
center.search = "孔红西";
context.openedUrl = "";
center.exportCurrentView();
assert.match(context.openedUrl, /view=person/);
assert.match(context.openedUrl, /month=2026-06/);
assert.match(context.openedUrl, /start_date=2026-06-01/);
assert.match(context.openedUrl, /end_date=2026-06-30/);
assert.match(context.openedUrl, /search=%E5%AD%94%E7%BA%A2%E8%A5%BF/);
assert.match(context.openedUrl, /detail_start_date=2026-06-10/);
assert.match(context.openedUrl, /detail_end_date=2026-06-18/);
assert.match(context.openedUrl, /detail_search=%E4%BF%9D%E5%85%BBY/);
console.log("Personal detail uses the requested 12-column Apple-tree reward/penalty layout and bottom total.");
