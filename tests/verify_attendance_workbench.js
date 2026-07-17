const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(file) {
	return fs.readFileSync(path.join(root, file), "utf8");
}

function mustExist(file) {
	const fullPath = path.join(root, file);
	if (!fs.existsSync(fullPath)) {
		throw new Error(`Missing file: ${file}`);
	}
	return fullPath;
}

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) {
		throw new Error(message || `Missing marker: ${marker}`);
	}
}

const workbenchJs = read("hrms/hr/page/hrms_workbench/hrms_workbench.js");
const workbenchPy = read("hrms/hr/page/hrms_workbench/hrms_workbench.py");

if (workbenchJs.includes("window.location.replace")) {
	throw new Error("hrms-workbench must render the unified HR shell, not redirect to /desk/hr-setup.");
}

for (const marker of ["工作台", "人事", "组织", "招聘", "考勤假期", "薪酬", "审批", "培训学习", "绩效", "更多"]) {
	mustInclude(workbenchJs + workbenchPy, marker, `Unified HR workbench is missing module marker: ${marker}`);
}

for (const marker of ["考勤导入中心", "每日考勤核对", "考勤异常处理", "月度考勤终稿", "attendance-import-center"]) {
	mustInclude(workbenchJs + workbenchPy, marker, `Attendance module is missing marker: ${marker}`);
}

const attendancePageJsonPath = mustExist("hrms/hr/page/attendance_import_center/attendance_import_center.json");
const attendancePageJsPath = mustExist("hrms/hr/page/attendance_import_center/attendance_import_center.js");
const attendancePageJson = JSON.parse(fs.readFileSync(attendancePageJsonPath, "utf8"));
const attendancePageJs = fs.readFileSync(attendancePageJsPath, "utf8");
const homeRedirectJs = read("hrms/public/js/hrms_home_redirect_v6.js");

if (attendancePageJson.name !== "attendance-import-center" || attendancePageJson.title !== "考勤导入中心") {
	throw new Error("Attendance import center page route/title is incorrect.");
}

for (const marker of [
	"frappe.pages[\"attendance-import-center\"]",
	"on_page_show",
	"refresh_from_route",
	"bind_route_events",
	"hrms:route-change",
	"preview_attendance_workbook",
	"import_attendance_workbook",
	"generate_attendance_exceptions",
	"generate_monthly_attendance_summary",
	"list_attendance_custom_rules",
	"seed_attendance_custom_rules",
	"upsert_attendance_custom_rule",
	"1.1每日统计",
	"1.2请假单",
	"1.3苹果树",
	"每日考勤核对",
	"考勤异常处理",
	"月度考勤终稿",
	"标准工时",
	"实际出勤",
	"1.5倍加班",
	"2倍加班",
	"3倍加班",
	"调整后工时",
	"active_view",
	"view_groups",
	"load_attendance_reports",
	"load_custom_rules",
	"open_rule_dialog",
	"钉钉打卡对接",
	"自定义规则",
	"系统报表",
	"自定义报表",
	"苹果树",
	"7S",
	"KPI",
	"data-action=\"add-report\"",
	"来源类型",
	"字段映射",
	"数据质量告警",
	"确认导入每日统计",
	"data-company",
	"data-company-context",
	"get_context_company",
	"bind_company_context",
	"refresh_company_context_when_ready",
	"hrms:company-context-changed",
	"company: this.company",
	"锁定本月考勤",
	"解锁本月考勤",
	"daily_sources",
	"source_kind",
]) {
	mustInclude(attendancePageJs, marker, `Attendance import center is missing marker: ${marker}`);
}

if (attendancePageJs.includes("render_view_sidebar") || attendancePageJs.includes("hrms-attendance-side")) {
	throw new Error("Attendance workbench must use the unified left sidebar, not render a nested sidebar.");
}

if (attendancePageJs.includes("${this.render_workflow_tabs()}")) {
	throw new Error("Attendance workbench must use the unified left sidebar, not render duplicate workflow tabs.");
}

if (attendancePageJs.includes("dingtalk_export_v1 当前仅支持预览")) {
	throw new Error("DingTalk four-sheet exports must offer a controlled daily-statistics import after preview.");
}

if (!homeRedirectJs.includes('label: "考勤导入中心", route: "/desk/attendance-import-center/import"')) {
	throw new Error("The global attendance sidebar must provide an import-center route.");
}

if (attendancePageJs.includes("data-upload>${frappe.utils.escape_html(__(\"添加报表\"))}")) {
	throw new Error("添加报表 must open the report view, not reuse the upload action.");
}

if (attendancePageJs.includes('this.wrapper.querySelector("[data-company]").addEventListener("change"')) {
	throw new Error("Attendance company must be controlled by the global company selector, not a local editable field.");
}

const apiPath = mustExist("hrms/api/attendance_import.py");
const api = fs.readFileSync(apiPath, "utf8");

