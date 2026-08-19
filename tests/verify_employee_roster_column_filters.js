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
	"search.exact ? search.value",
]) {
	mustInclude(employeeList, marker, `花名册缺少表头筛选逻辑：${marker}`);
}

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

for (const obsoleteMarker of ["hrms-roster-search-control", "hrms-roster-search-button"]) {
	if (employeeList.includes(obsoleteMarker)) {
		throw new Error(`花名册仍包含重复的顶部搜索控件：${obsoleteMarker}`);
	}
}

console.log("employee roster column sorting and autocomplete filters verified");
