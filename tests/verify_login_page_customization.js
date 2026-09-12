const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

const hooks = read("hrms/hooks.py");
const setup = read("hrms/setup.py");
const branding = read("hrms/branding.py");
const accessControl = read("hrms/access_control.py");
const loginJs = read("hrms/public/js/hrms_login.js");
const loginCss = read("hrms/public/css/hrms_login.css");
const blankBrand = read("hrms/public/images/blank-brand.svg");

assert(hooks.includes("/assets/hrms/css/hrms_login.css?v="), "Login CSS must be registered and cache-busted.");
assert(hooks.includes("/assets/hrms/js/hrms_login.js?v="), "Login JS must be registered and cache-busted.");
assert(setup.includes("apply_login_page_customizations()"), "Login settings must be applied during migration.");
assert(branding.includes('"allow_login_using_user_name": 1'), "Username login must be enabled.");
assert(branding.includes('"login_with_email_link": 0'), "Email-link login must be disabled.");
assert(branding.includes('"favicon": BLANK_BRAND_ASSET'), "The Frappe favicon must be replaced.");
assert(loginJs.includes('usernameLabel.textContent = "用户名"'), "The login label must say 用户名.");
assert(loginJs.includes('passwordLabel.textContent = "密码"'), "The password label must say 密码.");
assert(loginJs.includes('loginButton.textContent = "登录"'), "The submit action must say 登录.");
assert(loginJs.includes('username.placeholder = ""'), "The username example must be removed.");
assert(loginJs.includes('password.placeholder = ""'), "The password placeholder must be removed.");
assert(loginCss.includes(".page-card-head > .app-logo"), "The login-page logo must be hidden.");
assert(loginCss.includes(".btn-login-with-email-link"), "The email-link option must be hidden before migration.");
assert(loginCss.includes(".login-content.page-card:has(.for-login) { visibility: hidden; }"), "The original Frappe login card must not flash before customization.");
assert(loginCss.includes("body.hrms-login-ready"), "The customized login must become visible only after initialization.");
assert(loginJs.includes("installReadOnlyRegistration"), "The login page must expose read-only account registration.");
assert(loginJs.includes("hrms.access_control.register_read_only_account"), "Registration must call the controlled backend endpoint.");
assert(loginJs.includes('name="employee_code"'), "Registration must keep the company employee code optional.");
assert(loginJs.includes("hrms.access_control.preview_registration_employee"), "Employee code must preview a non-sensitive roster match.");
assert(loginJs.includes("employee_code: values.employee_code"), "Registration must submit the employee code for server-side linking.");
assert(accessControl.includes("@frappe.whitelist(allow_guest=True)"), "The registration endpoint must be callable before login.");
assert(accessControl.includes("@rate_limit(limit=5, seconds=3600)"), "Public registration must be rate limited.");
assert(accessControl.includes('READ_ONLY_ROLE = "HRMS 基础只读"'), "New accounts must receive the dedicated baseline role.");
assert(accessControl.includes('EMPLOYEE_SELF_SERVICE_ROLE = "Employee Self Service"'), "Matched employees must receive the existing self-service role.");
assert(accessControl.includes('frappe.db.set_value("Employee", employee.get("name"), "user_id", email)'), "Matched registration must link the User to the exact Employee record.");
assert(accessControl.includes('"doctype": "User Permission"'), "Matched registration must create an Employee data-scope permission.");
assert(accessControl.includes('"for_value": employee.get("name")'), "Employee data scope must point to the matched roster record only.");
const readOnlyDoctypes = accessControl.slice(
	accessControl.indexOf("READ_ONLY_DOCTYPES = ("),
	accessControl.indexOf("CAPABILITY_DEFINITIONS = ("),
);
assert(!readOnlyDoctypes.includes('"Employee"'), "Unmatched public registration must not grant employee-record read access.");
assert(blankBrand.includes('fill-opacity="0"'), "The replacement favicon must be visually blank.");

console.log("Login page branding and username/password customization are wired.");
