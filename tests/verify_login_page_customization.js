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
assert(blankBrand.includes('fill-opacity="0"'), "The replacement favicon must be visually blank.");

console.log("Login page branding and username/password customization are wired.");
