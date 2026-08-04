const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(file) {
	const full = path.join(root, file);
	if (!fs.existsSync(full)) throw new Error(`Missing file: ${file}`);
	return fs.readFileSync(full, "utf8");
}

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}

function mustNotInclude(source, marker, message) {
	if (source.includes(marker)) throw new Error(message || `Forbidden marker: ${marker}`);
}

function fieldnames(file) {
	return new Set(JSON.parse(read(file)).fields.map((field) => field.fieldname));
}

const api = read("hrms/api/payroll_input.py");
const pageJs = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");

for (const marker of [
	"def _require_company(company)",
	"def _require_payroll_scope(company, payroll_month, attendance_lock_version",
	"def _payroll_scope_filters(company, payroll_month, attendance_lock_version",
	"def _attendance_scope_filters(company, attendance_month, attendance_lock_version)",
	'"lock_status": "已锁定"',
	"def generate_payroll_input_records(company: str, payroll_month: str, attendance_lock_version: str)",
	"def generate_payroll_settlement_records(company: str, payroll_month: str, attendance_lock_version: str)",
	"def import_payroll_variable_workbook(file_url: str, payroll_month: str = \"\", company: str = \"\", attendance_lock_version: str = \"\")",
	"def delete_payroll_variable_import_batch(batch_name: str, company: str = \"\", attendance_lock_version: str = \"\")",
	"完整薪资结算表只能用于预览核对",
	"source_trace_json",
	"source_hash",
	"苹果树",
	"离职薪资结算",
]) {
	mustInclude(api, marker, `Payroll API isolation contract is missing marker: ${marker}`);
}

for (const forbidden of [
	'filters={"payroll_month": payroll_month}',
	'filters={"attendance_month": payroll_month}',
	'filters={"payroll_month": batch.payroll_month}',
]) {
	mustNotInclude(api + pageJs, forbidden, `Payroll scope can still be used without company/version: ${forbidden}`);
}

for (const marker of [
	"data-company",
	"data-lock-version",
	"scope_args(extra = {})",
	"company: this.company",
	"attendance_lock_version: this.attendance_lock_version",
	"显示所有细项",
]) {
	mustInclude(pageJs, marker, `Payroll page scope UI is missing marker: ${marker}`);
}

for (const file of [
	"hrms/hr/doctype/hrms_payroll_input_record/hrms_payroll_input_record.json",
	"hrms/hr/doctype/hrms_payroll_settlement_record/hrms_payroll_settlement_record.json",
	"hrms/hr/doctype/hrms_payroll_variable_record/hrms_payroll_variable_record.json",
	"hrms/hr/doctype/hrms_payroll_variable_import_batch/hrms_payroll_variable_import_batch.json",
	"hrms/hr/doctype/hrms_payroll_welfare_source_record/hrms_payroll_welfare_source_record.json",
]) {
	const fields = fieldnames(file);
	for (const field of ["company", "payroll_month", "attendance_lock_version"]) {
		if (!fields.has(field)) throw new Error(`${file} missing field: ${field}`);
	}
}

for (const file of [
	"hrms/hr/doctype/hrms_payroll_input_record/hrms_payroll_input_record.json",
	"hrms/hr/doctype/hrms_payroll_settlement_record/hrms_payroll_settlement_record.json",
	"hrms/hr/doctype/hrms_payroll_variable_record/hrms_payroll_variable_record.json",
	"hrms/hr/doctype/hrms_payroll_welfare_source_record/hrms_payroll_welfare_source_record.json",
]) {
	const fields = fieldnames(file);
	for (const field of ["source_trace_json", "source_hash"]) {
		if (!fields.has(field)) throw new Error(`${file} missing field: ${field}`);
	}
}

const attendanceFields = fieldnames("hrms/hr/doctype/hrms_monthly_attendance_summary/hrms_monthly_attendance_summary.json");
for (const field of ["company", "attendance_month", "attendance_lock_version", "lock_status", "locked_by", "locked_on", "source_checksum"]) {
	if (!attendanceFields.has(field)) throw new Error(`Monthly attendance summary missing field: ${field}`);
}

console.log("Payroll company isolation contract passed.");
