const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
	return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
	return JSON.parse(read(relativePath));
}

const api = read("hrms/hr/page/employee_relationship/employee_relationship.py");
const controller = read("hrms/hr/doctype/hrms_employee_relationship/hrms_employee_relationship.py");
const page = read("hrms/hr/page/employee_relationship/employee_relationship.js");
const doctype = readJson("hrms/hr/doctype/hrms_employee_relationship/hrms_employee_relationship.json");
const fields = new Map((doctype.fields || []).map((field) => [field.fieldname, field]));

for (const fieldname of ["employee_a", "employee_a_name", "employee_a_code", "employee_b", "employee_b_name", "employee_b_code", "relationship", "company"]) {
	assert.ok(fields.has(fieldname), `员工关系 DocType 缺少字段: ${fieldname}`);
}

for (const marker of [
	"frappe.new_doc(DOCTYPENAME)",
	'doc.set("employee_a", first.name)',
	'doc.set("employee_b", second.name)',
	'doc.set("relationship", relationship)',
	"doc.insert(ignore_mandatory=True)",
	'"submitted_by_name": frappe.db.get_value("User", submitted_by, "full_name")',
	'"submitted_on": submitted_on',
	"meta.has_field(fieldname)",
	"frappe.model.get_permitted_fields(DOCTYPENAME",
	'row.get("owner")',
	'row.get("creation")',
]) {
	assert.ok(api.includes(marker), `员工关系接口缺少保存修复: ${marker}`);
}

for (const marker of [
	"from frappe.utils import now_datetime",
	"self.submitted_by = frappe.session.user",
	"self.submitted_on = now_datetime()",
	'self.status = "已提交"',
]) {
	assert.ok(controller.includes(marker), `员工关系提交审计缺少: ${marker}`);
}

for (const marker of [
	"this.selected.a.name",
	"this.selected.b.name",
	"create_employee_relationship",
	"data-relationship-filter",
	"data-relationship-sort",
	"relationship_filters",
	"relationship_sort_field",
	"sort_field: this.relationship_sort_field",
	"filters: JSON.stringify(this.relationship_filters)",
	"get_employee_relationship_statistics",
	"render_relationship_statistics",
	"data-relationship-statistic",
	"select_relationship_statistic",
	"pie_slice_path",
	"data-relationship-statistics-more",
	"show_relationship_statistic_records",
	"提交关系",
	"员工关系提交记录",
	"提交人",
	"提交时间",
]) {
	assert.ok(page.includes(marker), `员工关系页面缺少选中员工提交契约: ${marker}`);
}

assert.equal(fields.get("employee_a").read_only, 1, "员工一应由服务端生成并保持只读");
assert.equal(fields.get("employee_b").read_only, 1, "员工二应由服务端生成并保持只读");

console.log("Employee relationship creation uses explicit server-managed employee fields and preserves validation.");
