const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sourcePath = path.resolve(__dirname, "../hrms/hr/page/attendance_import_center/attendance_import_center.js");
const cssPath = path.resolve(__dirname, "../hrms/hr/page/attendance_import_center/attendance_import_center.css");
const source = `${fs.readFileSync(sourcePath, "utf8")}\nglobalThis.AttendanceImportCenter = AttendanceImportCenter;`;
const css = fs.readFileSync(cssPath, "utf8");
const context = {
	frappe: { pages: { "attendance-import-center": {} }, utils: { escape_html: (value) => String(value) } },
	__: (value) => value,
};
vm.runInNewContext(source, context, { filename: sourcePath });

const center = Object.create(context.AttendanceImportCenter.prototype);
center.attendance_month = "2026-07";
Object.assign(center, {
	processing_result_sources: [{key: "attendance_draft", label: "考勤初稿"}],
	exception_sources: [{key: "attendance_draft", label: "考勤初稿"}],
	exception_source_filter: "", exception_code_filter: "", exception_processing_status_filter: "",
	exception_department_filter: "", exception_department_options: ["工程课", "生产课"],
	exception_employee_name_filter: "", exception_employee_code_filter: "",
	exception_sort_field: "employee_code", exception_sort_order: "asc", select_all_filtered_exceptions: false,
	selected_exception_record_ids: new Set(), exception_page: 1, exception_page_size: 20,
});
const exceptionHeader = center.render_exception_table_header(false, 0);
assert.match(exceptionHeader, /<select[^>]+data-exception-department-filter/);
assert.match(exceptionHeader, /<option value="工程课"/);
assert.doesNotMatch(exceptionHeader, /<input[^>]+data-exception-department-filter/);
const splitAttendanceRows = center.exception_table_rows([{
	record_id: "employee-1", source_type: "attendance_draft", employee_name: "林俊松",
	daily_exception_lines: [
		{ daily_record_id: "day-1", attendance_date: "2026-07-01", exception_codes: ["LATE_MARKED"] },
		{ daily_record_id: "day-2", attendance_date: "2026-07-02", exception_codes: ["CLOCK_OUT_MISSING"] },
	],
}]);
assert.strictEqual(splitAttendanceRows.length, 2);
assert.deepStrictEqual(Array.from(splitAttendanceRows, (item) => item.daily_exception_lines[0].attendance_date), ["2026-07-01", "2026-07-02"]);
const splitAttendanceMarkup = center.render_processing_exceptions([{
	record_id: "employee-1", source_type: "attendance_draft", source_label: "考勤初稿",
	employee_name: "林俊松", employee_code: "0001", department: "总办室",
	daily_exception_lines: [
		{ daily_record_id: "day-1", attendance_date: "2026-07-01", exception_codes: ["LATE_MARKED"], review_status: "待审核" },
		{ daily_record_id: "day-2", attendance_date: "2026-07-02", exception_codes: ["CLOCK_OUT_MISSING"], review_status: "待审核" },
	],
}], false, "", {filtered_exception_count: 2, filtered_pending_count: 2, filtered_parent_count: 1, total_pending_count: 2});
assert.strictEqual((splitAttendanceMarkup.match(/data-exception-table-row="1"/g) || []).length, 2);
assert.strictEqual((splitAttendanceMarkup.match(/data-exception-daily-record="day-[12]"/g) || []).length, 2);
assert.strictEqual((splitAttendanceMarkup.match(/>林俊松</g) || []).length, 2);
assert.match(splitAttendanceMarkup, /每个异常日期单独显示一行/);
assert.match(splitAttendanceMarkup, /异常 \{1\} 条（待处理 \{2\} 条）/);
assert.match(splitAttendanceMarkup, /当前筛选异常记录 \{3\} 条/);
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
assert.deepStrictEqual(Array.from(recheckChanges), []);
assert.deepStrictEqual(Array.from(center.manual_adjustment_changes({field_name: "__source_parser_repair__", original_value: {workday_overtime_hours: 0}, new_value: {workday_overtime_hours: 26.5}})), []);
assert.deepStrictEqual(Array.from(center.manual_adjustment_changes({field_name: "__review_decision__", original_value: {}, new_value: {}})), []);
assert.deepStrictEqual(Array.from(center.manual_adjustment_changes({field_name: "__daily_exception_decision__:10:RESTDAY_CLOCKED_WITHOUT_OVERTIME", original_value: {decision: "待处理"}, new_value: {decision: "已处理"}})), []);

assert.strictEqual(center.parse_attendance_time_minutes("08:30"), 510);
assert.strictEqual(center.parse_attendance_time_minutes("08:30:00"), 510);
assert.strictEqual(center.attendance_time_control_value("7:59"), "07:59:00");
assert.strictEqual(center.attendance_time_control_value("invalid"), "");
assert.strictEqual(center.restday_overtime_hours_from_range("08:00", "17:30"), 9.5);
assert.strictEqual(center.restday_overtime_hours_from_range("20:00", "04:30"), 8.5);
assert.strictEqual(center.restday_overtime_hours_from_range("08:00", "08:00"), null);
assert.strictEqual(center.restday_overtime_input_hours("6.25"), 6);
assert.strictEqual(center.restday_overtime_input_hours("6.5"), 6.5);
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

assert.strictEqual(center.attendance_exception_date_text(row), "2026-08-01 星期六");
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
	{ attendance_date: "2026-07-25", review_status: "已处理异常" },
]);
assert.match(independentStatusMarkup, /2026-07-04[\s\S]*待处理异常/);
assert.match(independentStatusMarkup, /2026-07-25[\s\S]*已处理异常/);
assert.strictEqual((independentStatusMarkup.match(/hrms-attendance-exception-line/g) || []).length, 2);

