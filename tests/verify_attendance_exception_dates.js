const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sourcePath = path.resolve(__dirname, "../hrms/hr/page/attendance_import_center/attendance_import_center.js");
const source = `${fs.readFileSync(sourcePath, "utf8")}\nglobalThis.AttendanceImportCenter = AttendanceImportCenter;`;
const context = {
	frappe: { pages: { "attendance-import-center": {} }, utils: { escape_html: (value) => String(value) } },
	__: (value) => value,
};
vm.runInNewContext(source, context, { filename: sourcePath });

const center = Object.create(context.AttendanceImportCenter.prototype);
center.attendance_month = "2026-07";

assert.strictEqual(center.parse_attendance_time_minutes("08:30"), 510);
assert.strictEqual(center.restday_overtime_hours_from_range("08:00", "17:30"), 9.5);
assert.strictEqual(center.restday_overtime_hours_from_range("20:00", "04:30"), 8.5);
assert.strictEqual(center.restday_overtime_hours_from_range("08:00", "08:00"), null);

assert.strictEqual(center.processing_slot_status({status: "已确认", exception_count: 234}), "待处理异常");
assert.strictEqual(center.processing_slot_status({status: "已确认", exception_count: 0}), "已确认");

const pendingSlotMarkup = center.render_processing_slot({
	source_type: "attendance_draft",
	label: "考勤初稿",
	status: "已确认",
	source_file: "/private/files/attendance.xlsx",
	exception_count: 65,
});
assert.match(pendingSlotMarkup, /data-slot-exceptions="attendance_draft"/);
assert.match(pendingSlotMarkup, />待处理异常<\/button>/);
assert.doesNotMatch(pendingSlotMarkup, /data-slot-manual|>手动修改<\/button>/);

const row = {
	source_type: "attendance_draft",
	exception_codes: ["ATTENDANCE_MONTH_MISMATCH"],
	processed_value: {
		attendance_details: [
			{ attendance_date: "2026-07-01" },
			{ attendance_date: "2026-07-31" },
			{ attendance_date: "2026-08-01" },
		],
	},
};

assert.strictEqual(center.attendance_exception_date_text(row), "2026-08-01");
assert.strictEqual(center.attendance_draft_columns().at(-1)[1], "异常日期");

const exceptionMarkup = center.render_attendance_exception_lines([{
	attendance_date: "2026-07-31",
	exception_codes: ["CLOCK_OUT_MISSING"],
	shift: "生产夜班 20:00-次日04:30",
	clock_in: "19:47",
	clock_out: "",
	source_row: 99,
}], "", false);
assert.match(exceptionMarkup, /2026-07-31/);
assert.match(exceptionMarkup, /下班缺卡/);
assert.match(exceptionMarkup, /生产夜班/);
assert.match(exceptionMarkup, /19:47/);
assert.match(exceptionMarkup, /第 99 行/);

const hoursMarkup = center.render_attendance_exception_lines([{
	attendance_date: "2026-07-03", exception_codes: ["ATTENDANCE_HOURS_MISMATCH"],
	standard_hours: 8, actual_attendance_hours: 7, personal_leave_hours: 2,
	leave_hours: 2, leave_breakdown: {"事假": 2}, accounted_hours: 9, hours_difference: 1,
}], "employee-1");
assert.match(hoursMarkup, /工时合计与标准工时不符/);
assert.match(hoursMarkup, /事假 2 小时/);
assert.match(hoursMarkup, /超出 1 小时/);
assert.match(hoursMarkup, /实际出勤 7/);
assert.match(hoursMarkup, /病假 0 ÷ 2/);
assert.match(hoursMarkup, />修改本日</);
const shortageMarkup = center.render_attendance_exception_lines([{
	attendance_date: "2026-07-03", exception_codes: ["ATTENDANCE_HOURS_MISMATCH"],
	standard_hours: 8, actual_attendance_hours: 7, accounted_hours: 7, hours_difference: -1,
}], "employee-1");
assert.match(shortageMarkup, /不足 1 小时/);

const twoRestdayMarkup = center.render_attendance_exception_lines([
	{ attendance_date: "2026-07-04", source_row: 10, exception_codes: ["RESTDAY_CLOCKED_WITHOUT_OVERTIME"] },
	{ attendance_date: "2026-07-25", source_row: 20, exception_codes: ["RESTDAY_CLOCKED_WITHOUT_OVERTIME"] },
], "record-1");
assert.strictEqual((twoRestdayMarkup.match(/data-confirm-attendance-daily-no-overtime=/g) || []).length, 2);
assert.match(twoRestdayMarkup, /data-attendance-source-row="10"/);
assert.match(twoRestdayMarkup, /data-attendance-source-row="20"/);
assert.match(twoRestdayMarkup, />确认本日不计加班</);
assert.strictEqual((twoRestdayMarkup.match(/>修改本日</g) || []).length, 2);

console.log("Attendance exception-date display checks passed.");
