const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "hrms/www/employee-registration.html"), "utf8");
const api = fs.readFileSync(path.join(root, "hrms/hr/doctype/hrms_employee_registration/hrms_employee_registration.py"), "utf8");
const hooks = fs.readFileSync(path.join(root, "hrms/hooks.py"), "utf8");

for (const marker of [
	"data-token=",
	"custom_native_place",
	"常熟市、苏州市或江苏省",
	"submit_public_registration",
	"X-Frappe-CSRF-Token",
]) {
	if (!page.includes(marker)) throw new Error(`Missing QR registration page marker: ${marker}`);
}
for (const marker of [
	"normalise_profile_value",
	"business_departments",
	"组是组织内分组",
	"profile_options",
	"return {\"svg\":",
	"token_hash",
]) {
	if (!api.includes(marker)) throw new Error(`Missing QR registration API marker: ${marker}`);
}
if (!page.includes("部门/课别")) throw new Error("员工填写页必须明确选择部门/课别。");
if (!hooks.includes('"HRMS Employee Registration": "public/js/hrms_employee_registration.js"')) {
	throw new Error("Employee registration doctype script is not registered.");
}
console.log("Employee registration QR page contract passed.");
