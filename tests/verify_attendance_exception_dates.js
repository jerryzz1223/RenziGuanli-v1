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
const makeCard = (record, date, row) => ({ dataset: { exceptionCardRecord: record, attendanceDate: date, attendanceSourceRow: String(row), attendanceSourceFile: "A.xlsx", attendanceSourceSheet: "每日统计" } });
const previousCard = makeCard("employee-4076", "2026-07-13", 6961);
const editedCard = makeCard("employee-4076", "2026-07-14", 6962);
const nextCard = makeCard("employee-4076", "2026-07-15", 6963);
const otherCard = makeCard("another-employee", "2026-07-14", 6962);
let visibleCards = [otherCard, previousCard, editedCard, nextCard];
center.body = () => ({ querySelectorAll: () => visibleCards });
const anchor = {recordId: "employee-4076", attendanceDate: "2026-07-14", sourceRow: "6962", sourceFile: "A.xlsx", sourceSheet: "每日统计"};
assert.strictEqual(center.exception_scroll_target(anchor), editedCard);
visibleCards = [otherCard, previousCard, nextCard];
assert.strictEqual(center.exception_scroll_target(anchor), nextCard);
visibleCards = [otherCard, previousCard];
assert.strictEqual(center.exception_scroll_target(anchor), previousCard);
visibleCards = [otherCard];
assert.strictEqual(center.exception_scroll_target(anchor), null);
delete center.body;
const recheckChanges = center.manual_adjustment_changes({field_name: "__attendance_policy_recheck__", original_value: {}, new_value: {exception_lines: [], night_shift_matching: {}, deep_night_shifts: 5}});
assert.strictEqual(recheckChanges.length, 1);
assert.match(recheckChanges[0].label, /整月规则重新校验/);

assert.strictEqual(center.parse_attendance_time_minutes("08:30"), 510);
assert.strictEqual(center.parse_attendance_time_minutes("08:30:00"), 510);
assert.strictEqual(center.attendance_time_control_value("7:59"), "07:59:00");
assert.strictEqual(center.attendance_time_control_value("invalid"), "");
assert.strictEqual(center.restday_overtime_hours_from_range("08:00", "17:30"), 9.5);
assert.strictEqual(center.restday_overtime_hours_from_range("20:00", "04:30"), 8.5);
assert.strictEqual(center.restday_overtime_hours_from_range("08:00", "08:00"), null);
assert.strictEqual(center.restday_overtime_input_hours("6.25"), 6.25);
assert.strictEqual(center.restday_overtime_input_hours("0"), null);

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
assert.match(twoRestdayMarkup, /data-attendance-clock-in=/);
assert.match(twoRestdayMarkup, /data-attendance-clock-out=/);
assert.match(twoRestdayMarkup, />确认本日不计加班</);
assert.strictEqual((twoRestdayMarkup.match(/>修改本日</g) || []).length, 2);

const independentStatusMarkup = center.render_attendance_daily_statuses([
	{ attendance_date: "2026-07-04", review_status: "待审核" },
	{ attendance_date: "2026-07-25", review_status: "已驳回" },
]);
assert.match(independentStatusMarkup, /2026-07-04[\s\S]*待处理异常/);
assert.match(independentStatusMarkup, /2026-07-25[\s\S]*已处理，不计入/);
assert.strictEqual((independentStatusMarkup.match(/hrms-attendance-exception-line/g) || []).length, 2);

assert.doesNotMatch(source, /fieldtype: "Time", fieldname: "restday_overtime_(?:start|end)"/);
assert.match(source, /data-overtime-wheel-picker/);
assert.match(source, /overtime_wheel_column_markup\("hour", 24\)/);
assert.match(source, /overtime_wheel_column_markup\("minute", 60\)/);
assert.match(source, /overtime_wheel_time\(dialog, "start"\)/);
assert.match(source, /overtime_wheel_time\(dialog, "end"\)/);
assert.match(source, /data-overtime-wheel-input/);
assert.match(source, /sync_overtime_wheel_input/);
assert.match(source, /data-use-source-clock-in/);
assert.match(source, /data-use-source-clock-out/);
assert.match(source, /开始时间带入打卡/);
assert.match(source, /<input type="date" class="form-control input-sm" data-daily-date/);
assert.match(source, /data-daily-date-clear/);
assert.match(source, /开始时间（可选）/);
assert.match(source, /结束时间（可选）/);
assert.match(source, /fieldtype: "Float",\s+fieldname: "restday_overtime_hours_input"/);
assert.match(source, /fieldname: "restday_overtime_hours_input"[\s\S]*?reqd: 1/);
assert.doesNotMatch(source, /请上下滑动小时和分钟滚轮选择/);
assert.doesNotMatch(source, /只有这里填写的小时数会计入后续考勤汇总/);
assert.doesNotMatch(source, /restday_overtime_preview/);
assert.match(source, /restdayOvertimeCorrection[\s\S]*dailyRow\.attendance_date/);
assert.doesNotMatch(source, /系统会自动换算加班工时/);
assert.match(source, /overtime_start_time: overtimeStartValue/);
assert.match(source, /overtime_end_time: overtimeEndValue/);
assert.match(source, /data-exception-employee-code-filter/);
assert.match(source, /data-exception-employee-name-filter/);
assert.match(source, /data-exception-sort-field/);
assert.match(source, /data-exception-sort-order/);
assert.match(source, /employee_code: this\.exception_employee_code_filter/);
assert.match(source, /employee_name: this\.exception_employee_name_filter/);
assert.match(source, /capture_exception_scroll_position/);
assert.match(source, /restore_exception_scroll_position/);
assert.match(source, /preserveScroll/);

const auditedChanges = center.manual_adjustment_changes({
	field_name: "__daily_row__:1224",
	original_value: {restday_overtime_hours: 0},
	new_value: {restday_overtime_hours: 6.5},
	reference_values: {overtime_start_time: "07:59", overtime_end_time: "15:08"},
});
assert.deepStrictEqual(Array.from(auditedChanges, (item) => item.label), ["加班时间（小时数，计入后续）", "开始时间（仅查看）", "结束时间（仅查看）"]);
assert.strictEqual(auditedChanges[0].modified, 6.5);

console.log("Attendance exception-date display checks passed.");
