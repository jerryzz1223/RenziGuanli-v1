const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const seedPath = path.join(root, "hrms/api/demo_seed.py");

if (!fs.existsSync(seedPath)) {
	throw new Error("Missing TEST-HRMS demo seed service: hrms/api/demo_seed.py");
}

const recruitmentSeedPath = path.join(root, "hrms/api/recruitment_demo_seed.py");
if (!fs.existsSync(recruitmentSeedPath)) {
	throw new Error("Missing authoritative recruitment demo seed: hrms/api/recruitment_demo_seed.py");
}

const source = fs.readFileSync(seedPath, "utf8");
const recruitmentSource = fs.readFileSync(recruitmentSeedPath, "utf8");
const combinedSource = `${source}\n${recruitmentSource}`;

function mustInclude(marker) {
	if (!combinedSource.includes(marker)) throw new Error(`TEST-HRMS demo seed is missing marker: ${marker}`);
}

for (const marker of [
	'TEST_COMPANY = "TEST-HRMS"',
	'DEMO_MONTH = "2099-01"',
	'TEST_PAYROLL_LOCK_VERSION = "TEST-2099-01-V1"',
	"get_test_hrms_demo_status",
	"get_test_hrms_demo_records",
	"seed_test_hrms_demo",
	"reset_test_hrms_payroll_seed",
	"recruitment_demo_seed",
	"seed_recruitment_demo",
	"_protected_snapshot",
	"_assert_protected_unchanged",
	"_create_if_missing",
	"dry_run",
	"existing",
	"blocked",
	"foundation",
	"employees",
	"recruitment",
	"personnel_lists",
	"training",
	"attendance",
	"payroll",
	"performance",
	"TEST-OUT-005",
	"TEST-REH-006",
	"TEST-MOV-007",
	"TEST-LEFT-008",
	"HRMS Monthly Attendance Summary",
	"HRMS Employee Salary Change",
	"HRMS Payroll Variable Record",
	"HRMS Payroll Input Record",
	"HRMS Payroll Settlement Record",
	"attendance_lock_version",
	"lock_status",
	"generate_payroll_input_records(TEST_COMPANY, DEMO_MONTH, TEST_PAYROLL_LOCK_VERSION)",
	"generate_payroll_settlement_records(TEST_COMPANY, DEMO_MONTH, TEST_PAYROLL_LOCK_VERSION)",
	"RESET TEST-HRMS PAYROLL",
	"Employee Onboarding",
	"Employee Promotion",
	"Employee Transfer",
	"Employee Property History",
	"Employee Skill Map",
	"HRMS Employee Reward Punishment",
	"Employee Separation",
	"Exit Interview",
	"Job Requisition",
	"Job Opening",
	"Job Applicant",
	"Interview Feedback",
	"Job Offer",
	"Training Program",
	"Training Event",
	"Appraisal Template",
	"Appraisal Cycle",
	"Employee Performance Feedback",
	"入职管理",
	"转正管理",
	"人事异动",
	"任职记录",
	"培训经历",
	"奖惩记录",
	'"reward_punishment_type": "奖励"',
	"离职管理",
	"离职面谈",
	"company",
	"2099-01",
]) {
	mustInclude(marker);
}

for (const forbidden of [
	"sync_attendance_from_dingtalk",
	"generate_payroll_input_records(DEMO_MONTH)",
	"generate_payroll_settlement_records(DEMO_MONTH)",
	"test-candidate-007@example.invalid",
]) {
	if (source.includes(forbidden)) throw new Error(`Unsafe global write call in demo seed: ${forbidden}`);
}

console.log("TEST-HRMS demo seed contract passed.");
