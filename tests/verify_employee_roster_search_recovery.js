const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "hrms/public/js/erpnext/employee_list.js"), "utf8");

function expect(condition, message) {
	if (!condition) throw new Error(message);
}

[
	'add_inner_button(__("设置花名册字段")',
	'add_inner_button(__("清除搜索与筛选")',
	"function clear_roster_search_and_filters",
].forEach((needle) => expect(!source.includes(needle), `Obsolete roster action remains: ${needle}`));

["添加员工", "表单导入", "导出", "allowed_labels", "input[placeholder*='搜索']"].forEach((needle) =>
	expect(source.includes(needle), `Roster toolbar must retain only the approved actions: ${needle}`),
);

[
	"ensure_roster_empty_result_header",
	"hrms-roster-table-header",
	"remove_native_roster_list_header",
	"hrms-roster-table-header__input",
	"clear_roster_column_filter",
].forEach((needle) => expect(source.includes(needle), `Empty roster result must retain its fixed header and recoverable filter entry point: ${needle}`));

[
	'row.className = "hrms-roster-table-row"',
	'row.addEventListener("click"',
	'row.addEventListener("keydown"',
	'"hrms-roster-employee-name-link"',
	"function open_roster_employee_detail",
	'frappe.set_route("employee-detail", employee_name)',
].forEach((needle) => expect(source.includes(needle), `Roster table rows must open the employee detail: ${needle}`));

[
	"ROSTER_SEARCH_RECOVERY_STORAGE_KEY",
	"function recover_empty_roster_search",
	"function has_roster_transient_search",
	"function get_roster_search_term",
	"function is_roster_empty_result",
	"recover_empty_roster_search(listview);",
	"未找到员工，已清除本次搜索并恢复花名册",
].forEach((needle) => expect(!source.includes(needle), `Unexpected ${needle}`));

expect(
	!source.includes(".filter-button, .filter-x-button, .filter-popover"),
	"Native filter clear button must remain visible",
);

console.log("employee roster search persistence verification passed");
