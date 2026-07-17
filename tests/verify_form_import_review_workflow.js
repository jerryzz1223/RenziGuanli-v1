const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "hrms/api/form_data_intake.py"), "utf8");
const rowSchema = fs.readFileSync(path.join(root, "hrms/hr/doctype/hrms_form_import_row/hrms_form_import_row.json"), "utf8");
const formScript = fs.readFileSync(path.join(root, "hrms/public/js/hrms_form_import_review.js"), "utf8");
const listScript = fs.readFileSync(path.join(root, "hrms/public/js/hrms_form_import_review_list.js"), "utf8");
const hooks = fs.readFileSync(path.join(root, "hrms/hooks.py"), "utf8");
const welfareSourceSchema = fs.readFileSync(path.join(root, "hrms/hr/doctype/hrms_payroll_welfare_source_record/hrms_payroll_welfare_source_record.json"), "utf8");

for (const marker of [
	'def review_form_import_row(row_name: str, decision: str, review_note: str = "")',
	'def generate_form_import_target(row_name: str, payroll_month: str = "", attendance_lock_version: str = "", appraisal_cycle: str = "")',
	"def activate_form_import_target(row_name: str)",
	"def list_form_import_review_rows(company: str",
	"_require_form_import_reviewer",
	"Employee Transfer",
	"HRMS Employee Salary Change",
	"HRMS Payroll Welfare Source Record",
	"HRMS Attendance Day Check",
	"_active_attendance_lock_version",
	"ensure_default_form_approval_matrices(company: str)",
	"HRMS Form Approval Matrix",
	"HRMS Business Process Record",
	"BUSINESS_PROCESS_TEMPLATE_CONFIG",
	"审批中",
	"已提交生效",
]) {
	assert(api.includes(marker), `Missing review workflow marker: ${marker}`);
}

for (const field of ["review_status", "approval_route", "approval_step", "approval_step_label", "approval_history_json", "reviewed_by", "reviewed_on", "review_note", "generated_by", "activated_by", "processing_error"]) {
	assert(rowSchema.includes(`"fieldname": "${field}"`), `Missing review audit field: ${field}`);
}

for (const marker of ["批准审核", "生成正式草稿", "提交并生效", "activate_form_import_target"]) {
	assert(formScript.includes(marker), `Missing form action: ${marker}`);
}

assert(listScript.includes("待人事审核"), "Missing review queue shortcut");
assert(hooks.includes('"HRMS Form Import Row": "public/js/hrms_form_import_review.js"'), "Missing row form script registration");
assert(hooks.includes('"HRMS Form Import Row": "public/js/hrms_form_import_review_list.js"'), "Missing row list script registration");
for (const value of ["薪资主数据", "证书多能工津贴", "奖惩提报", "离职薪资结算", "参考"]) {
	assert(welfareSourceSchema.includes(value), `Payroll welfare source schema rejects configured value: ${value}`);
}

console.log("form import review workflow contract passed");
