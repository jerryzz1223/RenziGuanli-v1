const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "hrms", "hr", "page", "hrms_workbench", "hrms_workbench.py"), "utf8");
const script = fs.readFileSync(path.join(root, "hrms", "hr", "page", "personnel_home", "personnel_home.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "hrms", "hr", "page", "personnel_home", "personnel_home.css"), "utf8");
const geojson = JSON.parse(fs.readFileSync(path.join(root, "hrms", "public", "data", "china-provinces.geojson"), "utf8"));
const sidebar = fs.readFileSync(path.join(root, "hrms", "public", "js", "hrms_home_redirect_v6.js"), "utf8");
const hooks = fs.readFileSync(path.join(root, "hrms", "hooks.py"), "utf8");

for (const marker of [
	"def get_personnel_home_data():",
	"return _get_home_data(include_personnel_analytics=True)",
	"return _get_home_data(include_personnel_analytics=False)",
	'{"COUNT": "name", "as": "count"}',
	'"native_place": _employee_distribution("custom_native_place", limit=34, include_employee_names=True)',
	"include_employee_names=False",
	'fields=[fieldname, "name", "employee_name"]',
	'"education": _employee_distribution("custom_education_level", limit=5)',
	'"department": _employee_distribution("department", limit=8)',
	'"analytics": analytics',
]) {
	if (!source.includes(marker)) throw new Error(`Homepage analytics data contract missing: ${marker}`);
}

for (const marker of ["PROVINCE_LABELS", "人员籍贯分布", "学历结构", "部门人员分布", "decode_geojson(geojson)", "render_province_map()", "select_province(province, event)", "province_ratio(count)", "占人员", "data-province", "data-employee", "employee-detail", "/assets/hrms/data/china-provinces.geojson", "人事首页", "frappe.utils.escape_html"]) {
	if (!script.includes(marker)) throw new Error(`Homepage analytics UI missing: ${marker}`);
}

if (script.includes("常用入口") || script.includes("personnel-home__shortcuts") || script.includes("route_button(")) {
	throw new Error("Personnel home must not render the redundant shortcuts panel.");
}

if (script.includes('this.metric("今日考勤"') || script.includes("data.cards?.attendance")) {
	throw new Error("Personnel home must not render the unnecessary daily-attendance metric.");
}

if (!styles.includes("grid-template-columns: repeat(3, minmax(0, 1fr))")) {
	throw new Error("The remaining personnel-home metrics must use three equal desktop columns.");
}

for (const marker of [".personnel-home__analytics", ".personnel-home__province", ".is-selected", ".personnel-home__map-tooltip", "translateY(-4px)", ".personnel-home__member-detail", ".personnel-home__member-link", ".personnel-home__member-ratio", ".personnel-home__donut", ".personnel-home__bars"]) {
	if (!styles.includes(marker)) throw new Error(`Homepage analytics style missing: ${marker}`);
}

if (!styles.includes("grid-template-columns: minmax(0, 1fr) 210px")) {
	throw new Error("The personnel-home member-detail pane must remain 210px wide so the map takes the remaining desktop space.");
}

if (geojson.type !== "FeatureCollection" || geojson.features.length !== 34 || !geojson.UTF8Encoding) {
	throw new Error("The personnel map must ship the complete ECharts provincial GeoJSON asset.");
}

if (!sidebar.includes('{ type: "link", label: "人事首页", route: "/desk/personnel-home", slug: "personnel-home" }')) {
	throw new Error("The personnel sidebar must expose a dedicated personnel home entry.");
}

if (!sidebar.includes('{ type: "link", label: "主页", route: "/desk/hrms-workbench", slug: "hrms-workbench" }')) {
	throw new Error("The system home sidebar must remain separate from the personnel home.");
}

if (!hooks.includes('/assets/hrms/js/hrms_home_redirect_v6.js?v=20260903c')) {
	throw new Error("The sidebar route fix must use a new JavaScript cache version.");
}

console.log("HRMS home analytics dashboard contract is wired.");
