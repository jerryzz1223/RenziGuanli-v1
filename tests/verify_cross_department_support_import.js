const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "hrms/hr/doctype/cross_department_support_capability/cross_department_support_capability.py"), "utf8");
const page = fs.readFileSync(path.join(root, "hrms/hr/page/cross_department_support/cross_department_support.js"), "utf8");
const form = fs.readFileSync(path.join(root, "hrms/hr/doctype/cross_department_support_capability/cross_department_support_capability.js"), "utf8");
const shell = fs.readFileSync(path.join(root, "hrms/public/js/hrms_home_redirect_v6.js"), "utf8");
const schema = JSON.parse(fs.readFileSync(path.join(root, "hrms/hr/doctype/cross_department_support_capability/cross_department_support_capability.json"), "utf8"));

const fields = Object.fromEntries(schema.fields.map((field) => [field.fieldname, field]));
assert.strictEqual(fields.employee.reqd, undefined, "Unmatched employees must be importable as review records");
assert.strictEqual(fields.support_department.reqd, undefined, "Incomplete support departments must be reviewable after import");
assert.strictEqual(fields.support_designation.reqd, undefined, "Incomplete support designations must be reviewable after import");
assert(fields.import_validation_note && fields.import_validation_note.read_only, "Imported exception reason must be retained in the ledger");

for (const marker of [
	'"can_import": bool(rows)',
	'"qualification_status": "待复核" if needs_review',
	'"is_active": 0 if needs_review',
	'"import_validation_note"',
	"启用支援能力前请补齐",
	'frappe.db.get_value("Employee", row.get("employee"), "department")',
	'"source_department": source_department or None',
	'"Excel 原部门：{0}"',
	"def _safe_import_date",
	"doc.insert(ignore_mandatory=True, ignore_links=True)",
]) {
	assert(api.includes(marker), `Missing partial-import safeguard: ${marker}`);
}

for (const marker of ["异常行会导入", "导入并保留异常", "待复核记录"]) {
	assert(page.includes(marker), `Missing import-review UI guidance: ${marker}`);
}
assert(page.includes('fieldname: "include_unavailable"') && page.includes("default: 1"), "The query page must show imported review records by default");
assert(page.includes("frappe.ui.form.make_control"), "Query controls must be created in their own filter containers");
assert(!page.includes("this.page.add_field"), "Page-header controls must not be moved into the query grid");
assert(page.includes('set_primary_action(__("新建支援")'), "The primary action must be labelled 新建支援");
assert(!page.includes("set_secondary_action") && !page.includes("维护台账"), "The maintenance-ledger entry point must not be shown");
assert.strictEqual(fields.support_department.fieldtype, "Link", "Support departments must open the Department picker");
assert.strictEqual(fields.support_department.options, "Department", "Support departments must use the Department picker");
assert.strictEqual(fields.support_designation.fieldtype, "Link", "Support designations must open the Designation picker");
assert(form.includes('frm.page.set_title(__("新建支援"))'), "The new form title must be 新建支援");
for (const fieldname of ["qualified_on", "valid_from", "valid_until", "remarks"]) {
	assert(form.includes(`"${fieldname}"`), `The unnecessary form field ${fieldname} must be hidden`);
}
assert(shell.includes('"cross-department-support-capability"'), "The support form route must use the custom HR drawer");

console.log("cross department support partial import contract passed");
