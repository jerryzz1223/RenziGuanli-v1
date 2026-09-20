from __future__ import annotations

import importlib.util
import io
import sys
import types
import unittest
from pathlib import Path

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
API_PATH = ROOT / "hrms" / "api" / "attendance_processing_center.py"


def load_processing_api():
	frappe = types.ModuleType("frappe")
	frappe._ = lambda value, *args: value
	frappe.whitelist = lambda function=None: function or (lambda decorated: decorated)
	frappe.throw = lambda message, *args, **kwargs: (_ for _ in ()).throw(RuntimeError(message))
	frappe.db = types.SimpleNamespace()
	frappe.get_all = lambda *args, **kwargs: []
	frappe.get_doc = lambda *args, **kwargs: None
	frappe.get_roles = lambda *args, **kwargs: []
	frappe.session = types.SimpleNamespace(user="test@example.com")
	frappe.DoesNotExistError = type("DoesNotExistError", (Exception,), {})
	frappe_utils = types.ModuleType("frappe.utils")
	frappe_utils.cint = lambda value: int(value or 0)
	frappe_utils.flt = lambda value: float(value or 0)
	frappe_utils.getdate = lambda value: __import__("datetime").date.fromisoformat(str(value)[:10])
	frappe_utils.now_datetime = lambda: __import__("datetime").datetime.now()
	file_manager = types.ModuleType("frappe.utils.file_manager")
	export_watermark = types.ModuleType("hrms.utils.export_watermark")
	file_manager.save_file = lambda *args, **kwargs: types.SimpleNamespace(file_url="/private/files/first-signed.xlsx", file_name=args[0])
	export_watermark.save_workbook_with_logo_watermark = lambda book, output: book.save(output)
	frappe_utils.file_manager = file_manager
	hrms = types.ModuleType("hrms")
	hrms.__path__ = [str(ROOT / "hrms")]
	hrms_api = types.ModuleType("hrms.api")
	hrms_api.__path__ = [str(ROOT / "hrms" / "api")]
	hrms_processors = types.ModuleType("hrms.api.attendance_processors")
	hrms_processors.__path__ = [str(ROOT / "hrms" / "api" / "attendance_processors")]
	hrms_utils = types.ModuleType("hrms.utils")
	hrms_utils.__path__ = [str(ROOT / "hrms" / "utils")]
	sys.modules.update({
		"frappe": frappe,
		"frappe.utils": frappe_utils,
		"frappe.utils.file_manager": file_manager,
		"hrms": hrms,
		"hrms.api": hrms_api,
		"hrms.api.attendance_processors": hrms_processors,
		"hrms.utils": hrms_utils,
		"hrms.utils.export_watermark": export_watermark,
	})
	spec = importlib.util.spec_from_file_location("attendance_processing_center_first_signed_test", API_PATH)
	module = importlib.util.module_from_spec(spec)
	sys.modules[spec.name] = module
	spec.loader.exec_module(module)
	return module


