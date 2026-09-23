#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(root, "hrms/hr/page/attendance_import_center/attendance_import_center.js"), "utf8");
const css = fs.readFileSync(path.join(root, "hrms/hr/page/attendance_import_center/attendance_import_center.css"), "utf8");
const api = fs.readFileSync(path.join(root, "hrms/api/attendance_processing_center.py"), "utf8");
const attendanceApi = fs.readFileSync(path.join(root, "hrms/api/attendance_import.py"), "utf8");

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
	'三、异常提示与制度规则',
	'四、系统处理边界（只读）',
	'系统班次联动',
	'联动计划',
	'编辑完整规则',
	'按当前规则校验本月',
	'data-toggle-shift-rule',
	'data-edit-policy-rule',
	'data-rule-search',
]) requireMarker(page, marker, `Complete rule centre is missing: ${marker}`);

for (const marker of [
	'.hrms-attendance-rule-center',
	'.hrms-attendance-rule-card',
	'.hrms-attendance-rule-fields',
	'.hrms-attendance-rule-field.is-wide',
]) requireMarker(css, marker, `Complete rule centre styling is missing: ${marker}`);

for (const marker of [
	'def get_complete_attendance_rules(company: str):',
	'"shift_rules": bundle["items"]',
	'"policy_rules": policy_rules',
	'"system_boundaries"',
	'_require_processing_manager()',
]) requireMarker(api, marker, `Complete rule centre API is missing: ${marker}`);

for (const marker of [
	'"effective_from"',
	'"remarks"',
	'"priority"',
]) requireMarker(attendanceApi, marker, `Policy rule editing is missing field: ${marker}`);

console.log("Complete attendance rule centre contract passed.");
