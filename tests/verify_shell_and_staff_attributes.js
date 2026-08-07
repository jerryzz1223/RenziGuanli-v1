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
const settingsCenterJsonPath = path.join(root, "hrms", "hr", "page", "hr_settings_center", "hr_settings_center.json");
const settingsCenterJsPath = path.join(root, "hrms", "hr", "page", "hr_settings_center", "hr_settings_center.js");
const topNavJsPath = path.join(root, "hrms", "public", "js", "hrms_top_nav.js");

const redirect = fs.readFileSync(redirectPath, "utf8");
const topNavCss = fs.readFileSync(topNavCssPath, "utf8");
const hooks = fs.readFileSync(hooksPath, "utf8");
const hrSetup = JSON.parse(fs.readFileSync(hrSetupPath, "utf8"));
const hrSetupSidebar = JSON.parse(fs.readFileSync(hrSetupSidebarPath, "utf8"));
const personnel = JSON.parse(fs.readFileSync(personnelPath, "utf8"));
const personnelSidebar = JSON.parse(fs.readFileSync(personnelSidebarPath, "utf8"));
const topNavJs = fs.readFileSync(topNavJsPath, "utf8");

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) {
		throw new Error(message || `Missing marker: ${marker}`);
	}
}

function mustMatch(source, pattern, message) {
	if (!pattern.test(source)) {
		throw new Error(message || `Missing pattern: ${pattern}`);
	}
}

for (const marker of [
	"fix_desk_home_links",
	"hide_frappe_breadcrumbs",
	"enable_sidebar_section_collapse",
	"HRMS_SIDEBAR_MODULES",
	"active_sidebar_module",
	"apply_hrms_sidebar_shell",
	"apply_hrms_shell_rules",
	"render_hrms_sidebar_items",
	"schedule_hrms_localization",
	"should_ignore_hrms_shell_mutation",
	"hrms_expected_route_slug",
	"WORKSPACE_ROUTE_SLUGS",
	"route[0] === \"Workspaces\"",
	"hrms:route-change",
	"toggle_sidebar_section",
	".sidebar-item-container.section-item",
	".sidebar-child-item.nested-container",
	"hrms-hide-breadcrumbs",
	"hrms-sidebar-child-hidden",
	"/desk/hrms-workbench",
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
	"Create User Automatically",
	"自动创建用户",
	"Creates a User account for this employee using the Preferred, Company, or Personal email.",
	"使用首选邮箱、公司邮箱或个人邮箱为该员工自动创建用户账号。",
	"Grade",
	"员工等级",
	"Preferred Contact Email",
	"首选联系邮箱",
	"Holiday List",
	"假期列表",
	"Default Shift",
	"默认班次",
	"Marital Status",
	"婚姻状况",
	"Blood Group",
	"血型",
	"Health Details",
	"健康信息",
	"Health Insurance Provider",
	"医保供应商",
	"Health Insurance No",
	"医保编号",
	"Payroll Cost Center",
	"薪资成本中心",
	"Employee Advance Account",
	"员工预支账户",
	"Auto User Creation Error",
	"自动创建用户错误",
	"Company or Personal Email is mandatory when 'Create User Automatically' is enabled",
	"启用“自动创建用户”时必须填写公司邮箱或个人邮箱",
	"Salary Structure",
	"薪资结构",
	"Salary Structure Assignment",
	"薪资结构分配",
	"Salary Slip",
	"工资单",
	"Salary Withholding",
	"薪资暂扣",
	"Earnings & Deductions",
	"收入与扣款",
	"Earnings",
	"收入项",
	"Deductions",
	"扣款项",
	"Employer Contributions",
	"雇主缴纳项",
	"Flexible Benefits",
	"弹性福利",
	"Condition and Formula Help",
	"条件与公式帮助",
	"Bimonthly",
	"半月",
	"Suspended",
	"停职",
]) {
	mustInclude(redirect, marker, `Dynamic Chinese localization is missing: ${marker}`);
}

for (const marker of [
	"员工花名册",
	"员工档案库",
	"入职管理",
	"转正管理",
	"离职管理",
	"离职面谈",
	"ERPNext设置",
	"授权控制",
]) {
	mustInclude(redirect, marker, `Unified personnel sidebar behavior is missing: ${marker}`);
}

