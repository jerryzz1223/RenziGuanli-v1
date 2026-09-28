"""Focused regressions from the reviewed August 2026 attendance workbook."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROCESSOR_PATH = PROJECT_ROOT / "hrms" / "api" / "attendance_processors" / "attendance_draft.py"
spec = importlib.util.spec_from_file_location("attendance_august_regressions", PROCESSOR_PATH)
processor = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = processor
assert spec and spec.loader
spec.loader.exec_module(processor)


def _row(overrides=None, **named):
	row = {
		"姓名": "测试员工", "工号": "T-001", "日期": "26-08-03", "日期类型": "工作日",
		"实际部门": "测试课", "班次": "间接长白班 08:00-17:00", "标准工时": 8,
		"实际出勤（小时）": 8, "上班时间": "08:00", "下班时间": "17:00",
		"工作日加班（小时）": 0, "休息日加班（小时）": 0, "关联审批单": "",
		"source_file": "august-reviewed.xlsx", "source_row": 5,
	}
	row.update(overrides or {})
	row.update(named)
	return row


def _codes(row):
	result = processor.process_attendance_draft_rows([row], attendance_month="2026-08")
	return set(result["processed_rows"][0]["exception_codes"])


class AugustAttendanceRegressionTest(unittest.TestCase):
	def test_reviewed_missing_anomalies_are_detected(self):
		cases = (
			(_row({"工号": "52", "日期": "26-08-11", "上班时间": "07:45", "下班时间": "19:26",
				"工作日加班（小时）": 1, "关联审批单": "加班08-11 18:00到08-11 20:18 2小时"}),
				"WORKDAY_OVERTIME_APPROVAL_MISMATCH"),
			(_row({"工号": "2433", "日期": "26-08-15", "日期类型": "周末休息日", "班次": "休息",
				"标准工时": 0, "实际出勤（小时）": 0, "上班时间": "19:51", "下班时间": ""}), "CLOCK_OUT_MISSING"),
			(_row(工号="2489", 上班时间="08:15", 下班时间="17:04",
				关联审批单="事假08-03 08:00到08-03 08:30 0.5小时"), "LEAVE_PUNCH_APPROVAL_MISMATCH"),
			(_row({"工号": "260509", "日期": "26-08-24", "班次": "生产白班 08:00-16:30", "上班时间": "08:01",
				"下班时间": "", "关联审批单": "排休08-24 08:00到08-24 16:30 8小时"}), "LEAVE_PUNCH_APPROVAL_MISMATCH"),
			(_row({"工号": "3858", "日期": "26-08-11", "班次": "中班 13:00-22:00", "上班时间": "12:48",
				"下班时间": "20:26", "实际出勤（小时）": 6, "关联审批单": "事假08-11 20:15到08-11 22:00 2小时"}),
				"LEAVE_PUNCH_APPROVAL_MISMATCH"),
			(_row({"工号": "87", "日期": "26-08-02", "日期类型": "周末休息日", "班次": "休息", "标准工时": 0,
				"实际出勤（小时）": 0, "上班时间": "20:15", "下班时间": "",
				"关联审批单": "加班08-02 08:00到08-02 20:00 10小时"}), "RESTDAY_PUNCH_APPROVAL_MISMATCH"),
		)
		for row, expected in cases:
			with self.subTest(code=row["工号"], expected=expected):
				self.assertIn(expected, _codes(row))

	def test_reviewed_false_positives_stay_out_of_exception_queue(self):
		cases = (
			_row({"工号": "164", "日期": "26-08-09", "日期类型": "周末休息日", "班次": "休息", "标准工时": 0,
				"实际出勤（小时）": 0, "上班时间": "13:52", "下班时间": "14:23"}),
			_row({"工号": "260624", "日期": "26-08-10", "班次": "生产夜班 20:00-次日04:30", "实际出勤（小时）": 0,
				"上班时间": "", "下班时间": "", "旷工": 1, "旷工(小时)": 8}),
			_row({"工号": "260501", "日期": "26-08-07", "实际出勤（小时）": 0, "上班时间": "", "下班时间": "",
				"请假/事假(小时)": 7.5, "关联审批单": "事假08-03 08:00到08-07 17:00 40小时"}),
			_row({"工号": "4047", "日期": "26-08-24", "实际出勤（小时）": 1, "上班时间": "07:43", "下班时间": "09:00",
				"请假/病假(小时)": 7, "早退次数": 1, "关联审批单": "病假08-24 09:00到08-24 17:00 7小时"}),
			_row({"工号": "3689", "日期": "26-08-10", "班次": "药水分析组 10:00-20:00", "实际出勤（小时）": 5.5,
				"上班时间": "10:11", "下班时间": "17:06", "请假/排休(小时)": 2, "迟到次数": 1,
				"关联审批单": "排休08-10 17:00到08-10 20:00 2小时"}),
		)
		for row in cases:
			with self.subTest(code=row["工号"]):
				self.assertEqual(_codes(row), set())

	def test_three_future_hires_exclude_all_63_august_workdays(self):
		days = (3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 17, 18, 19, 20, 21, 24, 25, 26, 27, 28, 31)
		people = (("260905", "李卫明"), ("260906", "宋富有"), ("260907", "齐闻琪"))
		rows = [
			_row({"工号": code, "姓名": name, "日期": f"26-08-{day:02d}", "班次": "", "上班时间": "", "下班时间": "",
				"标准工时": 8, "实际出勤（小时）": 0, "source_row": index + 5})
			for index, (code, name, day) in enumerate((code, name, day) for code, name in people for day in days)
		]
		directory = [
			{"employee_code": code, "employee_name": name, "date_of_joining": "2026-09-01"}
			for code, name in people
		]
		result = processor.process_attendance_draft_rows(
			rows, attendance_month="2026-08", employee_directory=directory,
		)
		self.assertEqual(len(rows), 63)
		self.assertEqual(result["processed_rows"], [])
		self.assertEqual(result["data_quality"]["excluded_future_joining_rows"], 63)
		self.assertEqual(result["metrics"]["exception_rows"], 0)

	def test_unmatched_employee_blank_month_is_not_an_employee_exception(self):
		rows = [
			_row({"工号": "260905", "姓名": "李卫明", "日期": f"26-08-{day:02d}", "班次": "",
				"上班时间": "", "下班时间": "", "实际出勤（小时）": 0,
				"上班缺卡": 1, "下班缺卡": 1, "旷工": 1, "source_row": 1168 + index})
			for index, day in enumerate((17, 18, 19, 20))
		]
		result = processor.process_attendance_draft_rows(rows, attendance_month="2026-08", employee_directory=[
			{"employee_code": "OTHER", "employee_name": "在册员工"},
		])
		self.assertEqual(result["processed_rows"], [])
		self.assertEqual(result["metrics"]["excluded_unmatched_blank_rows"], 4)
		self.assertEqual(result["metrics"]["eligible_employee_source_rows"], 0)
		self.assertEqual(result["data_quality"]["excluded_unmatched_blank_employee_codes"], ["260905"])

	def test_unmatched_employee_with_attendance_evidence_keeps_identity_review(self):
		evidence_cases = (
			{"上班时间": "08:01"},
			{"关联审批单": "事假08-17 08:00到08-17 17:00 8小时"},
			{"请假/事假(小时)": 8},
			{"工作日加班（小时）": 1},
			{"实际出勤（小时）": 1},
		)
		for evidence in evidence_cases:
			with self.subTest(evidence=evidence):
				row = _row({"工号": "260905", "姓名": "李卫明", "日期": "26-08-17", "班次": "",
					"上班时间": "", "下班时间": "", "实际出勤（小时）": 0, **evidence})
				result = processor.process_attendance_draft_rows([row], attendance_month="2026-08", employee_directory=[
					{"employee_code": "OTHER", "employee_name": "在册员工"},
				])
				self.assertEqual(result["metrics"]["excluded_unmatched_blank_rows"], 0)
				self.assertIn("EMPLOYEE_NOT_FOUND", result["processed_rows"][0]["exception_codes"])
				self.assertEqual(result["processed_rows"][0]["source_id"], "260905:2026-08")

	def test_unmatched_employee_with_one_punch_keeps_whole_month_for_review(self):
		rows = [
			_row({"工号": "260905", "姓名": "李卫明", "日期": "26-08-17", "上班时间": "", "下班时间": "", "实际出勤（小时）": 0}),
			_row({"工号": "260905", "姓名": "李卫明", "日期": "26-08-18", "上班时间": "08:01", "下班时间": "", "实际出勤（小时）": 0}),
		]
		result = processor.process_attendance_draft_rows(rows, attendance_month="2026-08", employee_directory=[])
		self.assertEqual(result["metrics"]["excluded_unmatched_blank_rows"], 0)
		self.assertEqual(result["metrics"]["eligible_employee_source_rows"], 2)
		self.assertIn("EMPLOYEE_NOT_FOUND", result["processed_rows"][0]["exception_codes"])

	def test_weekend_single_punch_detects_the_missing_side(self):
		base = {
			"日期": "26-08-09", "日期类型": "周末休息日", "班次": "休息",
			"标准工时": 0, "实际出勤（小时）": 0, "休息日加班（小时）": 0,
		}
		self.assertIn("CLOCK_OUT_MISSING", _codes(_row({**base, "上班时间": "12:00", "下班时间": ""})))
		self.assertIn("CLOCK_IN_MISSING", _codes(_row({**base, "上班时间": "", "下班时间": "12:30"})))
		self.assertNotIn("CLOCK_IN_MISSING", _codes(_row({**base, "上班时间": "12:00", "下班时间": "12:30"})))
		self.assertNotIn("CLOCK_OUT_MISSING", _codes(_row({**base, "上班时间": "12:00", "下班时间": "12:30"})))


if __name__ == "__main__":
	unittest.main()
