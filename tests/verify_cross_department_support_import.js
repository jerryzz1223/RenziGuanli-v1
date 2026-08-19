const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "hrms/hr/doctype/cross_department_support_capability/cross_department_support_capability.py"), "utf8");
const page = fs.readFileSync(path.join(root, "hrms/hr/page/cross_department_support/cross_department_support.js"), "utf8");
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

for (const marker of ["异常行也可导入", "导入并保留异常", "待复核记录，可在维护台账中编辑"]) {
	assert(page.includes(marker), `Missing import-review UI guidance: ${marker}`);
}
assert(page.includes('fieldname: "include_unavailable"') && page.includes("default: 1"), "The query page must show imported review records by default");

console.log("cross department support partial import contract passed");
