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
const topNavCss = read("hrms/public/css/hrms_top_nav.css");
const hooks = read("hrms/hooks.py");

if (attendancePageJson.name !== "attendance-import-center" || attendancePageJson.title !== "考勤导入中心") {
	throw new Error("Attendance import center page route/title is incorrect.");
}

for (const marker of [
	"frappe.pages[\"attendance-import-center\"]",
	"on_page_show",
	"refresh_from_route",
	"bind_route_events",
	"hrms:route-change",
	"考勤汇总",
	"加工结果",
	"异常处理",
	"数据台账",
	"导入批次",
	"人工调整记录",
	"规则设置",
	"字段映射",
	"部门映射",
	"处理规则",
	"考勤初稿",
	"苹果树",
	"忘打卡",
	"未上传",
	"待加工",
	"format_processing_value(resultValue)",
	"processing_field_label",
	"exception_label_text",
	"exception_detail",
	"处理方案",
	"仅记录处理决定（不改数值）",
	"待处理异常",
	"待确认",
	"已确认",
	"source_file",
	"source_sheet",
	"source_row",
	"source_id",
	"approval_no",
	"get_processing_batch",
	"register_source_file",
	"register_monthly_support_file",
	"process_monthly_support_file",
	"confirm_monthly_support_file",
	"precheck_source_slot",
	"process_source_slot",
	"list_processing_results",
	"export_processing_result",
	"processed_rows",
	"processed_result",
	"考勤初稿加工结果（完整汇总）",
	"忘打卡加工结果（完整明细）",
	"missed_punch_columns()",
	"补卡时间",
	"红苹果金额",
	"下载最新加工结果",
	"加工数据",
	"update_processing_record",
	"bulk_update_processing_records",
	"本类结果已确认",
	"查看/更正记录",
	"该记录已处理；如需更正",
	"confirm_source_result",
	"list_processing_exceptions",
	"list_processing_batches",
	"list_manual_adjustments",
	"generate_monthly_final_files",
	"get_monthly_final_preview",
	"员工签字版",
	"财务版",
	"同一已锁定数据",
	"住房补贴",
	"全勤奖",
	"特殊工时",
	"monthly_support_sources",
	"render_monthly_support_imports",
	"data-monthly-support-upload",
	"data-monthly-support-process",
	"data-monthly-support-exceptions",
	"data-monthly-support-confirm",
	"data-monthly-support-results",
	"data-preview-final",
	"open_monthly_final_preview",
	"monthly_support_columns",
	"特殊工时明细",
	"selected_exception_record_ids",
	"data-exception-record-select",
	"data-select-exception-all",
	"data-bulk-exception-process",
	"请选择一个来源后，可勾选并批量处理异常。",
	"show_bulk_processing_dialog(this.exception_source_filter)",
	"hrms-attendance-monthly-support-grid",
	"来源完备性",
	"锁定快照",
	"exception_codes",
	"exception_message",
	"review_status",
	"proposed_value",
	"confirmed_value",
	"reviewer",
	"reviewed_on",
	"review_note",
	"无需审核",
	"待审核",
	"已通过",
	"已驳回",
	"preview_attendance_workbook",
	"list_attendance_import_templates",
	"create_attendance_import_template_file",
	"download_attendance_template",
	"公司考勤工作簿（推荐）",
	"下载模板",
	"import_attendance_workbook",
	"generate_attendance_exceptions",
	"generate_monthly_attendance_summary",
	"list_attendance_custom_rules",
	"seed_attendance_custom_rules",
	"upsert_attendance_custom_rule",
	"get_attendance_field_mapping_catalog",
	"get_attendance_rule_usage_summary",
	"evaluate_attendance_rules",
	"get_attendance_rule_hits",
	"导入批次管理",
	"撤回最近一次导入",
	"批量删除选中数据",
	"管理导入批次",
	"create_attendance_manual_adjustment",
	"字段映射与导入校验",
	"规则不会自动修改导入数据",
	"运行提示检查",
	"查看命中",
	"打开日核对",
	"人工更正",
	"每日统计、出勤明细、出勤异常和苹果树",
	"旧版三表兼容文件",
	"每日考勤核对",
	"考勤异常处理",
	"部门确认",
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
	"download_attendance_export",
	"show_attendance_export_dialog",
	"来源类型",
	"字段映射",
	"数据质量告警",
	"确认导入每日统计",
	"hrms-attendance-company-context",
	"render_month_control",
	"open_month_picker",
	"data-month-shift",
	"data-open-month-picker",
	"选择处理月份",
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

for (const forbiddenMarker of ["download_exception_workbook", "download_exception_result", "异常结果工作簿"]) {
	if (attendancePageJs.includes(forbiddenMarker)) {
		throw new Error(`Attendance processing must not create a separate exception deliverable: ${forbiddenMarker}`);
	}
}

const attendanceViewGroupsStart = attendancePageJs.indexOf("this.view_groups = [");
const attendanceViewGroupsEnd = attendancePageJs.indexOf("this.view_map =", attendanceViewGroupsStart);
const attendanceViewGroups = attendancePageJs.slice(attendanceViewGroupsStart, attendanceViewGroupsEnd);
for (const [earlier, later] of [["考勤汇总", "异常处理"], ["异常处理", "加工结果"]]) {
	if (attendanceViewGroups.indexOf(earlier) >= attendanceViewGroups.indexOf(later)) {
		throw new Error(`Attendance workflow order must be ${earlier} → ${later}.`);
	}
}
if (attendanceViewGroups.includes("月度终稿")) {
	throw new Error("Monthly finalization must be integrated into 考勤汇总, not exposed as a duplicate sidebar view.");
}
if (attendancePageJs.includes("data-monthly-support-precheck")) {
	throw new Error("Monthly support sources must check structure during processing, without a separate precheck button.");
}
for (const hiddenMarker of ["钉钉打卡对接", "统计首页", "打卡记录", "请假记录", "外出记录", "出差记录", "加班记录", "7S", "KPI"]) {
	if (attendanceViewGroups.includes(hiddenMarker)) {
		throw new Error(`Attendance sidebar must hide legacy marker: ${hiddenMarker}`);
	}
}

for (const legacyRoute of ["summary", "import", "daily", "monthly", "reports", "dingtalk", "sync-logs", "clock-records", "clock-settings", "leave-records", "apple-rules", "seven-s-rules", "kpi-rules"]) {
	mustInclude(attendancePageJs, `\"${legacyRoute}\":`, `Attendance route compatibility is missing for: ${legacyRoute}`);
}

if (attendancePageJs.includes("render_view_sidebar") || attendancePageJs.includes("hrms-attendance-side")) {
	throw new Error("Attendance workbench must use the unified left sidebar, not render a nested sidebar.");
}

if (attendancePageJs.includes("${this.render_workflow_tabs()}")) {
	throw new Error("Attendance workbench must use the unified left sidebar, not render duplicate workflow tabs.");
}

const processingResultsStart = attendancePageJs.indexOf("render_processing_results(rows");
const processingResultsEnd = attendancePageJs.indexOf("\n\trender_processing_selection_cell", processingResultsStart);
const processingResults = attendancePageJs.slice(processingResultsStart, processingResultsEnd);
for (const queueControl of ["data-bulk-process", "data-processing-record-select", "data-edit-processing-record", "data-exception-only"]) {
	if (processingResults.includes(queueControl)) {
		throw new Error(`Processing results must remain read-only; move ${queueControl} to the exception queue.`);
	}
}

const toolbarStart = attendancePageJs.indexOf("render_toolbar() {");
const toolbarEnd = attendancePageJs.indexOf("\n\trender_workflow_tabs()", toolbarStart);
const toolbarSource = attendancePageJs.slice(toolbarStart, toolbarEnd);
for (const removedControl of ["选择表头", "添加报表", "邮件订阅", "编辑分组"]) {
	if (toolbarSource.includes(removedControl)) {
		throw new Error(`Attendance toolbar must not render ${removedControl}.`);
	}
}
if (attendancePageJs.includes('key: "clock-settings"') || attendancePageJs.includes('"clock-settings": "配置钉钉打卡机')) {
	throw new Error("Clock settings must not be exposed as a standalone attendance navigation view.");
}

if (attendancePageJs.includes("forEach((button) => this.open_custom_rule_from_center(button.dataset.editRuleFromCenter))")) {
	throw new Error("Attendance rule details must not open while the rule center is rendering.");
}

mustInclude(
	attendancePageJs,
	'button.addEventListener("click", () => this.open_custom_rule_from_center(button.dataset.editRuleFromCenter))',
	"Attendance rule details must be opened only by an explicit click.",
);

mustInclude(attendancePageJs, "this.import_result = result;", "Attendance import must retain the actual completion result.");
mustInclude(attendancePageJs, "this.preview_result = null;", "Attendance import must clear the pre-import confirmation state after completion.");
mustInclude(attendancePageJs, "文件已有有效导入批次，未重复写入。", "Duplicate imports must not be reported as new writes.");

if (attendancePageJs.includes("dingtalk_export_v1 当前仅支持预览")) {
	throw new Error("DingTalk four-sheet exports must offer a controlled daily-statistics import after preview.");
}

if (!homeRedirectJs.includes('label: "每日导入", route: "/desk/attendance-import-center/daily-import"')) {
	throw new Error("The global attendance sidebar must provide the daily-import route.");
}

for (const marker of ["flex: 0 0 220px", "min-width: 220px", "white-space: nowrap", "text-overflow: ellipsis"]) {
	mustInclude(topNavCss, marker, `Attendance sidebar header layout is missing ${marker}.`);
}

mustInclude(hooks, "/assets/hrms/css/hrms_top_nav.css?v=20260807b", "The sidebar stylesheet cache key must change with its layout.");

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
	"get_attendance_field_mapping_catalog",
	"get_attendance_rule_usage_summary",
	"evaluate_attendance_rules",
	"get_attendance_rule_hits",
	"list_attendance_import_batches",
	"revoke_attendance_import_batch",
	"revoke_latest_attendance_import_batch",
	"bulk_revoke_attendance_import_batches",
	"_attendance_import_batch_impact",
	"SUPPORTED_ATTENDANCE_HINT_RULE_CODES",
	"last_evaluation_summary",
	"create_attendance_manual_adjustment",
	"import_validation",
	"application_mode",
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
	"company_attendance_register_v1",
	"_preview_company_attendance_register_v1",
	"_is_company_attendance_register_v1",
	"list_attendance_import_templates",
	"create_attendance_import_template_file",
	"ATTENDANCE_EXPORT_PROFILES",
	"download_attendance_export",
	"company_attendance_workbook",
	"monthly_draft",
	"monthly_signed",
	"monthly_finance",
	"每日统计",
	"出勤明细",
	"出勤异常",
	"苹果树",
	"_preview_company_attendance_workbook",
	"HRMS Attendance Month Lock",
	"HRMS Attendance Lock Audit",
	"lock_attendance_month",
	"unlock_attendance_month",
	"list_attendance_department_confirmations",
	"review_attendance_department_confirmation",
	"HRMS Attendance Department Confirmation",
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
	["hrms_attendance_day_check", ["company", "source_kind", "source_sheet", "source_row_number", "correction_version", "adjusted_from", "manual_adjustment_reason", "public_leave_hours", "maternity_leave_hours", "reunion_leave_hours"]],
	["hrms_attendance_month_lock", ["HRMS Attendance Month Lock", "company", "attendance_month", "active_version", "status"]],
	["hrms_attendance_lock_audit", ["HRMS Attendance Lock Audit", "company", "attendance_month", "action", "reason", "lock_version"]],
	["hrms_attendance_department_confirmation", ["HRMS Attendance Department Confirmation", "company", "attendance_month", "department", "confirmation_status", "attendance_lock_version"]],
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
	["hrms_attendance_custom_rule", ["HRMS Attendance Custom Rule", "考勤自定义规则", "rule_code", "rule_group", "application_mode", "last_evaluated_on", "last_hit_count", "trigger_condition", "action_result", "source_document"]],
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
	"processing-batch-status",
	"待确认异常",
	"hrms-attendance-source-grid",
	"hrms-attendance-source-card",
	"hrms-attendance-final-grid",
	"hrms-attendance-trace",
]) {
	mustInclude(attendancePageJs, marker, `Attendance import center layout is missing marker: ${marker}`);
}

