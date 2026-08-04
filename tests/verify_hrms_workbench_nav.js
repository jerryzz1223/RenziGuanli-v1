const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const hooksPath = path.join(root, "hrms", "hooks.py");
const redirectPath = path.join(root, "hrms", "public", "js", "hrms_home_redirect_v6.js");
const topNavPath = path.join(root, "hrms", "public", "js", "hrms_top_nav.js");
const topNavCssPath = path.join(root, "hrms", "public", "css", "hrms_top_nav.css");
const workbenchPath = path.join(root, "hrms", "hr", "workspace", "hr_setup", "hr_setup.json");
const workbenchSidebarPath = path.join(root, "hrms", "workspace_sidebar", "hr_setup.json");
const personnelPath = path.join(root, "hrms", "hr", "workspace", "personnel", "personnel.json");
const personnelSidebarPath = path.join(root, "hrms", "workspace_sidebar", "personnel.json");

const hooksSource = fs.readFileSync(hooksPath, "utf8");
const redirectSource = fs.readFileSync(redirectPath, "utf8");
const topNavSource = fs.readFileSync(topNavPath, "utf8");
const topNavCssSource = fs.readFileSync(topNavCssPath, "utf8");
const workbench = JSON.parse(fs.readFileSync(workbenchPath, "utf8"));
const workbenchSidebar = JSON.parse(fs.readFileSync(workbenchSidebarPath, "utf8"));
const personnel = JSON.parse(fs.readFileSync(personnelPath, "utf8"));
const personnelSidebar = JSON.parse(fs.readFileSync(personnelSidebarPath, "utf8"));

for (const marker of ['app_home = "/desk/hrms-workbench"', '"route": "/desk/hrms-workbench"']) {
	if (!hooksSource.includes(marker)) {
		throw new Error(`HRMS app entry must point to the unified workbench page: ${marker}`);
	}
}

for (const forbiddenRoute of ["/desk/hrms-workbench/people", "/desk/hrms-workbench/attendance", "/desk/hrms-workbench/payroll"]) {
	if (topNavSource.includes(forbiddenRoute)) {
		throw new Error(`Top navigation must not route modules into nested workbench pages: ${forbiddenRoute}`);
	}
}

for (const marker of ["/assets/hrms/js/hrms_top_nav.js", "/assets/hrms/css/hrms_top_nav.css"]) {
	if (!hooksSource.includes(marker)) {
		throw new Error(`hooks.py must include the Frappe-style module nav asset: ${marker}`);
	}
}

for (const marker of ["工作台", "人事", "/desk/hrms-workbench", "/desk/personnel", "/desk/department", "/desk/attendance-import-center", "/desk/payroll-input-center", "aria-expanded", "bindMoreDocumentEvents", "closeMoreMenus"]) {
	if (!topNavSource.includes(marker)) {
		throw new Error(`Top navigation is missing marker: ${marker}`);
	}
}

for (const marker of ['label: "社保个税"', 'label: "电子合同（未开放）"', 'action: "data-operations"', 'hrms-top-module-nav__more-caret', 'hrms-top-module-nav__menu-list', 'function positionMenu()']) {
	if (!topNavSource.includes(marker)) {
		throw new Error(`More/account navigation is missing marker: ${marker}`);
	}
}

if (!topNavCssSource.includes(".hrms-top-module-nav__more.is-open .hrms-top-module-nav__menu")) {
	throw new Error("More menu must support an explicit click-open state, not hover only.");
}

for (const marker of [
	"HRMS_SIDEBAR_MODULES",
	"active_sidebar_module",
	"render_hrms_sidebar_items",
	"apply_hrms_sidebar_shell",
	"apply_hrms_shell_rules",
	"bind_hrms_shell_route_events",
	"schedule_hrms_ui_rules",
	"schedule_hrms_localization",
	"should_ignore_hrms_shell_mutation",
	".hrms-unified-sidebar, #hrms-top-module-nav",
	"hrms_expected_route_slug",
	"announce_hrms_route_change",
	"WORKSPACE_ROUTE_SLUGS",
	"route[0] === \"Workspaces\"",
	"hrms_shell_ui_timer",
	"schedule_hrms_ui_rules(120)",
	"hrms:route-change",
	"frappe.router.on(\"change\"",
	"HRMS_ENSURED_PAGE_SLUGS",
	'label: "组织"',
	'label: "考勤假期"',
	'label: "薪酬"',
	'keys: ["department", "organizational-chart", "staffing-plan"]',
	'"attendance-import-center"',
	'"payroll-input-center"',
]) {
	if (!redirectSource.includes(marker)) {
		throw new Error(`Global shell sidebar must switch by top module, missing marker: ${marker}`);
	}
}

