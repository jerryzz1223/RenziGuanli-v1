const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const redirectPath = path.join(root, "hrms", "public", "js", "hrms_home_redirect_v6.js");
const topNavCssPath = path.join(root, "hrms", "public", "css", "hrms_top_nav.css");
const hooksPath = path.join(root, "hrms", "hooks.py");
const hrSetupPath = path.join(root, "hrms", "hr", "workspace", "hr_setup", "hr_setup.json");
const hrSetupSidebarPath = path.join(root, "hrms", "workspace_sidebar", "hr_setup.json");
const personnelPath = path.join(root, "hrms", "hr", "workspace", "personnel", "personnel.json");
const personnelSidebarPath = path.join(root, "hrms", "workspace_sidebar", "personnel.json");
const pageJsonPath = path.join(root, "hrms", "hr", "page", "staff_attribute_settings", "staff_attribute_settings.json");
const pageJsPath = path.join(root, "hrms", "hr", "page", "staff_attribute_settings", "staff_attribute_settings.js");

const redirect = fs.readFileSync(redirectPath, "utf8");
const topNavCss = fs.readFileSync(topNavCssPath, "utf8");
const hooks = fs.readFileSync(hooksPath, "utf8");
const hrSetup = JSON.parse(fs.readFileSync(hrSetupPath, "utf8"));
const hrSetupSidebar = JSON.parse(fs.readFileSync(hrSetupSidebarPath, "utf8"));
const personnel = JSON.parse(fs.readFileSync(personnelPath, "utf8"));
const personnelSidebar = JSON.parse(fs.readFileSync(personnelSidebarPath, "utf8"));

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) {
		throw new Error(message || `Missing marker: ${marker}`);
	}
}

for (const marker of [
	"fix_desk_home_links",
	"hide_frappe_breadcrumbs",
	"enable_sidebar_section_collapse",
	"toggle_sidebar_section",
	".sidebar-item-container.section-item",
	".sidebar-child-item.nested-container",
	"hrms-hide-breadcrumbs",
	"hrms-sidebar-child-hidden",
	"/desk/hr-setup",
]) {
	mustInclude(redirect, marker, `Global shell script must implement: ${marker}`);
}

for (const marker of [
	"Employment Type",
	"工作性质",
	"Full-time",
	"全职",
	"Training Program",
	"培训计划",
	"Masters & Reports",
	"主数据 & 报表",
	"Shift Type",
	"班次类型",
	"Organizational Chart",
	"组织架构",
]) {
	mustInclude(redirect, marker, `Dynamic Chinese localization is missing: ${marker}`);
}

for (const marker of [
	"body.hrms-hide-breadcrumbs",
	".breadcrumb",
	".page-breadcrumbs",
	".hrms-sidebar-child-hidden",
	".hrms-sidebar-section-toggle",
]) {
	mustInclude(topNavCss, marker, `Global shell CSS is missing: ${marker}`);
}

if (!fs.existsSync(pageJsonPath) || !fs.existsSync(pageJsPath)) {
	throw new Error("员工属性设置 must be a real Frappe Page with JSON and JS assets.");
}

const pageJson = JSON.parse(fs.readFileSync(pageJsonPath, "utf8"));
const pageJs = fs.readFileSync(pageJsPath, "utf8");

if (pageJson.name !== "staff-attribute-settings" || pageJson.title !== "员工属性设置") {
	throw new Error("员工属性设置 Page route/title is incorrect.");
}

for (const marker of [
	"frappe.pages[\"staff-attribute-settings\"]",
	"frappe.ui.make_app_page",
	"frappe.ui.Dialog",
	"添加属性字段",
	"员工属性",
	"员工档案材料",
	"自定义设置",
	"在职信息",
	"个人信息",
	"联系信息",
	"工资社保",
	"个税申报",
	"工号",
	"合同公司",
	"工作性质",
	"员工状态",
	"入职日期",
	"离职日期",
	"任职开始日期",
	"奖惩类别",
	"编辑",
	"删除",
	"禁用",
]) {
	mustInclude(pageJs, marker, `员工属性设置 Page is missing template behavior marker: ${marker}`);
}

for (const marker of [
	"/assets/hrms/js/hrms_home_redirect_v6.js?v=20260630f",
	"/assets/hrms/js/hrms_top_nav.js?v=20260630f",
	"/assets/hrms/css/hrms_top_nav.css?v=20260630f",
]) {
	mustInclude(hooks, marker, `Asset version must be bumped for browser cache: ${marker}`);
}

function hasStaffAttributeLink(items) {
	return items.some(
		(item) =>
			item.type === "Link" &&
			item.label === "员工属性设置" &&
			item.link_type === "Page" &&
			item.link_to === "staff-attribute-settings",
	);
}

if (!hasStaffAttributeLink(hrSetup.links)) {
	throw new Error("工作台 workspace must link to 员工属性设置 Page.");
}
if (!hasStaffAttributeLink(personnel.links)) {
	throw new Error("人事 workspace must link to 员工属性设置 Page.");
}
if (!hasStaffAttributeLink(hrSetupSidebar.items)) {
	throw new Error("工作台 sidebar must link to 员工属性设置 Page.");
}
if (!hasStaffAttributeLink(personnelSidebar.items)) {
	throw new Error("人事 sidebar must link to 员工属性设置 Page.");
}

console.log("Global shell and staff attribute template are wired to real Frappe routes.");