class TestAttendanceFirstSignedVersion(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls.api = load_processing_api()

	def test_rows_use_attendance_population_and_keep_missing_card_amount(self):
		api = self.api
		attendance = types.SimpleNamespace(source_type="attendance_draft", company="测试公司")
		missing = types.SimpleNamespace(source_type="missing_card", company="测试公司")
		special = types.SimpleNamespace(source_type="special_hours", company="测试公司", attendance_month="2026-07")
		api._result_rows = lambda batch, *args, **kwargs: (
			[{
				"employee_code": "E-001", "employee_name": "张三", "department": "工程课",
				"eligible_for_downstream": True, "processed_value": {
					"standard_hours": 176, "actual_attendance_hours": 168, "workday_overtime_hours": 2,
				},
			}] if batch.source_type == "attendance_draft" else [{
				"employee_code": "E-001", "employee_name": "张三", "department": "工程课",
				"eligible_for_downstream": True, "processed_value": {"red_apples": 1, "amount": 5},
			}] if batch.source_type == "missing_card" else [{
				"employee_code": "E-001", "employee_name": "张三", "department": "工程课",
				"eligible_for_downstream": True, "processed_value": {"special_hours": 2, "special_hours_days": []},
			}]
		)
		api._special_hours_breakdown = lambda *args, **kwargs: {"special_workday_hours": 2, "special_restday_hours": 0, "special_holiday_hours": 0}
		api._employee_directory = lambda company: [{"employee_code": "E-001", "date_of_joining": "2008-06-16"}]

		rows = api._monthly_first_signed_rows({"attendance_draft": attendance, "missing_card": missing, "special_hours": special})

		self.assertEqual(len(rows), 1)
		self.assertEqual(rows[0]["sequence"], 1)
		self.assertEqual(rows[0]["date_of_joining"], "2008-06-16")
		self.assertEqual(rows[0]["red_apple_amount"], 5)
		self.assertEqual(rows[0]["special_workday_hours"], 2)

	def test_workbook_matches_first_signature_layout(self):
		api = self.api
		captured = {}

		def capture_save(name, content, *args, **kwargs):
			captured["name"] = name
			captured["content"] = content
			return types.SimpleNamespace(file_url="/private/files/first-signed.xlsx", file_name=name)

		api_save_file = sys.modules["frappe.utils.file_manager"].save_file
		sys.modules["frappe.utils.file_manager"].save_file = capture_save
		try:
			daily_row = ["张三", "E-001", "26-07-01 星期三", "工程课", "工作日", "长白班", "08:00", "17:00"] + [None] * 32
			result = api._save_monthly_first_signed_confirmation_file("2026-07", [{
				"sequence": 1, "department": "工程课", "employee_name": "张三", "employee_code": "E-001",
				"date_of_joining": "2008-06-16", "standard_hours": 176, "actual_attendance_hours": 168,
				"special_workday_hours": 2, "workday_overtime_hours": 2, "large_night_shifts": 1, "absence_hours": 0,
			}], [daily_row])
		finally:
			sys.modules["frappe.utils.file_manager"].save_file = api_save_file

		self.assertEqual(result["file_name"], "2026-07_一次签字版.xlsx")
		book = load_workbook(io.BytesIO(captured["content"]), data_only=False)
		self.assertEqual(book.sheetnames, ["每日统计", "工时汇总"])
		daily = book["每日统计"]
		self.assertEqual(daily.freeze_panes, "B3")
		self.assertEqual(daily["A3"].value, "张三")
		self.assertIn("T1:AD1", {str(item) for item in daily.merged_cells.ranges})
		self.assertEqual(daily.max_column, 40)
		sheet = book["工时汇总"]
		self.assertIn("B2:Z2", {str(item) for item in sheet.merged_cells.ranges})
		self.assertIn("I3:K3", {str(item) for item in sheet.merged_cells.ranges})
		self.assertIn("R3:X3", {str(item) for item in sheet.merged_cells.ranges})
		self.assertEqual(sheet.freeze_panes, "C5")
		self.assertEqual(sheet["B2"].value, "7月工时汇总")
		self.assertEqual(sheet["E5"].value, "E-001")
		self.assertEqual(sheet["G5"].value, 176)
		self.assertEqual(sheet["I5"].value, 2)
		self.assertIsNone(sheet["J5"].value)
		self.assertIsNone(sheet["K5"].value)
		self.assertEqual(sheet.max_column, 29)

	def test_second_signed_workbook_matches_supplied_header_contract(self):
		api = self.api
		captured = {}
		file_manager = sys.modules["frappe.utils.file_manager"]
		old_save_file = file_manager.save_file
		file_manager.save_file = lambda name, content, *args, **kwargs: (captured.update(name=name, content=content) or types.SimpleNamespace(file_url="/private/files/second-signed.xlsx", file_name=name))
		try:
			api._save_monthly_signed_confirmation_file("2026-07", [{
				"employee_code": "E-001", "employee_name": "张三", "department": "工程课", "standard_hours": 176,
				"actual_attendance_hours": 168, "reunion_leave_hours": 40, "special_workday_hours": 2,
			}])
		finally:
			file_manager.save_file = old_save_file

		self.assertEqual(captured["name"], "2026-07_第二次员工签字版.xlsx")
		book = load_workbook(io.BytesIO(captured["content"]), data_only=False)
		sheet = book["第二次员工签字版"]
		self.assertIn("D1:BJ1", {str(item) for item in sheet.merged_cells.ranges})
		self.assertIn("J2:K2", {str(item) for item in sheet.merged_cells.ranges})
		self.assertIn("AE2:AG2", {str(item) for item in sheet.merged_cells.ranges})
		self.assertIn("B6:H6", {str(item) for item in sheet.merged_cells.ranges})
		self.assertEqual(sheet["D1"].value, "7月工时奖惩确认表")
		self.assertEqual(sheet["AG3"].value, "团圆假\n工时")
		self.assertEqual(sheet["BJ2"].value, "备注")
		self.assertEqual(sheet["X5"].value, 40)
		self.assertEqual(sheet["AJ5"].value, "=J5+K5")
		self.assertEqual(sheet["AR4"].value, 7)
		self.assertEqual(sheet["BH4"].value, 20)
		self.assertEqual(sheet.freeze_panes, "J4")
		self.assertEqual(sheet["R10"].value, "审核：")
		self.assertEqual(sheet["AS10"].value, "审核：")
		self.assertEqual(sheet["BA10"].value, "复核：")
		self.assertEqual(sheet["BH10"].value, "制表：李微微2026.6.11")


if __name__ == "__main__":
	unittest.main()