for (const forbidden of [
	'{ label: "公司", route: "/desk/company", slug: "company" }',
	'{ label: "分支机构", route: "/desk/branch", slug: "branch" }',
	'{ label: "岗位", route: "/desk/designation", slug: "designation" }',
	'{ label: "职级", route: "/desk/employee-grade", slug: "employee-grade" }',
	'keys: ["company", "branch", "department", "designation", "employee-grade", "organizational-chart", "staffing-plan"]',
]) {
	if (redirectSource.includes(forbidden) || topNavSource.includes(forbidden)) {
		throw new Error(`Organization module must be customized to Yongxin-only organization management: ${forbidden}`);
	}
}

const ensuredPagesMatch = redirectSource.match(/HRMS_ENSURED_PAGE_SLUGS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
if (!ensuredPagesMatch || !ensuredPagesMatch[1].includes('"attendance-import-center"')) {
	throw new Error("Attendance import center must be ensured before sidebar navigation.");
}

if (redirectSource.includes("apply_personnel_sidebar_shell()")) {
	throw new Error("Global shell must not keep applying the fixed personnel sidebar.");
}

const workbenchJs = fs.readFileSync(path.join(root, "hrms", "hr", "page", "hrms_workbench", "hrms_workbench.js"), "utf8");
for (const forbiddenMarker of ["hrms-workbench-topnav", "data-module=", "set_module(module_key)", "frappe.set_route(\"hrms-workbench\", module_key)"]) {
	if (workbenchJs.includes(forbiddenMarker)) {
		throw new Error(`Workbench page must not render nested module navigation: ${forbiddenMarker}`);
	}
}

if (topNavCssSource.includes("#057a55") || topNavCssSource.includes("color: #fff")) {
	throw new Error("Top navigation must use the neutral Frappe style, not the old green copied style.");
}

if (!topNavCssSource.includes("var(--fg-color") || !topNavCssSource.includes("var(--primary")) {
	throw new Error("Top navigation should be styled with Frappe theme variables.");
}

for (const marker of ["position: fixed", "width: 100vw", "body:has(#hrms-top-module-nav)", "height: calc(100vh - 46px)"]) {
	if (!topNavCssSource.includes(marker)) {
		throw new Error(`Top navigation layout CSS is missing marker: ${marker}`);
	}
}

if (workbench.title !== "工作台") {
	throw new Error(`Workbench title should be 工作台, got ${workbench.title}`);
}

for (const label of ["快捷入口", "今日事项", "人事提醒", "人事概况", "常用报表"]) {
	if (!workbench.links.some((link) => link.type === "Card Break" && link.label === label)) {
		throw new Error(`Workbench is missing card group: ${label}`);
	}
}

if (!workbenchSidebar.items.some((item) => item.type === "Link" && item.label === "人事" && item.link_to === "Personnel")) {
	throw new Error("Workbench sidebar must link to the Personnel workspace.");
}

if (personnel.title !== "人事") {
	throw new Error(`Personnel workspace title should be 人事, got ${personnel.title}`);
}

for (const label of ["员工管理", "员工关系"]) {
	if (!personnel.links.some((link) => link.type === "Card Break" && link.label === label)) {
		throw new Error(`Personnel workspace is missing card group: ${label}`);
	}
	if (!personnelSidebar.items.some((item) => item.type === "Section Break" && item.label === label)) {
		throw new Error(`Personnel sidebar is missing collapsible section: ${label}`);
	}
}

for (const [label, linkTo, linkType] of [
	["员工花名册", "Employee", "DocType"],
	["员工档案库", "employee-archive", "Page"],
	["入职管理", "Employee Onboarding", "DocType"],
	["转正管理", "Employee Promotion", "DocType"],
	["离职管理", "Employee Separation", "DocType"],
	["人事异动", "Employee Transfer", "DocType"],
]) {
	if (!personnel.links.some((link) => link.type === "Link" && link.label === label && link.link_to === linkTo && link.link_type === linkType)) {
		throw new Error(`Personnel workspace has no real route for ${label} -> ${linkType}:${linkTo}`);
	}
	if (!personnelSidebar.items.some((item) => item.type === "Link" && item.label === label && item.link_to === linkTo && item.link_type === linkType)) {
		throw new Error(`Personnel sidebar has no real route for ${label} -> ${linkType}:${linkTo}`);
	}
}

console.log("HRMS workbench and Personnel workspace use native Frappe routes.");
