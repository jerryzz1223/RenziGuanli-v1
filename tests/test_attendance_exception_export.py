from __future__ import annotations

import importlib.util
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
HELPER_TEST = ROOT / "tests" / "test_attendance_daily_exception_resolution.py"
API_PATH = ROOT / "hrms" / "api" / "attendance_processing_center.py"
PAGE_PATH = ROOT / "hrms" / "hr" / "page" / "attendance_import_center" / "attendance_import_center.js"


def load_processing_center():
	spec = importlib.util.spec_from_file_location("attendance_daily_resolution_test_helpers", HELPER_TEST)
	module = importlib.util.module_from_spec(spec)
	spec.loader.exec_module(module)
	return module.load_processing_center()


class AttendanceExceptionExportTest(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls.module = load_processing_center()

	def test_daily_exception_is_flattened_with_requested_facts_and_zero_values(self):
		record = {
			"record_id": "REC-001", "source_type": "attendance_draft", "source_label": "考勤初稿",
			"employee_code": "YG-001", "employee_name": "张三", "department": "生产课 - 123", "review_status": "待审核",
			"daily_exception_lines": [{
				"attendance_date": "2026-08-03", "exception_codes": ["ATTENDANCE_HOURS_MISMATCH"], "shift": "--",
				"scheduled_start": "", "scheduled_end": "", "clock_in": "", "clock_out": "", "raw_outside_shift_hours": 0,
				"overtime_approval_status": "", "confirmed_overtime_hours": 0, "standard_hours": 8, "actual_attendance_hours": 0,
				"leave_breakdown": {}, "workday_overtime_hours": 0, "restday_overtime_hours": 0, "holiday_overtime_hours": 0,
				"attendance_note": "输入不成立：合计少 8 小时", "source_file": "/private/files/8月考勤.xlsx",
				"source_sheet": "每日统计", "source_row": 1154,
			}],
		}

		rows = self.module._processing_exception_export_rows([record])

		self.assertEqual(len(rows), 1)
		row = rows[0]
		self.assertEqual(row["employee_code"], "YG-001")
		self.assertEqual(row["department"], "生产课")
		self.assertEqual(row["weekday"], "星期一")
		self.assertEqual(row["raw_outside_shift_hours"], 0)
		self.assertEqual(row["overtime_approval_status"], "无申请")
		self.assertEqual(row["confirmed_overtime_hours"], 0)
		self.assertEqual(row["standard_hours"], 8)
		self.assertEqual(row["actual_attendance_hours"], 0)
		self.assertEqual(row["effective_leave"], "无")
		self.assertEqual(row["workday_overtime_hours"], 0)
		self.assertIn("工时合计与标准工时不符", row["exception_reason"])

	def test_workbook_has_filter_freeze_panes_and_all_requested_headers(self):
		rows = [{field: 0 if "hours" in field else "样例" for field, _label, _width in self.module.PROCESSING_EXCEPTION_EXPORT_COLUMNS}]
		book = self.module._build_processing_exception_export_workbook(rows)
		output = BytesIO()
		book.save(output)
		output.seek(0)
		sheet = load_workbook(output)["异常明细"]
		headers = [cell.value for cell in sheet[1]]

		for label in (
			"员工工号", "姓名", "部门", "异常日期", "星期几", "异常原因", "班次", "实际打卡上班", "实际打卡下班",
			"班次外原始时长（小时）", "加班申请状态", "确认计入加班（小时）", "标准工时（小时）",
			"导出实际出勤（小时）", "有效请假", "平日加班（小时）", "休息日加班（小时）", "节假日加班（小时）",
		):
			self.assertIn(label, headers)
		self.assertEqual(headers[headers.index("异常日期") + 1], "星期几")
		self.assertEqual(sheet.freeze_panes, "F2")
		self.assertEqual(sheet.auto_filter.ref, "A1:AF2")

	def test_exception_export_is_saved_without_watermark_media(self):
		book = self.module._build_processing_exception_export_workbook([])
		output = BytesIO()

		self.module._save_processing_exception_export_workbook(book, output)

		with ZipFile(BytesIO(output.getvalue())) as workbook:
			names = workbook.namelist()
			self.assertFalse(any(name.startswith("xl/media/") for name in names))
			self.assertNotIn("xl/media/hrms-yongxin-watermark.png", names)
			for name in names:
				if name.startswith("xl/worksheets/") or name.startswith("xl/worksheets/_rels/"):
					self.assertNotIn(b"picture", workbook.read(name).lower())

	def test_stale_attendance_projection_is_blocked_before_export(self):
		records = [
			{"source_type": "attendance_draft", "attendance_policy_stale": True},
			{"source_type": "apple_tree", "attendance_policy_stale": True},
		]
		with patch.object(self.module.frappe, "throw", side_effect=ValueError, create=True) as throw:
			with self.assertRaises(ValueError):
				self.module._require_current_exception_export_projection(records)

		self.assertIn("按新规则校验本月", throw.call_args.args[0])
		self.assertIn("1 个员工", throw.call_args.args[0])

	def test_current_attendance_projection_can_be_exported(self):
		records = [{"source_type": "attendance_draft", "attendance_policy_stale": False}]
		with patch.object(self.module.frappe, "throw", create=True) as throw:
			self.module._require_current_exception_export_projection(records)

		throw.assert_not_called()

	def test_page_passes_every_visible_filter_and_backend_enforces_export_permission(self):
		page = PAGE_PATH.read_text(encoding="utf-8")
		api = API_PATH.read_text(encoding="utf-8")
		for marker in (
			'data-export-processing-exceptions', 'this.call_processing_api("export_processing_exceptions"',
			'source_type: this.exception_source_filter', 'employee_code: this.exception_employee_code_filter',
			'employee_name: this.exception_employee_name_filter', 'department: this.exception_department_filter',
			'exception_code: this.exception_code_filter', 'processing_status: this.exception_processing_status_filter',
			'sort_field: this.exception_sort_field', 'sort_order: this.exception_sort_order',
		):
			self.assertIn(marker, page)
		self.assertIn('require_hrms_capability("attendance_export", legacy_roles=("HR Manager",))', api)
		self.assertIn('save_file(filename, output.getvalue(), None, None, is_private=1)', api)


if __name__ == "__main__":
	unittest.main()