const resolvedMarkup = center.render_attendance_exception_lines([{
	attendance_date: "2026-07-25", source_row: 20, resolved: true, review_status: "已处理异常",
	exception_codes: ["RESTDAY_CLOCKED_WITHOUT_OVERTIME"],
}], "record-1");
assert.match(center.render_attendance_daily_statuses([{ attendance_date: "2026-07-25", review_status: "已处理异常" }]), /已处理异常/);
assert.doesNotMatch(resolvedMarkup, /data-edit-attendance-daily-row/);

const resolvedBalancedMarkup = center.render_attendance_exception_lines([{
	attendance_date: "2026-07-01", source_row: 389, resolved: true, review_status: "已处理异常",
	exception_codes: ["ATTENDANCE_HOURS_MISMATCH"], standard_hours: 8, actual_attendance_hours: 8,
	personal_leave_hours: 0, sick_leave_hours: 0, reunion_leave_hours: 0, rest_arrangement_hours: 0,
	absence_hours: 0, accounted_hours: 8, hours_difference: 0,
}], "record-1");
assert.match(resolvedBalancedMarkup, /已处理（原异常/);
assert.match(resolvedBalancedMarkup, /处理后校验/);
assert.match(resolvedBalancedMarkup, /已一致/);
assert.doesNotMatch(resolvedBalancedMarkup, /输入不成立/);

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
assert.match(source, /data-exception-department-filter/);
assert.match(source, /data-exception-code-filter/);
assert.match(source, /data-exception-processing-status-filter/);
assert.match(source, /data-exception-sort-by/);
assert.match(source, /employee_code: this\.exception_employee_code_filter/);
assert.match(source, /employee_name: this\.exception_employee_name_filter/);
assert.match(source, /department: this\.exception_department_filter/);
assert.match(source, /exception_code: this\.exception_code_filter/);
assert.match(source, /available_departments/);
assert.match(source, /exception_department_options/);
const exceptionSearchBinding = source.slice(
	source.indexOf('body.querySelectorAll("[data-exception-employee-code-filter]'),
	source.indexOf('body.querySelectorAll("[data-exception-department-filter]', source.indexOf('body.querySelectorAll("[data-exception-employee-code-filter]')),
);
assert.match(exceptionSearchBinding, /addEventListener\("keydown"/);
assert.match(exceptionSearchBinding, /event\.key !== "Enter" \|\| event\.isComposing \|\| event\.keyCode === 229/);
assert.match(exceptionSearchBinding, /event\.preventDefault\(\)/);
assert.doesNotMatch(exceptionSearchBinding, /addEventListener\("input"/);
assert.doesNotMatch(exceptionSearchBinding, /addEventListener\("change"/);
assert.doesNotMatch(exceptionSearchBinding, /setTimeout\(applyExceptionQuery/);
assert.match(css, /\.hrms-attendance-exception-table-wrap\s*\{[\s\S]*?max-height:[\s\S]*?overflow: auto/);
assert.match(css, /\.hrms-attendance-exception-table-wrap\s*\{[\s\S]*?min-height:\s*min\(68vh,\s*760px\)/);
assert.match(css, /\.hrms-attendance-exception-table-wrap\s*\{[\s\S]*?max-height:\s*calc\(100vh\s*-\s*96px\)/);
assert.match(css, /@supports\s*\(height:\s*100dvh\)[\s\S]*?max-height:\s*calc\(100dvh\s*-\s*96px\)/);
assert.match(css, /\.hrms-attendance-exception-table thead th\s*\{[\s\S]*?position: sticky;[\s\S]*?top: 0/);
assert.match(source, /capture_exception_scroll_position/);
assert.match(source, /restore_exception_scroll_position/);
assert.match(source, /preserveScroll/);

const auditedChanges = center.manual_adjustment_changes({
	field_name: "__daily_row__:1224",
	original_value: {restday_overtime_hours: 0},
	new_value: {restday_overtime_hours: 6.5},
	reference_values: {overtime_start_time: "07:59", overtime_end_time: "15:08"},
});
assert.deepStrictEqual(Array.from(auditedChanges, (item) => item.label), ["加班时间（小时数，计入后续）"]);
assert.strictEqual(auditedChanges[0].modified, 6.5);
const onlyRealDailyChange = center.manual_adjustment_changes({
	field_name: "__daily_row__:389",
	original_value: {"实际出勤（小时）": null, "请假/事假(小时)": null},
	new_value: {"实际出勤（小时）": "8", "请假/事假(小时)": ""},
});
assert.deepStrictEqual(Array.from(onlyRealDailyChange, (item) => item.label), ["实际出勤（小时）"]);

const ledgerMarkup = center.render_processing_ledger("adjustments", [{
	employee_code: "2081", employee_name: "李旭", source_type: "attendance_draft", attendance_date: "2026-07-15",
	field_name: "__daily_row__:1224", original_value: {annual_leave_hours: 0, personal_leave_hours: 2},
	new_value: {annual_leave_hours: 6, personal_leave_hours: 3}, reason: "更正", modified_by: "Administrator", modified_at: "2026-09-22 10:00:00",
}]);
assert.strictEqual((ledgerMarkup.match(/2081 李旭/g) || []).length, 2);
assert.strictEqual((ledgerMarkup.match(/2026-07-15/g) || []).length, 2);
assert.match(ledgerMarkup, />特休工时</);
assert.match(ledgerMarkup, />事假工时</);
assert.match(ledgerMarkup, /规则校验、来源修复和仅处理决定不在此显示/);

console.log("Attendance exception-date display checks passed.");
