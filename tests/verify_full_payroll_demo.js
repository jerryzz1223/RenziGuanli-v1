const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const seed = fs.readFileSync(path.join(root, "hrms/api/demo_seed.py"), "utf8");
const launcher = fs.readFileSync(path.join(root, "scripts/hrms-local.sh"), "utf8");
const guidePath = path.join(root, "docs/payroll/TEST-HRMS完整薪资试点操作说明.md");
if (!fs.existsSync(guidePath)) throw new Error("Missing full payroll trial guide.");
const guide = fs.readFileSync(guidePath, "utf8");

function requireMarker(source, marker) {
	if (!source.includes(marker)) throw new Error(`Missing full payroll trial marker: ${marker}`);
}

for (const marker of [
	'FULL_PAYROLL_DEMO_MONTH = "2099-03"',
	"FULL_PAYROLL_DEPARTMENT_ASSIGNMENTS",
	"FULL_PAYROLL_SALARIES",
	"seed_test_hrms_full_payroll_demo",
	"get_test_hrms_full_payroll_demo_status",
	"get_test_hrms_full_payroll_demo_records",
	"reset_test_hrms_full_payroll_demo",
	"import_attendance_workbook",
	"create_attendance_manual_adjustment",
	"generate_attendance_exceptions",
	"generate_monthly_attendance_summary",
	"lock_attendance_month",
	"import_payroll_data_closure_workbook",
	"create_employee_salary_change",
	"upsert_payroll_welfare_source_record",
	"sync_welfare_sources_to_payroll_variables",
	"import_payroll_variable_workbook",
	"update_payroll_variable_record",
	"generate_payroll_input_records",
	"generate_payroll_settlement_records",
	"confirm_payroll_settlement_records",
	"忘打卡",
	"迟到",
	"早退",
	"旷工",
	"未申请加班",
	"DING-LEAVE-20990304",
	"TEST-TRN-004",
	"base_salary=3500",
	"RESET TEST-HRMS FULL PAYROLL",
	"source_trace_json",
]) {
	requireMarker(seed, marker);
}

for (const marker of [
	"seed-full-payroll)",
	"seed-full-payroll-dry-run)",
	"seed-full-payroll-status)",
	"seed-full-payroll-records)",
	"seed-reset-full-payroll)",
	"seed_test_hrms_full_payroll_demo",
	"get_test_hrms_full_payroll_demo_status",
	"get_test_hrms_full_payroll_demo_records",
	"reset_test_hrms_full_payroll_demo",
]) {
	requireMarker(launcher, marker);
}

if (seed.includes('company=\"永新\"') || seed.includes("company='永新'")) {
	throw new Error("Full payroll seed must not write the real company.");
}

for (const marker of ["seed-full-payroll", "TEST-HRMS", "2099-03", "手动调薪", "异常类型", "已确认"]) {
	requireMarker(guide, marker);
}

console.log("Full TEST-HRMS payroll trial contract passed.");
