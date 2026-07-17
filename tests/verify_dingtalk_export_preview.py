#!/usr/bin/env python3
"""Phase 1 contract for previewing the real DingTalk attendance export.

The test intentionally loads the user-provided workbook read-only. It stubs
only Frappe's import-time helpers, so exercising the parser cannot write data.
"""

from __future__ import annotations

import importlib.util
import sys
import types
from datetime import datetime
from pathlib import Path

try:
	from openpyxl import load_workbook
except ModuleNotFoundError:
	load_workbook = None


PROJECT_ROOT = Path(__file__).resolve().parents[1]
API_PATH = PROJECT_ROOT / "hrms" / "api" / "attendance_import.py"
REAL_EXPORT = Path("/Users/lrj/Desktop/考勤表.xlsx")
COMPANY_WORKBOOK = Path("/Users/lrj/Documents/SAD/YOngxin/人资/副本人资系统沟通表260713.xlsx")


def _skip_reason() -> str | None:
	if load_workbook is None:
		return "Skipping DingTalk export preview contract: install openpyxl to load workbook fixtures."
	if not REAL_EXPORT.exists():
		return f"Skipping DingTalk export preview contract: missing real DingTalk fixture {REAL_EXPORT}"
	if not COMPANY_WORKBOOK.exists():
		return f"Skipping DingTalk export preview contract: missing company workbook fixture {COMPANY_WORKBOOK}"
	return None


if "pytest" in sys.modules and (reason := _skip_reason()):
	import pytest

	pytest.skip(reason, allow_module_level=True)


def load_attendance_module():
	frappe = types.ModuleType("frappe")
	frappe._ = lambda value: value
	def whitelist(function=None):
		return function if function is not None else lambda decorated: decorated

	frappe.whitelist = whitelist
	frappe.throw = lambda message: (_ for _ in ()).throw(RuntimeError(message))
	frappe.db = types.SimpleNamespace()
	frappe.get_doc = lambda *_args, **_kwargs: None

	utils = types.ModuleType("frappe.utils")
	utils.flt = lambda value: float(value or 0)
	utils.getdate = lambda value: datetime.fromisoformat(str(value)).date()
	utils.now_datetime = datetime.now

	sys.modules["frappe"] = frappe
	sys.modules["frappe.utils"] = utils
	spec = importlib.util.spec_from_file_location("attendance_import_preview_contract", API_PATH)
	module = importlib.util.module_from_spec(spec)
	sys.modules[spec.name] = module
	spec.loader.exec_module(module)
	return module


def test_preview_real_dingtalk_export():
	module = load_attendance_module()
	workbook = load_workbook(REAL_EXPORT, data_only=True, read_only=True)
	preview = module._preview_dingtalk_export_v1(workbook)

	assert preview["source_type"] == "dingtalk_export_v1"
	assert preview["missing_sheets"] == []
	assert preview["record_counts"] == {
		"daily_statistics": 3029,
		"raw_records": 4058,
		"monthly_people": 233,
	}
	assert "请假/事假(小时)" in preview["field_mapping"]
	assert preview["database_writes"] == 0
	warnings = {warning["code"]: warning["count"] for warning in preview["quality_warnings"]}
	assert warnings["missing_employee_code"] == 299
	assert warnings["missing_attendance_group"] == 299
	assert warnings["planned_hours_without_actual"] == 544
	assert warnings["duplicate_userid_workdate"] == 0


def test_preview_company_workbook_preserves_raw_and_manual_daily_sources():
	module = load_attendance_module()
	workbook = load_workbook(COMPANY_WORKBOOK, data_only=True, read_only=True)
	preview = module._preview_company_attendance_workbook(workbook)

	assert preview["source_type"] == "company_attendance_workbook_v1"
	assert preview["database_writes"] == 0
	assert preview["daily_sources"]["dingtalk_raw"]["sheet_name"] == "每日统计（钉钉导出）"
	assert preview["daily_sources"]["dingtalk_raw"]["header_rows"] == [3, 4]
	assert preview["daily_sources"]["dingtalk_raw"]["data_start_row"] == 5
	assert preview["daily_sources"]["manual_adjustment"]["sheet_name"] == "每日统计（修改后）"
	assert preview["daily_sources"]["manual_adjustment"]["header_rows"] == [1, 2]
	assert preview["daily_sources"]["manual_adjustment"]["data_start_row"] == 3
	assert "UserId" in preview["daily_sources"]["dingtalk_raw"]["headers"]
	assert "UserId" not in preview["daily_sources"]["manual_adjustment"]["headers"]
	assert "请假/事假(小时)" in preview["daily_sources"]["dingtalk_raw"]["field_mapping"]
	assert "日期类型" in preview["daily_sources"]["dingtalk_raw"]["field_mapping"]
	assert "上班缺卡" in preview["daily_sources"]["dingtalk_raw"]["field_mapping"]
	for field in ("请假/旷工(小时)", "请假/公假(天)", "请假/产假(天)", "请假/团圆假(天)"):
		assert field in preview["daily_sources"]["dingtalk_raw"]["field_mapping"]


def test_monthly_scope_uses_company_month_and_lock_version():
	module = load_attendance_module()
	assert module._attendance_scope_filters("Company A", "2026-07", "2") == {
		"company": "Company A",
		"attendance_month": "2026-07",
		"attendance_lock_version": "2",
	}


def test_real_dingtalk_export_has_a_daily_statistics_import_path():
	module = load_attendance_module()
	assert module._dingtalk_export_import_source_kind() == "钉钉原始导出"


def test_manual_adjustment_takes_precedence_without_deleting_raw_source():
	module = load_attendance_module()
	raw = types.SimpleNamespace(employee_code="E-001", employee_name="张三", attendance_date="2026-07-01", source_kind="钉钉原始导出")
	manual = types.SimpleNamespace(employee_code="E-001", employee_name="张三", attendance_date="2026-07-01", source_kind="人工调整")
	other = types.SimpleNamespace(employee_code="E-002", employee_name="李四", attendance_date="2026-07-01", source_kind="钉钉原始导出")

	effective = module._prefer_manual_daily_rows([raw, manual, other])
	assert manual in effective
	assert raw not in effective
	assert other in effective


def test_newer_correction_version_takes_precedence_over_older_manual_adjustment():
	module = load_attendance_module()
	manual_v1 = types.SimpleNamespace(employee_code="E-001", employee_name="张三", attendance_date="2026-07-01", source_kind="人工调整", correction_version=1)
	correction_v2 = types.SimpleNamespace(employee_code="E-001", employee_name="张三", attendance_date="2026-07-01", source_kind="钉钉原始导出", correction_version=2)

	effective = module._prefer_manual_daily_rows([manual_v1, correction_v2])
	assert effective == [correction_v2]


if __name__ == "__main__":
	if reason := _skip_reason():
		print(reason)
		raise SystemExit(0)
	test_preview_real_dingtalk_export()
	test_preview_company_workbook_preserves_raw_and_manual_daily_sources()
	test_monthly_scope_uses_company_month_and_lock_version()
	test_real_dingtalk_export_has_a_daily_statistics_import_path()
	test_manual_adjustment_takes_precedence_without_deleting_raw_source()
	test_newer_correction_version_takes_precedence_over_older_manual_adjustment()
	print("DingTalk export preview contract passed.")
