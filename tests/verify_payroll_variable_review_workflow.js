const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const include = (source, marker) => { if (!source.includes(marker)) throw new Error(`Missing monthly variable review marker: ${marker}`); };

const api = read("hrms/api/payroll_input.py");
const page = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
const batch = JSON.parse(read("hrms/hr/doctype/hrms_payroll_variable_import_batch/hrms_payroll_variable_import_batch.json"));
const record = JSON.parse(read("hrms/hr/doctype/hrms_payroll_variable_record/hrms_payroll_variable_record.json"));
const source = JSON.parse(read("hrms/hr/doctype/hrms_payroll_variable_source_type/hrms_payroll_variable_source_type.json"));

for (const marker of [
	"DEFAULT_PAYROLL_VARIABLE_SOURCE_TYPES", "list_payroll_variable_source_types", "preview_rows",
	'"status": "待审核"', "confirm_payroll_variable_import_batch", "set_payroll_variable_record_excluded",
	"delete_payroll_variable_import_batches", "void_payroll_variable_import_batch", "can_confirm_empty", "_repeated_employee_amount_rows",
	"_assert_no_singleton_variable_conflicts", "_payroll_run_snapshot", "required_for_payroll",
	'filters["review_status"] = "已确认"', 'filters["excluded"] = 0', "MONTHLY_VARIABLE_SCOPE_PREFIX",
]) include(api, marker);
for (const marker of [
	"唯一补充数据入口", "本月数据来源清单", "解析与字段校验", "预览并人工纠错",
	"导入为待审核", "确认入账", "维护来源类型", "data-toggle-variable-record",
	"data-select-import-batch", "删除所选批次", "清空本月未确认", "确认无数据",
	"data-void-import-batch", "作废已确认批次", "员工匹配",
]) include(page, marker);

const attendanceSync = api.slice(api.indexOf("def sync_locked_attendance_final_to_payroll"), api.indexOf("def generate_payroll_input_records"));
if (attendanceSync.includes('(\"住房补贴\", flt(row.get(\"housing_allowance\"))')) {
	throw new Error("Housing allowance must only enter payroll through the confirmed monthly-additions batch");
}

const batchFields = new Set(batch.fields.map((field) => field.fieldname));
for (const field of ["source_type", "status", "imported_by", "imported_on", "reviewed_by", "reviewed_on", "confirmed_by", "confirmed_on", "voided_by", "voided_on", "void_reason", "replacement_batch"]) if (!batchFields.has(field)) throw new Error(`Batch trace field missing: ${field}`);
const recordFields = new Set(record.fields.map((field) => field.fieldname));
for (const field of ["review_status", "validation_status", "validation_message", "excluded"]) if (!recordFields.has(field)) throw new Error(`Record review field missing: ${field}`);
const sourceFields = new Set(source.fields.map((field) => field.fieldname));
for (const field of ["source_code", "source_name", "purpose", "required_for_payroll", "required_fields", "template_notes", "target_area"]) if (!sourceFields.has(field)) throw new Error(`Source configuration field missing: ${field}`);

console.log("Payroll monthly variable review workflow contract passed.");