for (const removedLabel of ["员工组", "员工等级", "员工信息"]) {
	if (redirect.includes(`label: "${removedLabel}"`)) {
		throw new Error(`Unified personnel sidebar must not show ${removedLabel}.`);
	}
	if (personnel.links.some((item) => item.label === removedLabel)) {
		throw new Error(`Personnel workspace must not show ${removedLabel}.`);
	}
	if (personnelSidebar.items.some((item) => item.label === removedLabel)) {
		throw new Error(`Personnel sidebar must not show ${removedLabel}.`);
	}
}

for (const marker of [
	"body.hrms-hide-breadcrumbs",
	".breadcrumb",
	".page-breadcrumbs",
	".hrms-sidebar-child-hidden",
	".hrms-sidebar-section-toggle",
	".hrms-unified-sidebar",
	".hrms-unified-sidebar-section",
	".hrms-unified-sidebar-link",
	"body.hrms-module-shell",
	".control-label.reqd::after",
]) {
	mustInclude(topNavCss, marker, `Global shell CSS is missing: ${marker}`);
}

if (!fs.existsSync(pageJsonPath) || !fs.existsSync(pageJsPath)) {
	throw new Error("员工属性设置 must be a real Frappe Page with JSON and JS assets.");
}
if (!fs.existsSync(settingsCenterJsonPath) || !fs.existsSync(settingsCenterJsPath)) {
	throw new Error("设置中心 must be a real Frappe Page with JSON and JS assets.");
}

const pageJson = JSON.parse(fs.readFileSync(pageJsonPath, "utf8"));
const pageJs = fs.readFileSync(pageJsPath, "utf8");
const settingsCenterJson = JSON.parse(fs.readFileSync(settingsCenterJsonPath, "utf8"));
const settingsCenterJs = fs.readFileSync(settingsCenterJsPath, "utf8");

if (pageJson.name !== "staff-attribute-settings" || pageJson.title !== "员工属性设置") {
	throw new Error("员工属性设置 Page route/title is incorrect.");
}
if (settingsCenterJson.name !== "hr-settings-center" || settingsCenterJson.title !== "设置中心") {
	throw new Error("设置中心 Page route/title is incorrect.");
}

for (const marker of [
	"设置中心",
	"/desk/hr-settings-center",
	"hr-settings-center",
]) {
	mustInclude(topNavJs, marker, `Top account menu must expose 设置中心: ${marker}`);
}

for (const marker of [
	"frappe.pages[\"hr-settings-center\"]",
	"字段管理中心",
	"员工属性设置",
	"字段别名配置",
	"导入映射设置",
	"详情资料块设置",
	"导出模板设置",
	"基础资料设置",
	"多行记录类型",
	"hrms.api.employee_field_template.get_hr_settings_center",
	"hrms.api.employee_field_template.save_employee_field_center",
	"aliases",
	"import_enabled",
	"export_enabled",
	"form_visible",
	"detail_visible",
	"detail_block",
	"record_type",
]) {
	mustInclude(settingsCenterJs, marker, `设置中心 Page is missing behavior marker: ${marker}`);
}

for (const marker of [
	"frappe.set_route(\"hr-settings-center\")",
	"员工属性设置已迁移到设置中心",
]) {
	mustInclude(pageJs, marker, `旧员工属性设置入口 must route to 设置中心: ${marker}`);
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

for (const [label, pattern] of [
	["home redirect JS", /\/assets\/hrms\/js\/hrms_home_redirect_v6\.js\?v=\d+[a-z]?/],
	["top nav JS", /\/assets\/hrms\/js\/hrms_top_nav\.js\?v=\d+[a-z]?/],
	["top nav CSS", /\/assets\/hrms\/css\/hrms_top_nav\.css\?v=\d+[a-z]?/],
]) {
	mustMatch(hooks, pattern, `Asset version must be cache-busted for ${label}.`);
}

for (const [label, items] of [
	["工作台 workspace", hrSetup.links],
	["人事 workspace", personnel.links],
	["工作台 sidebar", hrSetupSidebar.items],
	["人事 sidebar", personnelSidebar.items],
]) {
	if (items.some((item) => item.label === "员工属性设置" && item.link_to === "staff-attribute-settings")) {
		throw new Error(`${label} must not expose 员工属性设置 directly; use 设置中心 instead.`);
	}
}

console.log("Global shell and staff attribute template are wired to real Frappe routes.");
