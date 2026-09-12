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
	"头像历史记录",
	"data-action=\"view-photo-history\"",
	"data-action=\"view-material-history\"",
	"show_upload_history(title, current_file, history_files)",
	"当前使用",
	"历史版本",
	"render_material_attachments()",
	"data-action=\"upload-material\"",
	"upload_employee_material(material_type)",
	"allow_take_photo: true",
	"员工材料已归档",
	"data-action=\"preview-material-image\"",
	"preview_employee_material_image(file_url, file_name)",
	"data-action=\"delete-material\"",
	"delete_employee_material(file_name, display_name)",
	"hrms-employee-material-preview",
	"hrms-employee-material-preview-dialog",
	"width: calc(100vw - 48px)",
	"height: calc(100vh - 48px)",
	"data-action=\"material-image-zoom-in\"",
	"data-action=\"material-image-zoom-out\"",
	"data-action=\"material-image-zoom-reset\"",
	"const set_zoom = (next_zoom)",
	"员工材料已删除",
]) {
	assert(detail.includes(marker), `Employee photo upload UI is missing: ${marker}`);
}

assert(
	!detail.includes('files.length ? files.map((file) => this.render_material_file(file)).join("")'),
	"The material landing page must not expose every historical upload inline.",
);

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
	"def _get_employee_photo_history(doc):",
	'"photo_history": _get_employee_photo_history(doc)',
	'"current_file":',
	'"history_files":',
	"def _get_employee_materials(doc):",
	"def upload_employee_material(employee: str, material_type: str, file_url: str):",
	'file_doc.db_set("attached_to_field", material["fieldname"])',
	"def delete_employee_material(employee: str, file_name: str):",
	'file_doc.check_permission("delete")',
	'frappe.delete_doc("File", file_doc.name)',
	"当前仅支持删除员工材料中的图片",
]) {
	assert(api.includes(marker), `Employee photo upload API is missing: ${marker}`);
}

for (const marker of [
	"get_roster_employee_name_cell(cells, doc)",
	"prepend_roster_employee_photo(employee_name_cell, doc.image, doc.employee_name)",
	"create_roster_employee_photo(employee.image, employee.employee_name)",
	"hrms-roster-employee-name-cell",
	"align-items:center;display:flex;gap:8px;white-space:normal;",
	'!row.classList.contains("list-row-head")',
	'cell.dataset.fieldname === "name"',
	'(cell.textContent || "").includes(employee_name)',
	"bind_roster_row_decorations(listview)",
	"listview.after_render = function",
	"checkbox_container.insertAdjacentElement(\"afterend\", photo)",
	"document.createElement(\"img\")",
	"row.querySelectorAll(\".list-row-activity\").forEach((activity) => activity.remove())",
	"append_roster_default_avatar(photo)",
	"max-height:28px",
	"hrms-roster-photo-frame--default",
	"disable_comment_count: true",
	"hrms-roster-employee-name-cell",
	"hrms-roster-photo-frame",
]) {
	assert(roster.includes(marker), `Employee roster photo column is missing: ${marker}`);
}

for (const marker of [
	"border-radius: 50%",
	"height: 28px",
	"width: 28px",
	"object-fit: cover",
	".list-row .list-row-activity",
	".list-row .list-row-modified",
]) {
	assert(rosterCss.includes(marker), `Employee roster photo styling is missing: ${marker}`);
}

console.log("Employee photo upload is wired to validated Employee.image persistence.");
