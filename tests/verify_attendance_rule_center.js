#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "hrms/hr/page/attendance_import_center/attendance_import_center.js"), "utf8");
const css = fs.readFileSync(path.join(root, "hrms/hr/page/attendance_import_center/attendance_import_center.css"), "utf8");
const api = fs.readFileSync(path.join(root, "hrms/api/attendance_processing_center.py"), "utf8");
const attendanceApi = fs.readFileSync(path.join(root, "hrms/api/attendance_import.py"), "utf8");
const shiftRuleSchema = fs.readFileSync(path.join(root, "hrms/hr/doctype/hrms_attendance_shift_rule/hrms_attendance_shift_rule.json"), "utf8");

const requireMarker = (source, marker, message) => {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
};

for (const marker of [
	'if (this.active_view === "processing-rules") return this.load_complete_attendance_rules()',
	'load_complete_attendance_rules()',
	'get_complete_attendance_rules',
	'完整考勤规则中心',
	'一、排班治理规则',
	'二、班次计算规则',
	'三、系统处理边界（只读）',
	'选择班别',
	'返回班别',
	'返回班次',
	'data-edit-selected-rule',
	'special_workday_time_fixed',
	'extended_overtime_mode',
	'overtime_approval_time_mode',
	'overtime_approval_reapply_minutes',
	'系统班次联动',
	'联动计划',
]) requireMarker(page, marker, `Complete rule centre is missing: ${marker}`);

const ruleCentreRender = page.split('render_complete_attendance_rules(data = {}, loading = false, error = "") {')[1]?.split('\n\tbind_complete_attendance_rule_events(')[0];
if (!ruleCentreRender) throw new Error("Complete rule centre render function is missing");
for (const marker of ['scheduling_policies', 'system_boundaries', 'data-add-scheduling-policy', 'data-recheck-rules']) {
	requireMarker(ruleCentreRender, marker, `Complete rule centre is missing governed activation marker: ${marker}`);
}

for (const marker of [
	'.hrms-attendance-rule-center',
	'.hrms-attendance-rule-browser',
	'.hrms-attendance-rule-tiles',
	'.hrms-attendance-rule-detail-grid',
]) requireMarker(css, marker, `Complete rule centre styling is missing: ${marker}`);

for (const marker of [
	'def get_complete_attendance_rules(company: str):',
	'def preview_attendance_shift_match(company: str, shift_name: str, attendance_date: str = ""):',
	'"shift_rules": bundle["items"]',
	'"builtin_shift_rules": _builtin_shift_rule_items()',
	'"shift_group": display_group',
	'"shift_variant": shift_name or "标准班次"',
	'"special_workday_time": special_time',
	'"extended_overtime_mode": extended_mode',
	'"policy_rules": policy_rules',
	'"system_boundaries"',
	'_require_processing_manager()',
]) requireMarker(api, marker, `Complete rule centre API is missing: ${marker}`);

for (const field of ["shift_group", "shift_variant", "special_workday_time", "extended_overtime_mode", "overtime_approval_time_mode", "overtime_approval_reapply_minutes", "manual_override"]) {
	requireMarker(shiftRuleSchema, `"fieldname": "${field}"`, `Rule schema is missing ${field}`);
	requireMarker(api, field, `Rule import/API does not map ${field}`);
}

for (const marker of [
	'"effective_from"',
	'"remarks"',
	'"priority"',
]) requireMarker(attendanceApi, marker, `Policy rule editing is missing field: ${marker}`);

const context = { frappe: { pages: { "attendance-import-center": {} } }, __: (value) => value };
vm.runInNewContext(`${page}\nglobalThis.AttendanceRulePage = AttendanceImportCenter;`, context);
const instance = Object.create(context.AttendanceRulePage.prototype);
instance.escape = (value) => String(value ?? "");
instance.attendance_rule_group = "";
instance.attendance_rule_code = "";
const browser = { innerHTML: "", querySelectorAll: () => [], querySelector: () => null };
instance.body = () => ({ querySelector: (selector) => selector === "[data-rule-browser]" ? browser : null });
const rows = [
	{ name: "RULE-1", rule_code: "SHIFT-001", rule_name: "警卫白班", shift_group: "警卫", shift_variant: "白班", weekday_overtime_mode: "不提交加班单" },
	{ name: "RULE-2", rule_code: "SHIFT-002", rule_name: "警卫夜班", shift_group: "警卫", shift_variant: "夜班", special_workday_time: "17:00-18:00", extended_overtime_mode: "加班单" },
];
instance.render_attendance_rule_browser({ shift_rules: rows });
requireMarker(browser.innerHTML, "警卫", "First level should show the shift group");
if (browser.innerHTML.includes("17:00-18:00")) throw new Error("First level should not show detailed rules");
instance.attendance_rule_group = "警卫";
instance.render_attendance_rule_browser({ shift_rules: rows });
for (const variant of ["白班", "夜班"]) requireMarker(browser.innerHTML, variant, "Second level is missing a variant");
instance.attendance_rule_code = "SHIFT-002";
instance.render_attendance_rule_browser({ shift_rules: rows });
for (const marker of ["17:00-18:00", "固定加班后续是否需申请", "data-edit-selected-rule"]) requireMarker(browser.innerHTML, marker, "Detail should expose editable mapped rule fields");

console.log("Complete attendance rule centre contract passed.");