for (const marker of [
	"REQUIRED_ATTENDANCE_SHEETS",
	"1.1每日统计",
	"1.2请假单",
	"1.3苹果树",
	"HRMS Attendance Leave Evidence",
	"HRMS Attendance Custom Rule",
	"preview_attendance_workbook",
	"import_attendance_workbook",
	"list_attendance_day_checks",
	"list_attendance_leave_evidence",
	"list_attendance_exceptions",
	"list_monthly_attendance_summary",
	"list_attendance_custom_rules",
	"seed_attendance_custom_rules",
	"upsert_attendance_custom_rule",
	"generate_attendance_exceptions",
	"generate_monthly_attendance_summary",
	"_is_valid_approval",
	"_insert_leave_evidence",
	"_apply_leave_evidence_to_day_checks",
	"_person_keys",
	"_index_records_by_person",
	"_records_for_same_person",
	"_build_exception_candidates",
	"_calculate_monthly_values",
	"_parse_shift_start_time",
	"full_attendance_deduction",
	"night_shift_allowance",
	"adjusted_absence_hours",
	"忘打卡",
	"迟到",
	"早退",
	"旷工",
	"未申请加班",
	"HRMS Attendance Import Batch",
	"HRMS Attendance Day Check",
	"HRMS Attendance Exception",
	"HRMS Apple Reward Record",
	"HRMS Monthly Attendance Summary",
	"DINGTALK_EXPORT_V1_SHEETS",
	"dingtalk_export_v1",
	"_flatten_dingtalk_daily_headers",
	"_preview_dingtalk_export_v1",
	"请假/事假(小时)",
	"COMPANY_ATTENDANCE_WORKBOOK_SOURCES",
	"company_attendance_workbook_v1",
	"_preview_company_attendance_workbook",
	"HRMS Attendance Month Lock",
	"HRMS Attendance Lock Audit",
	"lock_attendance_month",
	"unlock_attendance_month",
	"_attendance_scope_filters",
	"TEST_ATTENDANCE_DEMO_COMPANY",
	"TEST_ATTENDANCE_DEMO_MONTH",
	"seed_test_attendance_demo",
	"get_test_attendance_demo_status",
	"_assert_month_ready_for_lock",
]) {
	mustInclude(api, marker, `Attendance import API is missing marker: ${marker}`);
}

for (const [folder, markers] of [
	["hrms_attendance_import_batch", ["company", "source_type", "source_checksum"]],
	["hrms_attendance_day_check", ["company", "source_kind", "source_sheet", "source_row_number", "correction_version", "public_leave_hours", "maternity_leave_hours", "reunion_leave_hours"]],
	["hrms_attendance_month_lock", ["HRMS Attendance Month Lock", "company", "attendance_month", "active_version", "status"]],
	["hrms_attendance_lock_audit", ["HRMS Attendance Lock Audit", "company", "attendance_month", "action", "reason", "lock_version"]],
]) {
	const jsonPath = mustExist(`hrms/hr/doctype/${folder}/${folder}.json`);
	const pyPath = mustExist(`hrms/hr/doctype/${folder}/${folder}.py`);
	const json = fs.readFileSync(jsonPath, "utf8");
	const py = fs.readFileSync(pyPath, "utf8");
	for (const marker of markers) mustInclude(json, marker, `${folder} is missing ${marker}.`);
	mustInclude(py, "Document", `${folder} controller must extend Document.`);
}

for (const [folder, titleMarkers] of [
	["hrms_attendance_import_batch", ["HRMS Attendance Import Batch", "考勤导入批次", "attendance_month", "source_file"]],
	["hrms_attendance_day_check", ["HRMS Attendance Day Check", "每日考勤核对", "employee_code", "standard_hours", "actual_attendance_hours", "attendance_result", "valid_leave_hours", "overtime_without_approval"]],
	["hrms_attendance_leave_evidence", ["HRMS Attendance Leave Evidence", "考勤请假证据", "leave_type", "approval_result", "is_valid_approval"]],
	["hrms_attendance_exception", ["HRMS Attendance Exception", "考勤异常处理", "exception_type", "handling_method", "confirmation_status", "deduct_absence_hours", "red_apple_penalty"]],
	["hrms_apple_reward_record", ["HRMS Apple Reward Record", "苹果树奖惩记录", "green_apples", "red_apples", "reward_amount", "is_valid_approval"]],
	["hrms_monthly_attendance_summary", ["HRMS Monthly Attendance Summary", "月度考勤终稿", "overtime_1_5_hours", "overtime_2_hours", "overtime_3_hours", "adjusted_working_hours", "actual_clock_attendance_hours", "night_shift_allowance", "adjusted_absence_hours"]],
	["hrms_attendance_custom_rule", ["HRMS Attendance Custom Rule", "考勤自定义规则", "rule_code", "rule_group", "trigger_condition", "action_result", "source_document"]],
]) {
	const jsonPath = mustExist(`hrms/hr/doctype/${folder}/${folder}.json`);
	const pyPath = mustExist(`hrms/hr/doctype/${folder}/${folder}.py`);
	const json = fs.readFileSync(jsonPath, "utf8");
	const py = fs.readFileSync(pyPath, "utf8");
	for (const marker of titleMarkers) {
		mustInclude(json, marker, `${folder} DocType is missing marker: ${marker}`);
	}
	mustInclude(py, "Document", `${folder} controller must extend Document.`);
}

for (const marker of [
	"hrms-attendance-kpi-grid",
	"hrms-attendance-toolbar",
	"出勤0人",
	"打卡记录",
	"补卡记录",
	"请假记录",
	"外出记录",
	"出差记录",
	"加班记录",
	"汇总统计表",
	"异常考勤汇总表",
	"补卡统计表",
	"字段管理",
	"考勤分组",
	"排班管理",
]) {
	mustInclude(attendancePageJs, marker, `Attendance import center layout is missing marker: ${marker}`);
}

const shellJs = read("hrms/public/js/hrms_home_redirect_v6.js");
for (const marker of [
	"attendance-import-center/summary",
	"attendance-import-center/daily",
	"attendance-import-center/monthly",
	"attendance-import-center/reports",
	"attendance-import-center/custom-rules",
	"attendance-import-center/dingtalk",
	"绩效奖惩关联",
	"钉钉打卡对接",
	"query-report/Monthly Attendance Sheet",
]) {
	mustInclude(shellJs, marker, `Unified attendance sidebar is missing marker: ${marker}`);
}

console.log("Attendance workbench contract passed.");
