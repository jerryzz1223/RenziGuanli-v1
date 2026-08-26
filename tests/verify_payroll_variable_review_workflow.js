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
	'"status": "待确认"', "confirm_payroll_variable_import_batch", "confirm_all_payroll_variable_import_batches", "confirm_all_payroll_welfare_sources", "set_payroll_variable_record_excluded",
	"delete_payroll_variable_import_batches", "void_payroll_variable_import_batch", "can_confirm_empty", "_repeated_employee_amount_rows",
	"_assert_no_singleton_variable_conflicts", "prior_batch.source_type == batch.source_type", "_payroll_run_snapshot", "required_for_payroll",
	'filters["review_status"] = "已确认"', 'filters["excluded"] = 0', "MONTHLY_VARIABLE_SCOPE_PREFIX",
	"unmatched_rows", "unmatched_people", "unmatched_reason_summary", '"attendance_bonus"',
	"select_payroll_variable_import_batch", "create_editable_payroll_variable_batch_version", "is_selected",
	"housing_allowance_base", "_housing_allowance_calculation", "create_housing_allowance_base_data_template_file",
	"一阶数据系统计算", "二阶金额直用", "WELFARE_RENTAL_SUBSIDY",
]) include(api, marker);
for (const marker of [
	"唯一补充数据入口", "本月数据来源清单", "本月导入批次",
	"录入数据", "确认入账", "维护来源类型", "data-toggle-variable-record",
	"data-import-batch-table", "data-select-import-batch", "一键确认全部", "confirm_all_import_batches", "data-confirm-all-welfare-sources", "confirm_all_welfare_sources", "删除所选批次", "清空本月未确认", "确认本月无数据",
	"作废已确认批次", "员工匹配", "select_payroll_variable_import_batch",
	"data-open-source-card", "打开{0}明细", "收起明细", "待确认 / 有异常可修改", "allow_multiple: false", "data-source-card-preview", "data-source-card-records", "data-source-card-editable", "data-collapse-source-detail", "data-finish-source-edit", "修改后自动保存", "data-inline-variable-record", "queue_inline_variable_save", "data-edit-variable-record", "data-confirm-source-card", "data-upload-source-version", "data-edit-source-card", "data-create-editable-source-card", "确认入账", "已确认入账", "当前数据已确认入账", "未匹配原因", "不参与计算", "本月数据明细", "暂无本月明细", "hrms-payroll-variable-source-state", "data-table-sort", "data-table-column-search", "prioritize_table_rows", "orderedRows",
	"批量导入表格", "open_bulk_variable_uploader", "import_bulk_variable_file", "薪资异动应在员工定薪处理", "全勤奖由考勤终稿自动继承",
	"data-calculate-monthly-payroll", "calculate_monthly_payroll", "薪资计算完成", "正在进行薪资计算...",
	"data-download-housing-base-template", "下载一阶模板", "已识别住房补贴一阶数据", "已识别住房补贴二阶数据", "计算方式",
]) include(page, marker);

if (!api.includes("全勤奖由已锁定考勤终稿和全勤规则自动计算")) {
	throw new Error("Full attendance must be inherited from the locked attendance final, not uploaded again.");
}

const attendanceSync = api.slice(api.indexOf("def sync_locked_attendance_final_to_payroll"), api.indexOf("def generate_payroll_input_records"));
if (!attendanceSync.includes('(\"住房补贴\", flt(row.get(\"housing_allowance\"))')) {
	throw new Error("Housing allowance must be inherited from the locked attendance final");
}

const batchFields = new Set(batch.fields.map((field) => field.fieldname));
for (const field of ["source_type", "is_selected", "status", "imported_by", "imported_on", "reviewed_by", "reviewed_on", "confirmed_by", "confirmed_on", "voided_by", "voided_on", "void_reason", "replacement_batch"]) if (!batchFields.has(field)) throw new Error(`Batch trace field missing: ${field}`);
const recordFields = new Set(record.fields.map((field) => field.fieldname));
for (const field of ["review_status", "validation_status", "validation_message", "excluded"]) if (!recordFields.has(field)) throw new Error(`Record review field missing: ${field}`);
const sourceFields = new Set(source.fields.map((field) => field.fieldname));
for (const field of ["source_code", "source_name", "purpose", "required_for_payroll", "required_fields", "template_notes", "target_area"]) if (!sourceFields.has(field)) throw new Error(`Source configuration field missing: ${field}`);

console.log("Payroll monthly variable review workflow contract passed.");
