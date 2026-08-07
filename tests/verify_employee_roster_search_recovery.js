const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "hrms/public/js/erpnext/employee_list.js"), "utf8");

function expect(condition, message) {
	if (!condition) throw new Error(message);
}

[
	'add_inner_button(__("清除搜索与筛选")',
	"function clear_roster_search_and_filters",
	"frappe.route_options = {};",
].forEach((needle) => expect(source.includes(needle), `Missing ${needle}`));

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
