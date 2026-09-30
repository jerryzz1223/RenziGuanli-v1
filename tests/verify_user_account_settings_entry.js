const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const hooksPath = path.join(root, "hrms", "hooks.py");
const redirectPath = path.join(root, "hrms", "public", "js", "hrms_home_redirect_v6.js");
const topNavPath = path.join(root, "hrms", "public", "js", "hrms_top_nav.js");
const topNavCssPath = path.join(root, "hrms", "public", "css", "hrms_top_nav.css");
const personnelWorkspacePath = path.join(root, "hrms", "hr", "workspace", "personnel", "personnel.json");
const personnelSidebarPath = path.join(root, "hrms", "workspace_sidebar", "personnel.json");
const hrSetupWorkspacePath = path.join(root, "hrms", "hr", "workspace", "hr_setup", "hr_setup.json");
const hrSetupSidebarPath = path.join(root, "hrms", "workspace_sidebar", "hr_setup.json");

const hooks = fs.readFileSync(hooksPath, "utf8");
const redirect = fs.readFileSync(redirectPath, "utf8");
const topNav = fs.readFileSync(topNavPath, "utf8");
const topNavCss = fs.readFileSync(topNavCssPath, "utf8");
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
	"账户与权限",
	"退出登录",
	"frappe.set_route(\"Form\", \"User\"",
	"frappe.set_route(\"hrms-access-center\")",
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

for (const obsolete of [
	'{ label: "用户管理", action: "users"',
	'{ label: "角色管理", action: "roles"',
	'{ label: "用户权限", action: "user-permission-list"',
	'data-doctype="User"',
	'data-doctype="Role"',
	'data-doctype="User Permission"',
]) {
	if (topNav.includes(obsolete)) {
		throw new Error(`Duplicate account or role entry must be removed: ${obsolete}`);
	}
}

for (const marker of [
	"hideNativeUserRolePermissionsTab",
	"user-roles_permissions_tab-tab",
	"user-roles_permissions_tab",
	"user-user_details_tab-tab",
	"rolesTab.hidden = true",
	"rolesPanel.hidden = true",
	".form-tabs",
]) {
	const source = topNav;
	mustInclude(source, marker, `Native User role editor must stay hidden: ${marker}`);
}

if (hooks.includes('"User": "public/js/user.js"')) {
	throw new Error("Unused User doctype_js registration must be removed.");
}

if (topNav.includes("/desk/hr-settings-center")) {
	throw new Error("Retired settings center must not appear in navigation.");
}

if (!redirect.includes('route: "/desk/staff-attribute-settings"')) {
	throw new Error("Staff attribute settings must remain available through HR navigation.");
}
for (const source of [
	redirect,
	JSON.stringify(personnelWorkspace),
	JSON.stringify(personnelSidebar),
	JSON.stringify(hrSetupWorkspace),
	JSON.stringify(hrSetupSidebar),
]) {
	if (source.includes("hr-settings-center")) {
		throw new Error("Retired settings center must not remain in navigation or workspaces.");
	}
}

for (const [label, pattern] of [
	["home redirect JS", /\/assets\/hrms\/js\/hrms_home_redirect_v6\.js\?v=\d+[a-z]?/],
	["top nav JS", /\/assets\/hrms\/js\/hrms_top_nav\.js\?v=\d+[a-z]?/],
	["top nav CSS", /\/assets\/hrms\/css\/hrms_top_nav\.css\?v=\d+[a-z]?/],
]) {
	mustMatch(hooks, pattern, `Asset version must be cache-busted for ${label}.`);
}

console.log("User account menu and retired settings route verified.");
