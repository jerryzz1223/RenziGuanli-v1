const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const hooksPath = path.join(root, "hrms", "hooks.py");
const redirectPath = path.join(root, "hrms", "public", "js", "hrms_home_redirect_v6.js");
const topNavPath = path.join(root, "hrms", "public", "js", "hrms_top_nav.js");
const topNavCssPath = path.join(root, "hrms", "public", "css", "hrms_top_nav.css");
const homePagePath = path.join(root, "hrms", "hr", "page", "hrms_workbench", "hrms_workbench.json");
const workbenchPath = path.join(root, "hrms", "hr", "workspace", "hr_setup", "hr_setup.json");
const workbenchSidebarPath = path.join(root, "hrms", "workspace_sidebar", "hr_setup.json");
const personnelPath = path.join(root, "hrms", "hr", "workspace", "personnel", "personnel.json");
const personnelSidebarPath = path.join(root, "hrms", "workspace_sidebar", "personnel.json");

const hooksSource = fs.readFileSync(hooksPath, "utf8");
const redirectSource = fs.readFileSync(redirectPath, "utf8");
const topNavSource = fs.readFileSync(topNavPath, "utf8");
const topNavCssSource = fs.readFileSync(topNavCssPath, "utf8");
const homePage = JSON.parse(fs.readFileSync(homePagePath, "utf8"));
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

if (!hooksSource.includes("/assets/hrms/css/hrms_top_nav.css?v=20260827d")) {
	throw new Error("The top navigation CSS cache version must change when its desktop layout is corrected.");
}

for (const marker of [".navbar .search-wrapper", ".navbar .btn-primary", "input.closest(\"form, .input-group, .form-group, .search, .search-bar\")"]) {
	if (!topNavSource.includes(marker)) {
		throw new Error(`Top navigation must remove the current Frappe global search and primary New control: ${marker}`);
	}
}

if (topNavCssSource.includes("body.hrms-module-shell > .main-section {\n\t\t/* Reserve the drawer") && topNavCssSource.includes("width: calc(100% - 300px);")) {
	throw new Error("The fixed navigation drawer must not calculate the main section width in addition to its margin.");
}

for (const marker of ["@media (max-width: 767px)", "position: fixed;", "transform: translateX(-105%)"]) {
	if (!topNavCssSource.includes(marker)) {
		throw new Error(`Small-screen sidebar must overlay the page, missing marker: ${marker}`);
	}
}

for (const marker of ["主页", "人事", "/desk/hrms-workbench", "/desk/employee", "/desk/department", "/desk/attendance-import-center", "/desk/payroll-input-center", "aria-expanded", "bindMoreDocumentEvents", "closeMoreMenus"]) {
	if (!topNavSource.includes(marker)) {
		throw new Error(`Top navigation is missing marker: ${marker}`);
	}
}

for (const marker of ["yongxin-brand-mark-red.png", "Navbar Settings", "MODULE_ICONS", "hrms-top-module-nav__brand-logo", "hrms-top-module-nav__brand-company", "loadBrandLogo", "decoratePageTitle"]) {
	if (!topNavSource.includes(marker)) {
		throw new Error(`Top navigation branding or module icons are missing marker: ${marker}`);
	}
}

for (const marker of ["hrms-top-module-nav__brand-logo", "hrms-top-module-nav__brand-company", "hrms-top-module-nav__item-icon", "hrms-page-title-icon"]) {
	if (!topNavCssSource.includes(marker)) {
		throw new Error(`Top navigation icon CSS is missing marker: ${marker}`);
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
	'label: "部门"',
	'label: "考勤假期"',
	'label: "薪酬"',
	'keys: ["department", "organizational-chart", "organization-report"]',
	'route[0] === "organizational-chart" && route[1] === "report"',
	'normalized === "organizational-chart/report"',
	"var item_slug = item.slug || route_to_slug(item.route);",
	'"attendance-import-center"',
	'"payroll-input-center"',
]) {
	if (!redirectSource.includes(marker)) {
		throw new Error(`Global shell sidebar must switch by top module, missing marker: ${marker}`);
	}
}

