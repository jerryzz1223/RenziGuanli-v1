"""The administrator's per-export XLSX watermark choices."""

import json

import frappe


# Keys are stable identifiers for export entry points, not filenames (which vary by month).
EXPORTS = (
	("roster", "人事 · 花名册导出", True),
	("employee_report", "人事 · 员工报表", True),
	("roster_failed", "人事 · 花名册导入失败明细", True),
	("roster_template", "人事 · 花名册导入模板", True),
	("separation", "人事 · 离职记录", False),
	("support_template", "人事 · 跨部门支援模板", True),
	("organization_chart", "组织 · 架构图 Excel", True),
	("organization_configuration", "组织 · 配置导出（可再次导入）", False),
	("announcement_directory", "公告 · 目录导出", False),
	("announcement_template", "公告 · 公告 Excel 模板", False),
	("attendance_template", "考勤 · 导入模板", True),
	("attendance_export_company_attendance_workbook", "考勤 · 公司考勤工作簿", True),
	("attendance_export_daily_statistics", "考勤 · 每日统计", True),
	("attendance_export_attendance_detail", "考勤 · 出勤明细", True),
	("attendance_export_leave_evidence", "考勤 · 请假单", True),
	("attendance_export_attendance_exception", "考勤 · 出勤异常", True),
	("attendance_export_missing_card", "考勤 · 忘打卡", True),
	("attendance_export_apple_reward", "考勤 · 苹果树", True),
	("attendance_export_monthly_draft", "考勤 · 考勤初稿", True),
	("attendance_export_monthly_signed", "考勤 · 考勤终稿（签字版）", True),
	("attendance_export_monthly_finance", "考勤 · 考勤终稿（财务版）", True),
	("attendance_processing_attendance_draft", "考勤加工 · 考勤初稿结果", True),
	("attendance_processing_apple_tree", "考勤加工 · 苹果树结果", True),
	("attendance_processing_missing_card", "考勤加工 · 忘打卡结果", True),
	("attendance_processing_housing_allowance", "考勤加工 · 住房补贴结果", True),
	("attendance_processing_full_attendance", "考勤加工 · 全勤奖结果", True),
	("attendance_processing_special_hours", "考勤加工 · 特殊工时结果", True),
	("attendance_exceptions", "考勤 · 异常明细", False),
	("attendance_final", "考勤 · 月度终稿", True),
	("attendance_finance", "考勤 · 财务版", True),
	("attendance_first_signed", "考勤 · 一次签字版", True),
	("attendance_second_signed", "考勤 · 第二次员工签字版", True),
	("payroll_formula_template", "薪酬 · 公式导入模板", True),
	("payroll_closure_template", "薪酬 · 数据闭环模板", True),
	("salary_change_template", "薪酬 · 员工调薪模板", True),
	("housing_allowance_template", "薪酬 · 住房补贴模板", True),
	("compensation_register", "薪酬 · 薪资社保台账", True),
	("payroll_signature_personal", "薪酬 · 来源员工签字表", True),
	("payroll_signature_department", "薪酬 · 来源部门汇总表", True),
	("apple_tree", "绩效 · 苹果树统计", False),
	("apple_tree_template", "绩效 · 苹果树历史导入模板", False),
	("training_template", "培训 · 参训员工模板", False),
	("form_import_template", "数据处理 · 表单导入模板", True),
)

EXPORT_DEFAULTS = {key: enabled for key, _, enabled in EXPORTS}
SETTINGS_DEFAULT_KEY = "hrms_export_watermark_settings_v1"


def _read_settings():
	try:
		settings = json.loads(frappe.db.get_default(SETTINGS_DEFAULT_KEY) or "{}")
	except (ValueError, TypeError):
		frappe.throw("Excel 水印设置损坏，请管理员重新保存品牌外观设置。")
	if not isinstance(settings, dict) or not isinstance(settings.get("rules", {}), dict):
		frappe.throw("Excel 水印设置格式不正确，请管理员重新保存品牌外观设置。")
	if any(not isinstance(entry, dict) for entry in settings.get("rules", {}).values()):
		frappe.throw("Excel 水印规则格式不正确，请管理员重新保存品牌外观设置。")
	return settings


def get_export_watermark_options(export_key):
	"""Return choices for a known export; unknown exports remain unmarked."""
	if export_key not in EXPORT_DEFAULTS:
		return {"export": False, "print": False, "text": "", "opacity": 12}
	settings = _read_settings()
	rules = settings.get("rules") or {}
	entry = rules.get(export_key) or {}
	text = settings.get("text") or "永新电子（常熟）有限公司"
	opacity = settings.get("opacity") or 12
	enabled = bool(entry.get("export", EXPORT_DEFAULTS[export_key]))
	return {
		"export": enabled,
		"print": enabled and bool(entry.get("print", False)),
		"text": str(text)[:100],
		"opacity": max(1, min(50, int(opacity))),
	}


@frappe.whitelist()
def get_export_watermark_settings():
	frappe.only_for("System Manager")
	settings = _read_settings()
	text = settings.get("text") or "永新电子（常熟）有限公司"
	opacity = settings.get("opacity") or 12
	rules = settings.get("rules") or {}
	return {
		"text": text,
		"opacity": int(opacity),
		"exports": [
			{"key": key, "label": label, "export": bool((rules.get(key) or {}).get("export", default)),
			 "print": bool((rules.get(key) or {}).get("print", False))}
			for key, label, default in EXPORTS
		],
	}


@frappe.whitelist(methods=["POST"])
def save_export_watermark_settings(text, opacity, exports):
	frappe.only_for("System Manager")
	text = " ".join(str(text or "").split())
	if not text or len(text) > 100:
		frappe.throw("水印内容须为 1 至 100 个字符。")
	try:
		opacity = int(opacity)
	except (TypeError, ValueError):
		frappe.throw("水印深浅须为 1 至 50。")
	if not 1 <= opacity <= 50:
		frappe.throw("水印深浅须为 1 至 50。")
	entries = frappe.parse_json(exports)
	if not isinstance(entries, dict) or set(entries) != set(EXPORT_DEFAULTS):
		frappe.throw("导出项目列表已变化，请刷新后重试。")
	rules = {}
	for key, entry in entries.items():
		if not isinstance(entry, dict) or not isinstance(entry.get("export"), bool) or not isinstance(entry.get("print"), bool):
			frappe.throw("水印开关格式不正确。")
		rules[key] = {"export": entry["export"], "print": entry["export"] and entry["print"]}
	frappe.db.set_default(SETTINGS_DEFAULT_KEY, json.dumps({"text": text, "opacity": opacity, "rules": rules}, ensure_ascii=False))
	return get_export_watermark_settings()
