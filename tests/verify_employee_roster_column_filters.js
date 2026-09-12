const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const employeeList = fs.readFileSync(
	path.join(root, "hrms/public/js/erpnext/employee_list.js"),
	"utf8",
);
const rosterCss = fs.readFileSync(path.join(root, "hrms/public/css/hrms_top_nav.css"), "utf8");

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message);
}

for (const marker of [
	"hide_native_roster_field_filters",
	"enhance_roster_column_headers",
	"hrms-roster-column-filter-hotspot",
	"open_roster_column_filter",
	"get_roster_filter_suggestions",
	"apply_roster_column_filter",
	"ROSTER_TABLE_FILTER_DELAY_MS",
	"schedule_roster_table_filter",
	"apply_roster_table_filter",
	"hrms-roster-table-filter-input",
	'input.addEventListener("compositionend"',
	"state.select_filter_input = column.fieldname;",
	"restored_input.select();",
	"event.stopPropagation();",
	"search.exact ? search.value",
]) {
	mustInclude(employeeList, marker, `花名册缺少表头筛选逻辑：${marker}`);
}

mustInclude(
	employeeList,
	".hrms-roster-table-header__input, .hrms-roster-table-filter-input",
	"花名册表头搜索框不能被通用工具栏清理逻辑隐藏。",
);

for (const marker of [
	".hrms-roster-native-filters-hidden",
	".hrms-roster-column-filter-hotspot",
	".hrms-roster-column-filter-editor",
	".hrms-roster-column-filter-suggestions.is-visible",
	".hrms-roster-empty-result-header",
	".hrms-roster-empty-result-header__input",
]) {
	mustInclude(rosterCss, marker, `花名册缺少表头筛选样式：${marker}`);
}

for (const marker of [
	'{ fieldname: "employee_name", label: "姓名", sort_field: "employee_name", filterable: true, sortable: true }',
	'{ fieldname: "custom_employee_code", label: "工号", sort_field: "custom_employee_code", filterable: true, sortable: true }',
	'column.fieldname === "employee_name"',
	"hrms-roster-employee-name-cell",
]) {
	mustInclude(employeeList, marker, `花名册的姓名与工号必须分成独立列：${marker}`);
}
if (employeeList.includes("employee_identity")) throw new Error("花名册不应继续合并姓名与工号列。");

for (const obsoleteMarker of ["hrms-roster-search-control", "hrms-roster-search-button"]) {
	if (employeeList.includes(obsoleteMarker)) {
		throw new Error(`花名册仍包含重复的顶部搜索控件：${obsoleteMarker}`);
	}
}

console.log("employee roster column sorting and autocomplete filters verified");
