const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const detail = fs.readFileSync(path.join(root, "hrms", "hr", "page", "employee_detail", "employee_detail.js"), "utf8");
const api = fs.readFileSync(path.join(root, "hrms", "api", "employee_field_template.py"), "utf8");
const roster = fs.readFileSync(path.join(root, "hrms", "public", "js", "erpnext", "employee_list.js"), "utf8");
const rosterCss = fs.readFileSync(path.join(root, "hrms", "public", "css", "hrms_top_nav.css"), "utf8");

for (const marker of [
	"data-action=\"upload-photo\"",
	"upload_employee_photo()",
	"frappe.ui.FileUploader",
	'doctype: "Employee"',
	'fieldname: "image"',
	'allowed_file_types: [".jpg", ".jpeg", ".png", ".webp"]',
	"update_employee_photo",
	"员工照片已更新",
	"render_material_attachments()",
	"data-action=\"upload-material\"",
	"upload_employee_material(material_type)",
	"allow_take_photo: true",
	"员工材料已归档",
]) {
	assert(detail.includes(marker), `Employee photo upload UI is missing: ${marker}`);
}

for (const marker of [
	"def update_employee_photo(employee: str, file_url: str):",
	"doc.check_permission(\"write\")",
	"file_doc.check_permission(\"read\")",
	"file_doc.owner != frappe.session.user",
	"Image.open(BytesIO(file_doc.get_content()))",
	"image.verify()",
	'file_doc.attached_to_field != "image"',
	"doc.image = file_doc.file_url",
	"EMPLOYEE_MATERIAL_GROUPS",
	"def _get_employee_materials(doc):",
	"def upload_employee_material(employee: str, material_type: str, file_url: str):",
	'file_doc.db_set("attached_to_field", material["fieldname"])',
]) {
	assert(api.includes(marker), `Employee photo upload API is missing: ${marker}`);
}

for (const marker of [
	"get_roster_employee_name_cell(cells, doc)",
	"prepend_roster_employee_photo(employee_name_cell, doc.image, doc.employee_name)",
	"bind_roster_row_decorations(listview)",
	"listview.after_render = function",
	"checkbox_container.insertAdjacentElement(\"afterend\", photo)",
	"document.createElement(\"img\")",
	"row.querySelectorAll(\".list-row-activity\").forEach((activity) => activity.remove())",
	"append_roster_default_avatar(photo)",
	"max-height:18px",
	"hrms-roster-photo-frame--default",
	"disable_comment_count: true",
	"hrms-roster-employee-name-cell",
	"hrms-roster-photo-frame",
]) {
	assert(roster.includes(marker), `Employee roster photo column is missing: ${marker}`);
}

for (const marker of [
	"border-radius: 50%",
	"height: 18px",
	"width: 18px",
	"object-fit: cover",
	".list-row .list-row-activity",
	".list-row .list-row-modified",
]) {
	assert(rosterCss.includes(marker), `Employee roster photo styling is missing: ${marker}`);
}

console.log("Employee photo upload is wired to validated Employee.image persistence.");
