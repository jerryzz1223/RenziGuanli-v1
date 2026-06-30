const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

const apiPath = path.join(root, "hrms", "api", "employee_field_template.py");
const settingsPagePath = path.join(
	root,
	"hrms",
	"hr",
	"page",
	"staff_attribute_settings",
	"staff_attribute_settings.js",
);
const employeeFormPath = path.join(root, "hrms", "public", "js", "erpnext", "employee.js");
const templateJsonPath = path.join(
	root,
	"hrms",
	"hr",
	"doctype",
	"hrms_employee_field_template",
	"hrms_employee_field_template.json",
);
const itemJsonPath = path.join(
	root,
	"hrms",
	"hr",
	"doctype",
	"hrms_employee_field_template_item",
	"hrms_employee_field_template_item.json",
);

function read(file) {
	if (!fs.existsSync(file)) {
		throw new Error(`Missing file: ${path.relative(root, file)}`);
	}
	return fs.readFileSync(file, "utf8");
}

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) {
		throw new Error(message || `Missing marker: ${marker}`);
	}
}

const templateJson = JSON.parse(read(templateJsonPath));
const itemJson = JSON.parse(read(itemJsonPath));
const api = read(apiPath);
const settingsPage = read(settingsPagePath);
const employeeForm = read(employeeFormPath);

if (templateJson.name !== "HRMS Employee Field Template" || templateJson.issingle !== 1) {
	throw new Error("HRMS Employee Field Template must be a Single DocType.");
}

if (itemJson.name !== "HRMS Employee Field Template Item" || itemJson.istable !== 1) {
	throw new Error("HRMS Employee Field Template Item must be a child table DocType.");
}

for (const fieldname of [
	"category",
	"field_label",
	"fieldname",
	"fieldtype",
	"description",
	"source",
	"enabled",
	"search_enabled",
	"options",
	"insert_after",
]) {
	if (!itemJson.fields.some((field) => field.fieldname === fieldname)) {
		throw new Error(`Template item missing field: ${fieldname}`);
	}
}

for (const marker of [
	"@frappe.whitelist()",
	"get_employee_field_template",
	"save_employee_field_template",
	"create_employee_custom_field",
	"set_employee_template_field_enabled",
	"Custom Field",
	"custom_hrms_",
	"EMPLOYEE_TEMPLATE_CATEGORIES",
	"EMPLOYEE_SYSTEM_FIELDS",
]) {
	mustInclude(api, marker, `Employee field template API missing marker: ${marker}`);
}

for (const marker of [
	"hrms.api.employee_field_template.get_employee_field_template",
	"hrms.api.employee_field_template.create_employee_custom_field",
	"hrms.api.employee_field_template.save_employee_field_template",
	"hrms.api.employee_field_template.set_employee_template_field_enabled",
	"保存并继续添加",
	"启用搜索",
	"自定义选项",
]) {
	mustInclude(settingsPage, marker, `员工属性设置 page must call backend template API: ${marker}`);
}

if (settingsPage.includes("category.fields.push([")) {
	throw new Error("员工属性设置 must not mutate only in-memory category.fields.");
}

for (const marker of [
	"apply_employee_field_template",
	"hrms.api.employee_field_template.get_employee_field_template",
	"frm.toggle_display",
	"field.enabled",
	"field.fieldname",
]) {
	mustInclude(employeeForm, marker, `Employee form must apply field template: ${marker}`);
}

console.log("Employee field template contract is wired to real Frappe configuration.");