if (redirectSource.includes("route_to_slug(item.route) === active_slug")) {
	throw new Error("Department sidebar items must use their explicit slugs so chart and report cannot be selected together.");
}

for (const forbidden of [
	'{ label: "公司", route: "/desk/company", slug: "company" }',
	'{ label: "分支机构", route: "/desk/branch", slug: "branch" }',
	'{ label: "岗位", route: "/desk/designation", slug: "designation" }',
	'{ label: "职级", route: "/desk/employee-grade", slug: "employee-grade" }',
	'keys: ["company", "branch", "department", "designation", "employee-grade", "organizational-chart", "organization-report"]',
]) {
	if (redirectSource.includes(forbidden) || topNavSource.includes(forbidden)) {
		throw new Error(`Organization module must be customized to Yongxin-only organization management: ${forbidden}`);
	}
}

if (redirectSource.includes("ensure_personnel_pages") || topNavSource.includes("ensure_personnel_pages")) {
	throw new Error("Navigation must not run database page registration; deployment migrations own that work.");
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

if (!topNavCssSource.includes("width: 117.6470588235vw !important")) {
	throw new Error("Desktop-density mode must compensate the fixed top nav width so company and account controls stay at the top-right edge.");
}

if (homePage.title !== "人资主页") {
	throw new Error(`The integrated home page title should be 人资主页, got ${homePage.title}`);
}

if (workbench.is_hidden !== 1 || workbench.content !== "[]") {
	throw new Error("The retired HR Setup workspace must be hidden and empty.");
}

if (!redirectSource.includes("redirect_legacy_home_workspace")) {
	throw new Error("Legacy HR Setup workspace links must redirect to the integrated home page.");
}

const sidebarShellStart = redirectSource.indexOf("function apply_hrms_sidebar_shell()");
const sidebarShellEnd = redirectSource.indexOf("\n\tfunction hide_frappe_breadcrumbs()", sidebarShellStart);
const sidebarShell = redirectSource.slice(sidebarShellStart, sidebarShellEnd);
if (!sidebarShell.includes("get_hrms_top_drawer") || !sidebarShell.includes("render_hrms_sidebar_items")) {
	throw new Error("The top-bar drawer must render its contextual navigation items.");
}

if (!topNavSource.includes("nav.appendChild(renderSidebarToggle())")) {
	throw new Error("The top navigation must mount the drawer toggle.");
}

if (!topNavCssSource.includes(".hrms-top-drawer") || !topNavCssSource.includes("body.hrms-custom-drawer-active > .body-sidebar-container") || !topNavCssSource.includes("body.hrms-custom-drawer-active.hrms-custom-drawer-open > .main-section") || !topNavCssSource.includes("width: calc(100vw - 300px) !important")) {
	throw new Error("The custom drawer must hide the native sidebar and reserve space instead of covering the current page.");
}

if (!topNavCssSource.includes("body.hrms-custom-drawer-active:not(.hrms-custom-drawer-open) > .main-section") || !topNavCssSource.includes("margin-left: 16px !important")) {
	throw new Error("A closed custom drawer must retain a small left gutter for page content.");
}

if (personnel.is_hidden !== 1 || personnel.content !== "[]") {
	throw new Error("The retired Personnel workspace must be hidden and empty.");
}

if (personnelSidebar.items.some((item) => item.type === "Link" && item.label === "主页")) {
	throw new Error("Personnel sidebar must not show a home link.");
}

if (!personnelSidebar.items.some((item) => item.type === "Link" && item.label === "员工花名册" && item.link_to === "Employee")) {
	throw new Error("Personnel sidebar must retain the employee roster entry.");
}

console.log("HRMS home page and retired workspaces use the expected routes.");
