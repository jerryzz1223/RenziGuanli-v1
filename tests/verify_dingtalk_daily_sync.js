const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const json = (file) => JSON.parse(read(file));
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

const integration = read("hrms/api/dingtalk_integration.py");
const converter = read("hrms/api/dingtalk_attendance_sync.py");
const acceptance = read("hrms/api/dingtalk_sync_acceptance.py");
const attendance = read("hrms/api/attendance_import.py");
const hooks = read("hrms/hooks.py");

for (const marker of [
	"_require_dingtalk_manager",
	"_require_sync_company",
	"_require_api_sync_enabled",
	"run_scheduled_dingtalk_attendance_sync",
	"sync_approvals_from_dingtalk",
	"sync_lookback_days",
	"ensure_dingtalk_company_scope",
	'"30 2 * * *"',
]) {
	assert(integration.includes(marker) || hooks.includes(marker), `Missing protected DingTalk daily sync marker: ${marker}`);
}

for (const marker of [
	"convert_dingtalk_raw_attendance_to_daily_checks",
	"钉钉API同步",
	"HRMS Attendance Import Batch",
	"generate_attendance_exceptions",
	"_assert_month_open",
	"allow_unmatched=True",
	'"迟到分钟"',
	'"班次外打卡状态"',
	'"无申请的班次外打卡"',
	'"关联审批明细"',
]) {
	assert(converter.includes(marker), `Daily raw-to-draft converter is missing: ${marker}`);
}

for (const field of ["late_minutes", "outside_shift_punch_status", "approval_summary"]) {
	assert(
		json("hrms/hr/doctype/hrms_attendance_day_check/hrms_attendance_day_check.json").fields.some((item) => item.fieldname === field),
		`Daily attendance fact field is missing: ${field}`,
	);
}

assert(integration.includes('"hrms_approval_type": label'), "Approval sync must retain its configured business type.");
assert(attendance.includes('"无申请的班次外打卡"'), "Outside-shift punches without an application must reach the review flag.");

assert(attendance.includes("allow_unmatched=False"), "Attendance import must keep its default employee-match protection.");
assert(attendance.includes('"员工未匹配"'), "Unmapped DingTalk accounts must enter the existing exception queue.");

const requiredScopeFields = {
	"hrms/hr/doctype/hrms_dingtalk_settings/hrms_dingtalk_settings.json": ["company", "daily_sync_enabled", "sync_lookback_days", "approval_process_codes"],
	"hrms/hr/doctype/hrms_dingtalk_raw_record/hrms_dingtalk_raw_record.json": ["company", "dingtalk_userid", "business_date"],
	"hrms/hr/doctype/hrms_dingtalk_user_map/hrms_dingtalk_user_map.json": ["company"],
	"hrms/hr/doctype/hrms_dingtalk_sync_log/hrms_dingtalk_sync_log.json": ["company", "business_date"],
	"hrms/hr/doctype/hrms_attendance_import_batch/hrms_attendance_import_batch.json": ["dingtalk_sync_log"],
};

for (const [file, fields] of Object.entries(requiredScopeFields)) {
	const fieldnames = json(file).fields.map((field) => field.fieldname);
	for (const field of fields) assert(fieldnames.includes(field), `${file} is missing ${field}`);
}

console.log("DingTalk daily draft synchronization contract passed.");

assert(acceptance.includes("run_dingtalk_daily_sync_acceptance"), "An isolated DingTalk daily-sync acceptance helper must exist.");
