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
	"ATTENDANCE_SYNC_DELAY_DAYS = 2",
	"_validate_attendance_sync_date",
	"get_dingtalk_attendance_resync_preview",
	"重新同步必须填写原因",
	"reopen_locked_day",
	"skipped_locked",
	"DINGTALK_RAW_SNAPSHOT_SOURCE_TYPE",
	"skipped_rebuild",
	"钉钉原始数据与上次同步一致",
	'"sync_status": "已失效"',
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
	"_compare_daily_check_versions",
	"manual_conflicts",
	"_invalidate_daily_closure_after_resync",
	"allow_locked_day_resync",
	"_restore_unchanged_exception_reviews",
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
	"hrms/hr/doctype/hrms_dingtalk_sync_log/hrms_dingtalk_sync_log.json": ["company", "business_date", "is_resync", "resync_reason", "previous_sync_log", "records_unchanged", "manual_conflicts"],
	"hrms/hr/doctype/hrms_attendance_import_batch/hrms_attendance_import_batch.json": ["dingtalk_sync_log"],
};

for (const [file, fields] of Object.entries(requiredScopeFields)) {
	const fieldnames = json(file).fields.map((field) => field.fieldname);
	for (const field of fields) assert(fieldnames.includes(field), `${file} is missing ${field}`);
}

assert(
	json("hrms/hr/doctype/hrms_dingtalk_raw_record/hrms_dingtalk_raw_record.json").fields
		.find((field) => field.fieldname === "source_type").options.includes("snapshot"),
	"Raw DingTalk records must retain pre-resync snapshots.",
);

const attendanceCenter = read("hrms/hr/page/attendance_import_center/attendance_import_center.js");
for (const marker of [
	"preview_dingtalk_attendance_sync",
	"confirm_dingtalk_attendance_first_sync",
	"confirm_dingtalk_attendance_resync",
	"已完成同步范围检查，尚未提交任务",
	"确认开始同步",
	"当前最多可同步到 {0}",
	"重新同步钉钉数据",
	"人工调整不会被覆盖",
	"progressLabel",
]) {
	assert(attendanceCenter.includes(marker), `Missing DingTalk resync UI contract: ${marker}`);
}

console.log("DingTalk daily draft synchronization contract passed.");

assert(acceptance.includes("run_dingtalk_daily_sync_acceptance"), "An isolated DingTalk daily-sync acceptance helper must exist.");
