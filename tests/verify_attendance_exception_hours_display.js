const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
	path.join(root, "hrms/hr/page/attendance_import_center/attendance_import_center.js"),
	"utf8",
);
const start = source.indexOf("render_attendance_exception_lines(lines");
const end = source.indexOf("\n\tapple_tree_columns()", start);
const renderExceptionLines = source.slice(start, end);

if (!renderExceptionLines.includes('includes("ATTENDANCE_HOURS_MISMATCH")')) {
	throw new Error("Attendance hours equation must be shown only for an actual hours mismatch.");
}
if (!renderExceptionLines.includes("输入不成立：")) {
	throw new Error("Attendance hours mismatch must identify the invalid input equation.");
}
if (renderExceptionLines.includes("工时一致")) {
	throw new Error("Valid attendance hours must not add a redundant equation to unrelated exception details.");
}
for (const required of ["计划：", "实际打卡：", "班次外原始时长：", "确认计入：", "无申请"]) {
	if (!renderExceptionLines.includes(required)) {
		throw new Error(`Attendance exception details must display ${required}`);
	}
}
for (const locator of ["data-attendance-source-file", "data-attendance-source-sheet", "data-attendance-date"]) {
	if (!renderExceptionLines.includes(locator)) {
		throw new Error(`Daily exception actions must retain exact locator ${locator}`);
	}
}

const editorStart = source.indexOf("open_attendance_daily_row_editor(");
const editorEnd = source.indexOf("\n\tconfirm_attendance_daily_no_overtime", editorStart);
const editor = source.slice(editorStart, editorEnd);
for (const field of ["source_file: dailyRow.source_file", "source_sheet: dailyRow.source_sheet", "attendance_date: dailyRow.attendance_date"]) {
	if (!editor.includes(field)) throw new Error(`Daily row save must submit ${field}`);
}
for (const required of ["填写时核对", "班次：", "周末，只核对时长", "实际打卡：", "班次外原始时长：", "无申请", "确认计入：", "标准工时：", "导出实际出勤："]) {
	if (!editor.includes(required)) throw new Error(`Rest-day overtime editor must display ${required}`);
}
for (const value of ["dailyRow.shift", "dailyRow.clock_in", "dailyRow.clock_out", "dailyRow.raw_outside_shift_hours", "dailyRow.overtime_approval_status", "dailyRow.confirmed_overtime_hours", "dailyRow.standard_hours", "dailyRow.actual_attendance_hours"]) {
	if (!editor.includes(value)) throw new Error(`Rest-day overtime editor must use ${value}`);
}
for (const required of ['includes("LATE_MARKED")', "field.late_editor", 'label: __("日期")', "attendance_date_display"]) {
	if (!editor.includes(required)) throw new Error(`Late editor must keep the focused field contract: ${required}`);
}

console.log("Attendance exception hours display checks passed.");
