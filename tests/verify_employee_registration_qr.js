const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const api = fs.readFileSync(path.join(root, "hrms/hr/doctype/hrms_employee_registration/hrms_employee_registration.py"), "utf8");
const doctype = JSON.parse(fs.readFileSync(path.join(root, "hrms/hr/doctype/hrms_employee_registration/hrms_employee_registration.json"), "utf8"));
const desk = fs.readFileSync(path.join(root, "hrms/public/js/erpnext/employee_list.js"), "utf8");
const entry = fs.readFileSync(path.join(root, "hrms/public/js/hrms_employee_registration_entry.js"), "utf8");
const html = fs.readFileSync(path.join(root, "hrms/www/employee-registration.html"), "utf8");
const hooks = fs.readFileSync(path.join(root, "hrms/hooks.py"), "utf8");

assert.equal(doctype.name, "HRMS Employee Registration");
assert.equal(doctype.permissions.some((item) => item.role === "HR Manager" && item.read && item.write), true);
for (const fieldname of [
	"employee_name", "employee_code", "company", "department", "designation", "passport_number", "custom_ethnicity",
	"custom_native_place", "custom_work_nature", "custom_education_level", "bank_ac_no", "employee_photo",
	"id_card_front", "id_card_back", "household_register", "bank_card_photo", "declaration_accepted", "token_hash", "token_secret",
]) {
	assert(doctype.fields.some((field) => field.fieldname === fieldname), `missing registration field: ${fieldname}`);
}
for (const marker of [
	"@frappe.whitelist(allow_guest=True)",
	"def get_public_registration",
	"def get_public_designations",
	"def submit_public_registration",
	"def create_registration_link",
	"def approve_registration",
	"def reject_registration",
	"token_hash",
	"token_secret",
	"_make_qr_svg",
	'"is_private": 1',
]) assert(api.includes(marker), `missing registration API marker: ${marker}`);
for (const marker of ["员工扫码填写", "window.location.origin", "create_registration_link", "get_registration_qr_svg", "open_employee_registration_link({ direct: true })", "手动填写", "hrms-registration-manual-entry"]) {
	assert(desk.includes(marker), `missing desk QR marker: ${marker}`);
}
for (const marker of ["添加员工", "stopImmediatePropagation", "hrms-registration-manual-entry", "create_registration_link"]) {
	assert(entry.includes(marker), `missing direct QR entry marker: ${marker}`);
}
for (const marker of ["/api/method/", "submit_public_registration", "required_attachments", "get_public_designations", "loadDesignations", "正在加载岗位", "FileReader", "employee_code", "X-Frappe-CSRF-Token"]) {
	assert(html.includes(marker), `missing public form marker: ${marker}`);
}
assert(html.includes("registration-form"), "missing mobile registration form");
assert(hooks.includes('"HRMS Employee Registration": "public/js/hrms_employee_registration.js"'), "missing doctype JS hook");
console.log("employee QR registration contract verified");