const shellJs = read("hrms/public/js/hrms_home_redirect_v6.js");
for (const marker of [
	"attendance-import-center/daily-import",
	"attendance-import-center/processing-results",
	"attendance-import-center/exceptions",
	"attendance-import-center/monthly-final",
	"attendance-import-center/import-batches",
	"attendance-import-center/manual-adjustments",
	"attendance-import-center/field-mapping",
	"attendance-import-center/department-mapping",
	"attendance-import-center/processing-rules",
	"考勤处理",
	"数据台账",
	"规则设置",
]) {
	mustInclude(shellJs, marker, `Unified attendance sidebar is missing marker: ${marker}`);
}

const attendanceModuleStart = shellJs.indexOf('label: "考勤"');
const payrollModuleStart = shellJs.indexOf('label: "薪酬"', attendanceModuleStart);
const attendanceModule = shellJs.slice(attendanceModuleStart, payrollModuleStart);
for (const hiddenMarker of ["钉钉打卡对接", "统计首页", "打卡记录", "请假记录", "外出记录", "出差记录", "加班记录", "7S", "KPI"]) {
	if (attendanceModule.includes(hiddenMarker)) {
		throw new Error(`Unified attendance sidebar must hide legacy marker: ${hiddenMarker}`);
	}
}

console.log("Attendance workbench contract passed.");
