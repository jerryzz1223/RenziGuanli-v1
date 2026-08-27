const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const hooksPath = path.join(root, "hrms", "hooks.py");
const redirectPath = path.join(root, "hrms", "public", "js", "hrms_home_redirect_v6.js");
const topNavPath = path.join(root, "hrms", "public", "js", "hrms_top_nav.js");
const topNavCssPath = path.join(root, "hrms", "public", "css", "hrms_top_nav.css");
const settingsCenterPath = path.join(root, "hrms", "hr", "page", "hr_settings_center", "hr_settings_center.js");
const personnelWorkspacePath = path.join(root, "hrms", "hr", "workspace", "personnel", "personnel.json");
const personnelSidebarPath = path.join(root, "hrms", "workspace_sidebar", "personnel.json");
const hrSetupWorkspacePath = path.join(root, "hrms", "hr", "workspace", "hr_setup", "hr_setup.json");
const hrSetupSidebarPath = path.join(root, "hrms", "workspace_sidebar", "hr_setup.json");

const hooks = fs.readFileSync(hooksPath, "utf8");
const redirect = fs.readFileSync(redirectPath, "utf8");
const topNav = fs.readFileSync(topNavPath, "utf8");
const topNavCss = fs.readFileSync(topNavCssPath, "utf8");
const settingsCenter = fs.readFileSync(settingsCenterPath, "utf8");
const personnelWorkspace = JSON.parse(fs.readFileSync(personnelWorkspacePath, "utf8"));
const personnelSidebar = JSON.parse(fs.readFileSync(personnelSidebarPath, "utf8"));
const hrSetupWorkspace = JSON.parse(fs.readFileSync(hrSetupWorkspacePath, "utf8"));
const hrSetupSidebar = JSON.parse(fs.readFileSync(hrSetupSidebarPath, "utf8"));

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
	"ACCOUNT_ID",
	"renderAccountMenu",
	"loadCurrentUser",
	"const requestedUser = currentUserId()",
	"currentUserId() !== requestedUser",
	"window.frappe?.boot?.user?.name",
	"window.setTimeout(scheduleRender, 150)",
	"hrms.api.get_current_user_info",
	"个人资料",
	"修改密码",
	"用户与权限",
	"设置中心",
	"退出登录",
	"frappe.set_route(\"Form\", \"User\"",
	"frappe.set_route(\"List\", \"User\")",
	"frappe.set_route(\"List\", \"Role\")",
	"frappe.set_route(\"List\", \"User Permission\")",
	"frappe.app.logout",
]) {
	mustInclude(topNav, marker, `Top account menu must implement ${marker}`);
}

for (const marker of [
	".hrms-account-menu",
	".hrms-account-menu__trigger",
	".hrms-account-menu__avatar",
	".hrms-account-menu__dropdown",
	".hrms-account-menu__item",
]) {
	mustInclude(topNavCss, marker, `Account menu CSS is missing ${marker}`);
}

for (const marker of [
	"用户与权限",
	"用户管理",
	"创建用户",
	"角色管理",
	"用户权限",
	"角色权限管理",
	"User",
	"Role",
	"User Permission",
]) {
	mustInclude(settingsCenter, marker, `Settings center must expose user permission management: ${marker}`);
}

const moreItemsMatch = topNav.match(/const\s+moreItems\s*=\s*\[([\s\S]*?)\];/);
if (moreItemsMatch && moreItemsMatch[1].includes("设置中心")) {
	throw new Error("设置中心 must live in the account menu, not the top 更多 menu.");
}

for (const [label, source] of [
	["人事侧栏脚本", redirect],
	["人事 Workspace", JSON.stringify(personnelWorkspace)],
	["人事 Workspace Sidebar", JSON.stringify(personnelSidebar)],
	["工作台 Workspace", JSON.stringify(hrSetupWorkspace)],
	["工作台 Workspace Sidebar", JSON.stringify(hrSetupSidebar)],
]) {
	if (source.includes('"label":"员工属性设置"') || source.includes('"label": "员工属性设置"') || source.includes('label: "员工属性设置"')) {
		throw new Error(`${label} must not expose 员工属性设置 as a left/workspace entry.`);
	}
}

for (const [label, pattern] of [
	["home redirect JS", /\/assets\/hrms\/js\/hrms_home_redirect_v6\.js\?v=\d+[a-z]?/],
	["top nav JS", /\/assets\/hrms\/js\/hrms_top_nav\.js\?v=\d+[a-z]?/],
	["top nav CSS", /\/assets\/hrms\/css\/hrms_top_nav\.css\?v=\d+[a-z]?/],
]) {
	mustMatch(hooks, pattern, `Asset version must be cache-busted for ${label}.`);
}

console.log("User account menu and settings center permissions entry are wired.");
