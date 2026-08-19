"""Contracts for the single-result DingTalk attendance-draft processor."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROCESSOR_PATH = PROJECT_ROOT / "hrms" / "api" / "attendance_processors" / "attendance_draft.py"
REAL_WORKBOOK = Path("/Users/lrj/Desktop/薪酬计算设计表单/考勤数据/1.考勤初稿.xlsx")


def _processor():
	spec = importlib.util.spec_from_file_location("attendance_draft_processor_contract", PROCESSOR_PATH)
	module = importlib.util.module_from_spec(spec)
	sys.modules[spec.name] = module
	spec.loader.exec_module(module)
	return module


processor = _processor()


class AttendanceDraftProcessorContractTest(unittest.TestCase):
	def test_structure_and_single_employee_result_contract(self):
		rows = [
			{
				"姓名": "张三",
				"工号": "E-001",
				"日期": "26-06-01 星期一",
				"实际部门": "工程课",
				"班次": "白班",
				"标准工时": "8",
				"实际出勤（小时）": "7.5",
				"工作日加班（小时）": "1",
				"source_file": "sample.xlsx",
				"source_sheet": "每日明细（钉钉导出）",
				"source_row": 3,
			},
			{
				"姓名": "张三",
				"工号": "E-001",
				"日期": "26-06-02 星期二",
				"实际部门": "工程课",
				"班次": "白班",
				"标准工时": 8,
				"实际出勤（小时）": 8,
				"工作日加班（小时）": 0.5,
				"source_file": "sample.xlsx",
				"source_sheet": "每日明细（钉钉导出）",
				"source_row": 4,
			},
		]
		result = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")

		self.assertEqual(result["status"], "待确认")
		self.assertEqual(result["metrics"]["source_rows"], 2)
		self.assertEqual(result["metrics"]["processed_rows"], 1)
		row = result["processed_rows"][0]
		self.assertEqual(row["source_type"], "attendance_draft")
		self.assertEqual(row["employee_code"], "E-001")
		self.assertEqual(row["processed_value"]["standard_hours"], 16)
		self.assertEqual(row["processed_value"]["actual_attendance_hours"], 15.5)
		self.assertEqual(row["processed_value"]["workday_overtime_hours"], 1.5)
		self.assertEqual(row["review_status"], "无需审核")
		self.assertTrue(row["eligible_for_downstream"])
		self.assertEqual(row["source_row"], 3)
		self.assertEqual(len(row["original_value"]["source_rows"]), 2)
		self.assertEqual([item["attendance_date"] for item in row["processed_value"]["attendance_details"]], ["2026-06-01", "2026-06-02"])

	def test_duplicate_dates_and_identity_conflicts_enter_review_without_loss(self):
		rows = [
			{"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "实际部门": "工程课", "班次": "白班", "标准工时": 8, "source_file": "a.xlsx", "source_sheet": "每日明细（钉钉导出）", "source_row": 3},
			{"姓名": "李四", "工号": "E-001", "日期": "26-06-01", "实际部门": "品质课", "班次": "", "标准工时": "bad", "source_file": "a.xlsx", "source_sheet": "每日明细（钉钉导出）", "source_row": 4},
		]
		result = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")

		self.assertEqual(result["metrics"]["processed_rows"], 1)
		self.assertEqual(result["metrics"]["source_rows"], 2)
		row = result["processed_rows"][0]
		self.assertEqual(row["review_status"], "待审核")
		self.assertFalse(row["eligible_for_downstream"])
		self.assertTrue({"ATTENDANCE_DATE_DUPLICATE", "EMPLOYEE_CODE_NAME_CONFLICT", "EMPLOYEE_DEPARTMENT_CONFLICT", "SHIFT_MISSING", "INVALID_NUMERIC_VALUE"}.issubset(row["exception_codes"]))

	def test_explicit_dingtalk_missing_punch_counts_enter_the_shared_review_queue(self):
		rows = [{
			"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "实际部门": "工程课", "班次": "白班",
			"标准工时": 8, "上班时间": "08:01", "下班时间": "17:30", "上班未打卡次数": 1, "下班未打卡次数": 2,
			"source_file": "sample.xlsx", "source_sheet": "每日明细（钉钉导出）", "source_row": 3,
		}]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")["processed_rows"][0]

		self.assertEqual(row["processed_value"]["clock_in_missing_count"], 1)
		self.assertEqual(row["processed_value"]["clock_out_missing_count"], 2)
		self.assertTrue({"CLOCK_IN_MISSING", "CLOCK_OUT_MISSING"}.issubset(row["exception_codes"]))
		self.assertEqual(row["review_status"], "待审核")
		self.assertFalse(row["eligible_for_downstream"])
		self.assertEqual(row["processed_value"]["attendance_details"], [{"attendance_date": "2026-06-01", "shift": "白班", "clock_in": "08:01", "clock_out": "17:30", "clock_in_missing": 1, "clock_out_missing": 2, "source_row": 3}])

	def test_large_night_shift_uses_configured_cross_day_time_window(self):
		rows = [
			{
				"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "实际部门": "工程课", "班次": "夜班", "标准工时": 8,
				"上班时间": "20:05", "下班时间": "07:58", "大夜班": 9,
				"source_file": "sample.xlsx", "source_sheet": "每日明细（钉钉导出）", "source_row": 3,
			},
			{
				"姓名": "张三", "工号": "E-001", "日期": "26-06-02", "实际部门": "工程课", "班次": "夜班", "标准工时": 8,
				"上班时间": "20:05", "大夜班": 1,
				"source_file": "sample.xlsx", "source_sheet": "每日明细（钉钉导出）", "source_row": 4,
			},
		]
		row = processor.process_attendance_draft_rows(
			rows,
			attendance_month="2026-06",
			night_shift_rule={"large_night_shift_start": "20:00", "large_night_shift_end": "08:00"},
		)["processed_rows"][0]

		# The complete DingTalk record is matched as one large night shift instead
		# of trusting its wrong source total.  The incomplete record keeps its
		# already confirmed source count.
		self.assertEqual(row["processed_value"]["large_night_shifts"], 2)
		self.assertEqual(row["processed_value"]["night_shift_matching"]["matched_large_night_shifts"], 1)

	def test_department_group_and_section_suffixes_are_the_same_department(self):
		rows = [{
			"姓名": "朱耀辉", "工号": "164", "日期": "26-06-01", "实际部门": "设备组", "班次": "白班", "标准工时": 8,
			"source_file": "sample.xlsx", "source_sheet": "每日明细（钉钉导出）", "source_row": 3,
		}]
		roster = [{"employee_code": "164", "employee_name": "朱耀辉", "department": "设备课"}]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-06", employee_directory=roster)["processed_rows"][0]

		self.assertNotIn("EMPLOYEE_DEPARTMENT_MISMATCH", row["exception_codes"])
		self.assertEqual(row["review_status"], "无需审核")
		self.assertTrue(row["eligible_for_downstream"])

	def test_dingtalk_department_identifier_is_removed_before_matching_and_display(self):
		rows = [{
			"姓名": "朱耀辉", "工号": "164", "日期": "26-06-01", "实际部门": "工程课 - 11", "班次": "白班", "标准工时": 8,
			"source_file": "sample.xlsx", "source_sheet": "每日明细（钉钉导出）", "source_row": 3,
		}]
		roster = [{"employee_code": "164", "employee_name": "朱耀辉", "department": "工程课"}]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-06", employee_directory=roster)["processed_rows"][0]

		self.assertNotIn("EMPLOYEE_DEPARTMENT_MISMATCH", row["exception_codes"])
		self.assertEqual(row["department"], "工程课")
		self.assertEqual(row["processed_value"]["department"], "工程课")

	@unittest.skipUnless(REAL_WORKBOOK.exists(), "Local real DingTalk sample is unavailable")
	def test_real_dingtalk_sample_has_5820_source_rows_and_194_employee_results(self):
		from openpyxl import load_workbook

		book = load_workbook(REAL_WORKBOOK, data_only=True, read_only=True)
		rows = processor.rows_from_dingtalk_daily_sheet(book["每日明细（钉钉导出）"], source_file=str(REAL_WORKBOOK))
		result = processor.process_attendance_draft_rows(rows, attendance_month="2026-06", source_file=str(REAL_WORKBOOK))

		self.assertEqual(result["metrics"]["source_rows"], 5820)
		self.assertEqual(result["metrics"]["processed_rows"], 194)
		yang_bo = next(row for row in result["processed_rows"] if row["employee_code"] == "946")
		self.assertEqual(yang_bo["processed_value"]["standard_hours"], 168)
		self.assertEqual(yang_bo["processed_value"]["actual_attendance_hours"], 156.5)
		self.assertEqual(yang_bo["processed_value"]["workday_overtime_hours"], 28)
		self.assertEqual(yang_bo["processed_value"]["restday_overtime_hours"], 9)
		self.assertEqual(yang_bo["processed_value"]["annual_leave_hours"], 8)
		self.assertGreater(result["metrics"]["exception_rows"], 0)


if __name__ == "__main__":
	unittest.main()
