"""Contracts for the single-result DingTalk attendance-draft processor."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

try:
	from openpyxl import load_workbook
except ModuleNotFoundError:
	load_workbook = None


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


class _FakeWorksheet:
	def __init__(self, title, rows):
		self.title = title
		self._rows = rows

	def iter_rows(self, min_row=1, max_row=None, values_only=False):
		end = max_row or len(self._rows)
		yield from self._rows[min_row - 1 : end]


class _FakeWorkbook:
	def __init__(self, sheets):
		self.worksheets = sheets


class AttendanceDraftProcessorContractTest(unittest.TestCase):
	def test_daily_statistics_export_is_detected_by_headers_not_worksheet_name(self):
		sheet = _FakeWorksheet("每日统计", [
			("每日统计配置版 统计日期：2026-07-01 至 2026-07-31",),
			("报表生成时间：2026-08-20 09:56",),
			("姓名", "工号", "日期", "实际部门", "班次", "标准工时", "实际出勤（小时）", "请假"),
			("", "", "", "", "", "", "", "事假(小时)"),
			("张三", "E-001", "26-07-01 星期三", "工程课", "白班", 8, 8, 0),
		])

		location = processor.dingtalk_daily_header_location(sheet)
		rows = processor.rows_from_dingtalk_daily_sheet(sheet, source_file="daily.xlsx")

		self.assertEqual(location["header_row"], 3)
		self.assertIs(processor.find_dingtalk_daily_sheet(_FakeWorkbook([sheet])), sheet)
		self.assertEqual(rows[0]["source_row"], 5)
		self.assertEqual(rows[0]["工号"], "E-001")
		self.assertEqual(rows[0]["请假/事假(小时)"], 0)

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
				"事假(小时)": "0.5",
				"工作日加班（小时）": "1",
				"关联审批单": "加班申请 OT-001",
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
				"关联审批单": "加班申请 OT-002",
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

	def test_missing_employee_code_source_accounts_do_not_become_employee_exceptions(self):
		rows = [
			{"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "实际部门": "工程课", "班次": "白班", "标准工时": 8, "source_row": 3},
			{"姓名": "车间二楼放料", "工号": "", "UserId": "station-001", "日期": "26-06-01", "实际部门": "连续课", "班次": "未排班", "source_row": 4},
			{"姓名": "车间二楼放料", "工号": "", "UserId": "station-001", "日期": "26-06-02", "实际部门": "连续课", "班次": "未排班", "source_row": 5},
		]

		result = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")

		self.assertEqual(result["metrics"]["source_rows"], 3)
		self.assertEqual(result["metrics"]["eligible_employee_source_rows"], 1)
		self.assertEqual(result["metrics"]["excluded_missing_employee_code_rows"], 2)
		self.assertEqual(result["metrics"]["excluded_missing_employee_code_accounts"], 1)
		self.assertEqual(result["metrics"]["processed_rows"], 1)
		self.assertEqual(result["processed_rows"][0]["employee_name"], "张三")
		self.assertEqual(result["data_quality"]["excluded_missing_employee_code_accounts"][0]["source_account_name"], "车间二楼放料")

	def test_non_boundary_out_of_month_rows_remain_exceptions(self):
		row = processor.process_attendance_draft_rows(
			[{"姓名": "张三", "工号": "E-001", "日期": "26-08-02", "实际部门": "工程课", "班次": "白班", "source_row": 3}],
			attendance_month="2026-07", source_file="sample.xlsx", source_sheet="每日统计",
		)["processed_rows"][0]

		self.assertIn("ATTENDANCE_MONTH_MISMATCH", row["exception_codes"])
		self.assertEqual(row["review_status"], "待审核")

	def test_next_month_boundary_rows_are_supplemental_and_not_used_or_exceptional(self):
		rows = [
			{"姓名": "张三", "工号": "E-001", "日期": "26-07-31", "实际部门": "工程课", "班次": "生产夜班 20:00-次日08:00", "标准工时": 8, "实际出勤（小时）": 8, "source_row": 3},
			{"姓名": "张三", "工号": "E-001", "日期": "26-08-01", "实际部门": "工程课", "班次": "白班", "标准工时": 8, "实际出勤（小时）": 7, "下班缺卡": 1, "source_row": 4},
		]

		result = processor.process_attendance_draft_rows(
			rows, attendance_month="2026-07", source_file="sample.xlsx", source_sheet="每日统计",
		)
		row = result["processed_rows"][0]

		self.assertEqual(row["processed_value"]["standard_hours"], 8)
		self.assertEqual(row["processed_value"]["actual_attendance_hours"], 8)
		self.assertEqual([detail["attendance_date"] for detail in row["processed_value"]["attendance_details"]], ["2026-07-31"])
		self.assertNotIn("ATTENDANCE_MONTH_MISMATCH", row["exception_codes"])
		self.assertNotIn("CLOCK_OUT_MISSING", row["exception_codes"])
		self.assertEqual(row["review_status"], "无需审核")
		self.assertTrue(row["eligible_for_downstream"])
		self.assertEqual(result["data_quality"]["supplemental_out_of_month_rows"], 1)
		self.assertEqual(result["data_quality"]["supplemental_out_of_month_dates"], ["2026-08-01"])
		self.assertEqual(result["metrics"]["eligible_employee_source_rows"], 1)
		self.assertEqual(result["metrics"]["boundary_restday_review_rows"], 0)

	def test_next_month_boundary_restday_punch_is_reviewed_without_changing_month_totals(self):
		rows = [
			{"姓名": "林欣雨", "工号": "260614", "日期": "26-07-31", "日期类型": "工作日", "实际部门": "总办室", "班次": "间接长白班 08:00-17:00", "标准工时": 8, "实际出勤（小时）": 8, "上班时间": "07:53", "下班时间": "17:05", "source_row": 6691},
			{"姓名": "林欣雨", "工号": "260614", "日期": "26-08-01", "日期类型": "周末休息日", "实际部门": "总办室", "班次": "休息", "标准工时": 0, "实际出勤（小时）": 8, "上班时间": "07:51", "下班时间": "17:04", "休息日加班（小时）": 0, "关联审批单": "", "source_row": 6692},
		]

		result = processor.process_attendance_draft_rows(
			rows, attendance_month="2026-07", source_file="sample.xlsx", source_sheet="每日统计",
		)
		row = result["processed_rows"][0]
		values = row["processed_value"]
		detail = values["attendance_details"][1]

		self.assertEqual(values["standard_hours"], 8)
		self.assertEqual(values["actual_attendance_hours"], 8)
		self.assertEqual(values["restday_overtime_hours"], 0)
		self.assertEqual(detail["attendance_date"], "2026-08-01")
		self.assertEqual(detail["source_numbers"]["actual_attendance_hours"], 8)
		self.assertTrue(detail["restday_clocked_without_overtime"])
		self.assertIn("RESTDAY_CLOCKED_WITHOUT_OVERTIME", row["exception_codes"])
		self.assertNotIn("ATTENDANCE_MONTH_MISMATCH", row["exception_codes"])
		self.assertEqual(row["review_status"], "待审核")
		self.assertFalse(row["eligible_for_downstream"])
		self.assertEqual(result["data_quality"]["supplemental_out_of_month_rows"], 1)
		self.assertEqual(result["metrics"]["boundary_restday_review_rows"], 1)

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
		self.assertTrue({"ATTENDANCE_DATE_DUPLICATE", "EMPLOYEE_CODE_NAME_CONFLICT", "EMPLOYEE_DEPARTMENT_CONFLICT", "INVALID_NUMERIC_VALUE"}.issubset(row["exception_codes"]))

	def test_explicit_dingtalk_missing_punch_counts_remain_downstream_attendance_facts(self):
		rows = [{
			"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "实际部门": "工程课", "班次": "白班",
			"标准工时": 8, "实际出勤": 8, "上班时间": "08:01", "下班时间": "17:30", "上班未打卡次数": 1, "下班未打卡次数": 2,
			"source_file": "sample.xlsx", "source_sheet": "每日明细（钉钉导出）", "source_row": 3,
		}]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")["processed_rows"][0]

		self.assertEqual(row["processed_value"]["clock_in_missing_count"], 1)
		self.assertEqual(row["processed_value"]["clock_out_missing_count"], 2)
		self.assertTrue({"CLOCK_IN_MISSING", "CLOCK_OUT_MISSING"}.issubset(row["exception_codes"]))
		self.assertEqual(row["review_status"], "待审核")
		self.assertFalse(row["eligible_for_downstream"])
		self.assertIn("SHIFT_SCHEDULE_REVIEW_REQUIRED", row["exception_codes"])
		self.assertEqual({key: row["processed_value"]["attendance_details"][0][key] for key in ("attendance_date", "shift", "clock_in", "clock_out", "clock_in_missing", "clock_out_missing", "late_count", "early_count", "absence_marker_count", "absence_hours", "source_row")}, {
			"attendance_date": "2026-06-01", "shift": "白班", "clock_in": "08:01", "clock_out": "17:30",
			"clock_in_missing": 1, "clock_out_missing": 2, "late_count": 0, "early_count": 0,
			"absence_marker_count": 0, "absence_hours": 0, "source_row": 3,
		})

	def test_daily_statistics_missing_card_markers_are_source_facts(self):
		rows = [{
			"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "实际部门": "工程课", "班次": "夜班",
			"上班缺卡": "是", "下班缺卡": 1, "source_row": 5,
		}]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")["processed_rows"][0]

		self.assertEqual(row["processed_value"]["clock_in_missing_count"], 1)
		self.assertEqual(row["processed_value"]["clock_out_missing_count"], 1)
		self.assertEqual({key: row["processed_value"]["exception_lines"][0][key] for key in ("attendance_date", "shift", "clock_in", "clock_out", "clock_in_missing", "clock_out_missing", "late_count", "early_count", "absence_marker_count", "absence_hours", "source_row", "exception_codes")}, {
			"attendance_date": "2026-06-01", "shift": "夜班", "clock_in": "", "clock_out": "",
			"clock_in_missing": 1, "clock_out_missing": 1, "late_count": 0, "early_count": 0,
			"absence_marker_count": 0, "absence_hours": 0, "source_row": 5,
			"exception_codes": ["CLOCK_IN_MISSING", "CLOCK_OUT_MISSING"],
		})

	def test_exactly_one_clock_time_creates_the_missing_side_review_event(self):
		rows = [
			{
				"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "实际部门": "工程课", "班次": "白班",
				"上班时间": "08:00", "下班时间": "", "source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 3,
			},
			{
				"姓名": "张三", "工号": "E-001", "日期": "26-06-02", "实际部门": "工程课", "班次": "白班",
				"上班时间": "", "下班时间": "17:00", "source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 4,
			},
		]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")["processed_rows"][0]

		self.assertEqual(row["processed_value"]["clock_in_missing_count"], 1)
		self.assertEqual(row["processed_value"]["clock_out_missing_count"], 1)
		self.assertTrue({"CLOCK_IN_MISSING", "CLOCK_OUT_MISSING"}.issubset(row["exception_codes"]))
		self.assertEqual([(item["attendance_date"], item["exception_codes"]) for item in row["processed_value"]["exception_lines"]], [
			("2026-06-01", ["CLOCK_OUT_MISSING"]),
			("2026-06-02", ["CLOCK_IN_MISSING"]),
		])

	def test_no_clock_times_is_not_mistaken_for_a_single_punch(self):
		rows = [{
			"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "实际部门": "工程课", "班次": "白班",
			"上班时间": "", "下班时间": "", "source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 3,
		}]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")["processed_rows"][0]

		self.assertEqual(row["processed_value"]["clock_in_missing_count"], 0)
		self.assertEqual(row["processed_value"]["clock_out_missing_count"], 0)
		self.assertNotIn("CLOCK_IN_MISSING", row["exception_codes"])
		self.assertNotIn("CLOCK_OUT_MISSING", row["exception_codes"])

	def test_daily_attendance_facts_stay_downstream_and_workday_absence_becomes_payroll_hours(self):
		rows = [
			{"姓名": "张三", "工号": "E-001", "日期": "26-06-07", "日期类型": "周末休息日", "实际部门": "工程课", "班次": "白班", "旷工": 1, "source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 3},
			{"姓名": "张三", "工号": "E-001", "日期": "26-06-08", "日期类型": "工作日", "实际部门": "工程课", "班次": "白班 08:00-17:00", "标准工时": 8, "旷工": 1, "source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 4},
			{"姓名": "张三", "工号": "E-001", "日期": "26-06-09", "日期类型": "工作日", "实际部门": "工程课", "班次": "白班 08:00-17:00", "标准工时": 8, "实际出勤（小时）": 6, "下班时间": "15:00", "早退次数": 1, "source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 5},
			{"姓名": "张三", "工号": "E-001", "日期": "26-06-10", "日期类型": "工作日", "实际部门": "工程课", "班次": "白班 08:00-17:00", "标准工时": 8, "实际出勤（小时）": 7.5, "迟到次数": 1, "source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 6},
		]
		result = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")
		row = result["processed_rows"][0]

		self.assertEqual(row["processed_value"]["late_count"], 1)
		self.assertEqual(row["processed_value"]["early_count"], 1)
		# The Sunday source marker remains auditable but only the Monday marker
		# may enter the processed absence totals.
		self.assertEqual(row["processed_value"]["absence_marker_count"], 1)
		self.assertEqual(row["processed_value"]["absence_hours"], 10)
		self.assertTrue({"CLOCK_IN_MISSING", "LATE_MARKED", "EARLY_MARKED", "ABSENCE_MARKED"}.issubset(row["exception_codes"]))
		self.assertEqual(result["metrics"]["exception_events"], 6)
		self.assertEqual(row["review_status"], "待审核")
		self.assertFalse(row["eligible_for_downstream"])
		self.assertEqual([(event["attendance_date"], event["code"]) for event in row["exception_events"]], [
			("2026-06-08", "ABSENCE_MARKED"),
			("2026-06-09", "CLOCK_IN_MISSING"),
			("2026-06-09", "EARLY_MARKED"),
			("2026-06-10", "LATE_MARKED"),
			("2026-06-10", "SHIFT_SCHEDULE_REVIEW_REQUIRED"),
			("2026-06-10", "ATTENDANCE_HOURS_MISMATCH"),
		])

	def test_rest_day_clock_without_overtime_application_requires_manual_hours_confirmation(self):
		rows = [{
			"姓名": "张三", "工号": "E-001", "日期": "26-06-07", "日期类型": "周末休息日", "实际部门": "工程课",
			"班次": "休息", "上班时间": "09:02", "下班时间": "17:41", "实际出勤（小时）": 0,
			"休息日加班（小时）": 0, "关联审批单": "", "source_row": 3,
		}]

		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")["processed_rows"][0]

		self.assertIn("RESTDAY_CLOCKED_WITHOUT_OVERTIME", row["exception_codes"])
		self.assertEqual(row["review_status"], "待审核")
		self.assertFalse(row["eligible_for_downstream"])
		self.assertEqual(row["exception_events"][0]["code"], "RESTDAY_CLOCKED_WITHOUT_OVERTIME")
		self.assertEqual(row["exception_events"][0]["attendance_date"], "2026-06-07")
		self.assertEqual(row["exception_events"][0]["source_row"], 3)
		self.assertEqual(row["processed_value"]["exception_lines"][0]["restday_overtime_hours"], 0)
		self.assertTrue(row["processed_value"]["exception_lines"][0]["restday_clocked_without_overtime"])

	def test_rest_day_clock_with_overtime_application_does_not_require_manual_confirmation(self):
		rows = [{
			"姓名": "张三", "工号": "E-001", "日期": "26-06-07", "日期类型": "周末休息日", "实际部门": "工程课",
			"班次": "休息", "上班时间": "09:02", "下班时间": "17:41", "休息日加班（小时）": 0,
			"关联审批单": "加班申请 OT-001", "source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 3,
		}]

		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")["processed_rows"][0]

		self.assertNotIn("RESTDAY_CLOCKED_WITHOUT_OVERTIME", row["exception_codes"])
		self.assertEqual(row["review_status"], "无需审核")

	def test_weekend_restday_lunch_window_pair_is_not_overtime_or_an_exception(self):
		for clock_in, clock_out in (("11:31", "13:29"), ("12:05", "12:47")):
			with self.subTest(clock_in=clock_in, clock_out=clock_out):
				row = processor.process_attendance_draft_rows([{
					"姓名": "张袁震", "工号": "E-001", "日期": "26-06-07", "日期类型": "周末休息日",
					"实际部门": "连续课", "班次": "生产白班 08:00-16:30", "标准工时": 0,
					"实际出勤（小时）": 1.5, "上班时间": clock_in, "下班时间": clock_out,
					"休息日加班（小时）": 1.5, "关联审批单": "", "source_file": "sample.xlsx", "source_row": 3,
				}], attendance_month="2026-06")["processed_rows"][0]

				values = row["processed_value"]
				detail = values["attendance_details"][0]
				self.assertEqual(values["restday_overtime_hours"], 0)
				self.assertEqual(values["actual_attendance_hours"], 0)
				self.assertEqual(detail["source_numbers"]["actual_attendance_hours"], 1.5)
				self.assertTrue(detail["weekend_restday_non_overtime_pair"])
				self.assertNotIn("RESTDAY_CLOCKED_WITHOUT_OVERTIME", row["exception_codes"])
				self.assertNotIn("ATTENDANCE_HOURS_MISMATCH", row["exception_codes"])

	def test_weekend_restday_lunch_window_requires_both_punches_inside(self):
		for clock_in, clock_out in (("11:30", "13:29"), ("11:31", "13:30"), ("11:31", "")):
			with self.subTest(clock_in=clock_in, clock_out=clock_out):
				row = processor.process_attendance_draft_rows([{
					"姓名": "张袁震", "工号": "E-001", "日期": "26-06-07", "日期类型": "周末休息日",
					"实际部门": "工程课", "班次": "休息", "上班时间": clock_in, "下班时间": clock_out,
					"休息日加班（小时）": 0, "关联审批单": "", "source_file": "sample.xlsx", "source_row": 3,
				}], attendance_month="2026-06")["processed_rows"][0]

				detail = row["processed_value"]["attendance_details"][0]
				self.assertFalse(detail["weekend_restday_non_overtime_pair"])
				self.assertIn("RESTDAY_CLOCKED_WITHOUT_OVERTIME", row["exception_codes"])

	def test_early_departure_with_leave_evidence_does_not_create_absence_hours(self):
		rows = [{
			"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "日期类型": "工作日", "实际部门": "工程课",
			"班次": "生产夜班 20:00-次日04:30", "标准工时": 8, "实际出勤（小时）": 3.5,
			"下班时间": "次日 00:04", "早退次数": 1, "关联审批单": "事假 4.5小时",
			"source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 3,
		}]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")["processed_rows"][0]

		self.assertEqual(row["processed_value"]["absence_hours"], 0)
		# Approval text is not a numeric duration. Missing daily leave hours must
		# now remain a reconciliation error rather than silently passing.
		self.assertEqual(row["review_status"], "待审核")
		self.assertFalse(row["eligible_for_downstream"])
		self.assertIn("ATTENDANCE_HOURS_MISMATCH", row["exception_codes"])

	def test_historic_attendance_details_restore_only_actual_exception_dates(self):
		lines = processor.exception_lines_from_attendance_details([
			{"attendance_date": "2026-06-01", "early_count": 0, "clock_in_missing": 0, "clock_out_missing": 0, "late_count": 0, "absence_marker_count": 0, "source_row": 3},
			{"attendance_date": "2026-06-02", "early_count": 1, "clock_in_missing": 0, "clock_out_missing": 0, "late_count": 0, "absence_marker_count": 0, "source_row": 4},
			{"attendance_date": "2026-06-03", "early_count": 0, "clock_in_missing": 0, "clock_out_missing": 1, "late_count": 0, "absence_marker_count": 0, "source_row": 5},
		], ["EARLY_MARKED", "CLOCK_OUT_MISSING"])

		self.assertEqual([(line["attendance_date"], line["exception_codes"]) for line in lines], [
			("2026-06-02", ["EARLY_MARKED"]),
			("2026-06-03", ["CLOCK_OUT_MISSING"]),
		])

	def test_one_minute_late_without_leave_is_a_review_event(self):
		rows = [{
			"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "实际部门": "工程课",
			"班次": "白班 08:00-17:00", "标准工时": 8, "上班时间": "08:01", "下班时间": "17:00",
			"source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 3,
		}]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")["processed_rows"][0]

		self.assertEqual(row["processed_value"]["late_count"], 1)
		self.assertIn("LATE_MARKED", row["exception_codes"])
		self.assertEqual(row["processed_value"]["exception_lines"][0]["attendance_date"], "2026-06-01")

	def test_late_within_thirty_minutes_does_not_add_personal_leave(self):
		rows = [{
			"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "实际部门": "工程课",
			"班次": "白班 08:00-17:00", "标准工时": 8, "上班时间": "08:01", "下班时间": "17:00",
			"请假/事假(小时)": 1, "迟到次数": 1, "source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 3,
		}]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")["processed_rows"][0]

		self.assertEqual(row["processed_value"]["late_count"], 1)
		self.assertEqual(row["processed_value"]["personal_leave_hours"], 1)
		self.assertIn("LATE_MARKED", row["exception_codes"])
		self.assertIn("迟到1分钟（半小时以内）", row["processed_value"]["attendance_note"])

	def test_morning_leave_approval_duration_replaces_the_original_late_boundary(self):
		rows = [{
			"姓名": "张三", "工号": "E-001", "日期": "26-07-23", "日期类型": "工作日", "实际部门": "工程课",
			"班次": "间接长白班 08:00-17:00", "标准工时": 8, "实际出勤（小时）": 7,
			"上班时间": "08:47", "下班时间": "17:14", "请假/事假(小时)": 1,
			"关联审批单": "事假07-23 08:00到07-23 09:00 1小时",
			"source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 3,
		}]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-07")["processed_rows"][0]
		values = row["processed_value"]
		detail = values["attendance_details"][0]

		self.assertEqual(values["late_count"], 0)
		self.assertEqual(values["personal_leave_hours"], 1)
		self.assertNotIn("LATE_MARKED", row["exception_codes"])
		self.assertEqual(detail["raw_late_minutes"], 47)
		self.assertEqual(detail["approved_clock_in_leave_hours"], 1)
		self.assertTrue(detail["late_approval_covered"])

	def test_late_duration_keeps_only_the_part_not_covered_by_the_approval(self):
		rows = [{
			"姓名": "张三", "工号": "E-001", "日期": "26-07-29", "日期类型": "工作日", "实际部门": "工程课",
			"班次": "间接长白班 08:00-17:00", "标准工时": 8, "实际出勤（小时）": 7,
			"上班时间": "09:00", "下班时间": "17:00", "请假/事假(小时)": 0.5,
			"关联审批单": "事假07-29 08:00到07-29 08:30 0.5小时，加班07-29 18:00到07-29 20:00 2小时",
			"source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 3,
		}]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-07")["processed_rows"][0]
		values = row["processed_value"]

		self.assertEqual(values["late_count"], 1)
		self.assertEqual(values["personal_leave_hours"], 0.5)
		self.assertIn("LATE_MARKED", row["exception_codes"])
		self.assertEqual(values["attendance_details"][0]["late_minutes"], 30)
		self.assertIn("迟到30分钟（半小时以内）", values["attendance_note"])

	def test_afternoon_leave_approval_does_not_excuse_a_morning_late_punch(self):
		rows = [{
			"姓名": "张三", "工号": "E-001", "日期": "26-07-24", "日期类型": "工作日", "实际部门": "工程课",
			"班次": "间接长白班 08:00-17:00", "标准工时": 8, "实际出勤（小时）": 3.83,
			"上班时间": "08:10", "下班时间": "12:00", "请假/事假(小时)": 4,
			"关联审批单": "事假07-24 13:00到07-24 17:00 4小时",
			"source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 3,
		}]
		values = processor.process_attendance_draft_rows(rows, attendance_month="2026-07")["processed_rows"][0]["processed_value"]

		self.assertEqual(values["late_count"], 1)
		self.assertEqual(values["attendance_details"][0]["approved_clock_in_leave_hours"], 0)
		self.assertEqual(values["attendance_details"][0]["late_minutes"], 10)

	def test_reviewed_late_personal_leave_is_final_total_not_added_twice(self):
		rows = [{
			"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "日期类型": "工作日", "实际部门": "工程课",
			"班次": "白班 08:00-17:00", "标准工时": 8, "上班时间": "08:31", "下班时间": "17:00",
			"请假/事假(小时)": 1.5, "_personal_leave_includes_late": True, "source_row": 3,
		}]
		values = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")["processed_rows"][0]["processed_value"]

		self.assertEqual(values["late_count"], 1)
		self.assertEqual(values["personal_leave_hours"], 1.5)
		self.assertEqual(values["attendance_details"][0]["late_personal_leave_hours"], 0.52)

	def test_late_minute_boundaries_keep_required_notes_and_hours(self):
		rows = []
		for index, minutes in enumerate((1, 29, 30, 31), start=1):
			rows.append({
				"姓名": f"员工{minutes}", "工号": f"E-{minutes:03d}", "日期": "26-06-01", "日期类型": "工作日",
				"实际部门": "工程课", "班次": "白班 08:00-17:00", "标准工时": 8,
				"上班时间": f"08:{minutes:02d}", "下班时间": "17:00", "source_row": index + 2,
			})
		result = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")
		by_code = {row["employee_code"]: row["processed_value"] for row in result["processed_rows"]}

		for minutes in (1, 29, 30, 31):
			values = by_code[f"E-{minutes:03d}"]
			self.assertEqual(values["personal_leave_hours"], round(minutes / 60, 2) if minutes > 30 else 0)
			self.assertIn(f"迟到{minutes}分钟", values["attendance_note"])
			self.assertIn("半小时以内" if minutes <= 30 else "超过半小时", values["attendance_note"])

	def test_scheduled_weekend_shift_uses_shift_and_actual_clock_for_lateness(self):
		rows = [{
			"姓名": "张三", "工号": "E-001", "日期": "26-06-06", "日期类型": "调整工作日", "实际部门": "工程课",
			"班次": "白班 08:00-17:00", "标准工时": 8, "实际出勤（小时）": 7.75,
			"上班时间": "08:15", "下班时间": "17:00", "source_row": 3,
		}]
		values = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")["processed_rows"][0]["processed_value"]

		self.assertEqual(values["late_count"], 1)
		self.assertEqual(values["personal_leave_hours"], 0)
		self.assertIn("2026-06-06迟到15分钟（半小时以内）", values["attendance_note"])

	def test_workday_outside_shift_is_audited_but_only_confirmed_hours_flow_downstream(self):
		base = {
			"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "日期类型": "工作日", "实际部门": "工程课",
			"班次": "白班 08:00-17:00", "标准工时": 8, "实际出勤（小时）": 8,
			"上班时间": "07:30", "下班时间": "18:00", "工作日加班（小时）": 1.5,
			"source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 3,
		}
		unapproved = processor.process_attendance_draft_rows([base], attendance_month="2026-06")["processed_rows"][0]
		detail = unapproved["processed_value"]["attendance_details"][0]
		self.assertEqual(unapproved["processed_value"]["workday_overtime_hours"], 0)
		self.assertEqual(detail["raw_outside_shift_hours"], 1)
		self.assertEqual(detail["overtime_approval_status"], "无申请")
		self.assertIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", unapproved["exception_codes"])
		rejected = processor.process_attendance_draft_rows([
			{**base, "关联审批单": "加班申请 OT-009 已驳回"}
		], attendance_month="2026-06")["processed_rows"][0]
		self.assertEqual(rejected["processed_value"]["workday_overtime_hours"], 0)
		self.assertIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", rejected["exception_codes"])

		confirmed = processor.process_attendance_draft_rows([
			{**base, "确认计入的加班时长": 1.25}
		], attendance_month="2026-06")["processed_rows"][0]
		self.assertEqual(confirmed["processed_value"]["workday_overtime_hours"], 1.25)
		self.assertNotIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", confirmed["exception_codes"])

	def test_schedule_auto_overtime_does_not_require_an_overtime_application(self):
		row = processor.process_attendance_draft_rows([{
			"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "日期类型": "工作日",
			"实际部门": "连续课", "班次": "生产白班 08:00-16:30", "标准工时": 8,
			"实际出勤（小时）": 8, "上班时间": "08:00", "下班时间": "20:00",
			"工作日加班（小时）": 3, "关联审批单": "", "source_file": "sample.xlsx", "source_row": 3,
		}], attendance_month="2026-06")["processed_rows"][0]

		values = row["processed_value"]
		self.assertEqual(values["workday_overtime_hours"], 3)
		self.assertEqual(values["attendance_details"][0]["overtime_approval_status"], "钉钉自动识别")
		self.assertEqual(values["attendance_details"][0]["overtime_source_mode"], "schedule_auto")
		self.assertNotIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", row["exception_codes"])
		self.assertEqual(row["review_status"], "无需审核")

	def test_production_white_uses_dingtalk_hours_without_approval_after_20(self):
		base = {
			"姓名": "张付俊", "工号": "2112", "日期": "26-07-01", "日期类型": "工作日",
			"实际部门": "生产课", "班次": "生产白班 08:00-16:30", "标准工时": 8,
			"实际出勤（小时）": 8, "上班时间": "07:40",
			"关联审批单": "", "source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 2853,
		}

		for clock_out, dingtalk_hours, expected_excess_minutes in (
			("19:00", 2, 0),
			("20:00", 3, 0),
			("20:04", 3, 4),
			("20:29", 3, 29),
			("20:30", 3, 30),
			("20:31", 3, 31),
			("21:00", 3, 60),
		):
			with self.subTest(clock_out=clock_out):
				row = processor.process_attendance_draft_rows([
					{**base, "下班时间": clock_out, "工作日加班（小时）": dingtalk_hours}
				], attendance_month="2026-07")["processed_rows"][0]

				values = row["processed_value"]
				detail = values["attendance_details"][0]
				self.assertEqual(values["workday_overtime_hours"], dingtalk_hours)
				self.assertEqual(detail["confirmed_overtime_hours"], dingtalk_hours)
				self.assertEqual(detail["schedule_auto_excess_minutes"], expected_excess_minutes)
				self.assertEqual(values["special_workday_hours"], 0)
				self.assertNotIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", row["exception_codes"])

		approved = processor.process_attendance_draft_rows([{
			**base, "下班时间": "21:00", "工作日加班（小时）": 3,
			"关联审批单": "加班07-01 20:00到07-01 21:00 1小时 已通过",
		}], attendance_month="2026-07")["processed_rows"][0]
		approved_detail = approved["processed_value"]["attendance_details"][0]
		self.assertEqual(approved["processed_value"]["workday_overtime_hours"], 3)
		self.assertEqual(approved_detail["overtime_approval_status"], "已匹配申请")
		self.assertNotIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", approved["exception_codes"])

	def test_schedule_auto_restday_overtime_uses_source_actual_hours_without_application(self):
		row = processor.process_attendance_draft_rows([{
			"姓名": "张三", "工号": "E-001", "日期": "26-06-07", "日期类型": "周末休息日",
			"实际部门": "连续课", "班次": "生产白班 08:00-16:30", "标准工时": 8,
			"实际出勤（小时）": 8, "上班时间": "08:00", "下班时间": "20:00",
			"休息日加班（小时）": 0, "关联审批单": "", "source_file": "sample.xlsx", "source_row": 3,
		}], attendance_month="2026-06")["processed_rows"][0]

		values = row["processed_value"]
		self.assertEqual(values["restday_overtime_hours"], 8)
		self.assertNotIn("RESTDAY_CLOCKED_WITHOUT_OVERTIME", row["exception_codes"])
		self.assertEqual(row["review_status"], "无需审核")

	def test_production_night_schedule_generates_three_point_five_workday_overtime(self):
		row = processor.process_attendance_draft_rows([{
			"姓名": "王浩", "工号": "4145", "日期": "26-07-13", "日期类型": "工作日",
			"实际部门": "生产课", "班次": "生产夜班 20:00-次日04:30", "标准工时": 8,
			"实际出勤（小时）": 8, "上班时间": "19:41", "下班时间": "次日 08:00",
			"工作日加班（小时）": 0, "关联审批单": "", "source_file": "sample.xlsx", "source_row": 2865,
		}], attendance_month="2026-07")["processed_rows"][0]

		values = row["processed_value"]
		detail = values["attendance_details"][0]
		self.assertEqual(values["workday_overtime_hours"], 3.5)
		self.assertEqual(detail["raw_workday_overtime_hours"], 0)
		self.assertAlmostEqual(detail["raw_outside_shift_hours"], 210 / 60, places=6)
		self.assertEqual(detail["schedule_auto_overtime_hours"], 3.5)
		self.assertEqual(detail["confirmed_overtime_hours"], 3.5)
		self.assertEqual(detail["overtime_approval_status"], "钉钉自动识别")
		self.assertNotIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", row["exception_codes"])
		self.assertEqual(row["review_status"], "无需审核")

	def test_company_shift_rule_overrides_builtin_overtime_and_persists_version(self):
		row = processor.process_attendance_draft_rows([{
			"姓名": "王浩", "工号": "4145", "日期": "26-07-13", "日期类型": "工作日",
			"实际部门": "生产课", "班次": "生产夜班 20:00-次日04:30", "标准工时": 8,
			"实际出勤（小时）": 8, "上班时间": "19:41", "下班时间": "次日 08:30",
			"工作日加班（小时）": 0, "关联审批单": "", "source_file": "sample.xlsx", "source_row": 2865,
		}], attendance_month="2026-07", shift_rules=[{
			"name": "公司生产夜班", "rule_code": "SHIFT-CUSTOM-NIGHT", "tokens": ("生产", "夜班"),
			"workday_hours": "4", "workday_end_minutes": 8 * 60 + 30, "workday_auto": True,
			"restday_auto": False, "basic_time": "20:00-4:30",
		}], shift_rule_version="rules-v2")["processed_rows"][0]

		values = row["processed_value"]
		detail = values["attendance_details"][0]
		self.assertEqual(values["workday_overtime_hours"], 4)
		self.assertEqual(values["shift_rule_version"], "rules-v2")
		self.assertEqual(detail["shift_rule_code"], "SHIFT-CUSTOM-NIGHT")
		self.assertEqual(detail["shift_rule_name"], "公司生产夜班")
		self.assertEqual(detail["restday_overtime_source_mode"], "overtime_application")

	def test_company_shift_rule_respects_effective_date(self):
		row = processor.process_attendance_draft_rows([{
			"姓名": "王浩", "工号": "4145", "日期": "26-07-13", "日期类型": "工作日",
			"实际部门": "生产课", "班次": "生产夜班 20:00-次日04:30", "标准工时": 8,
			"实际出勤（小时）": 8, "上班时间": "19:41", "下班时间": "次日 08:30",
			"工作日加班（小时）": 0, "关联审批单": "", "source_file": "sample.xlsx", "source_row": 2865,
		}], attendance_month="2026-07", shift_rules=[{
			"name": "未来生产夜班", "rule_code": "SHIFT-FUTURE", "tokens": ("生产", "夜班"),
			"effective_from": "2026-08-01", "workday_hours": "4", "workday_end_minutes": 8 * 60 + 30,
			"workday_auto": True, "restday_auto": False, "basic_time": "20:00-4:30",
		}], shift_rule_version="rules-future")["processed_rows"][0]

		self.assertEqual(row["processed_value"]["workday_overtime_hours"], 0)
		self.assertIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", row["exception_codes"])

	def test_explicit_empty_company_shift_rules_do_not_reactivate_builtin_rules(self):
		row = processor.process_attendance_draft_rows([{
			"姓名": "王浩", "工号": "4145", "日期": "26-07-13", "日期类型": "工作日",
			"实际部门": "生产课", "班次": "生产夜班 20:00-次日04:30", "标准工时": 8,
			"实际出勤（小时）": 8, "上班时间": "19:41", "下班时间": "次日 08:00",
			"工作日加班（小时）": 0, "关联审批单": "", "source_file": "sample.xlsx", "source_row": 2865,
		}], attendance_month="2026-07", shift_rules=[], shift_rule_version="all-disabled")["processed_rows"][0]

		self.assertEqual(row["processed_value"]["workday_overtime_hours"], 0)
		self.assertEqual(row["processed_value"]["shift_rule_version"], "all-disabled")
		self.assertIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", row["exception_codes"])

	def test_company_shift_rule_uses_configured_punch_pick_ranges(self):
		base = {
			"姓名": "王浩", "工号": "4145", "日期": "26-07-13", "日期类型": "工作日",
			"实际部门": "生产课", "班次": "生产夜班 20:00-次日04:30", "标准工时": 8,
			"实际出勤（小时）": 8, "上班时间": "19:41", "工作日加班（小时）": 0,
			"关联审批单": "", "source_file": "sample.xlsx", "source_row": 2865,
		}
		rule = {
			"name": "公司生产夜班", "rule_code": "SHIFT-NIGHT", "tokens": ("生产", "夜班"),
			"workday_hours": "3.5", "workday_end_minutes": 8 * 60, "workday_auto": True,
			"restday_auto": True, "basic_time": "20:00-次日04:30",
			"punch_in_range": "18:00-20:29", "punch_out_range": "20:30-次日10:00",
		}
		valid = processor.process_attendance_draft_rows([
			{**base, "下班时间": "次日 08:00"},
		], attendance_month="2026-07", shift_rules=[rule], shift_rule_version="ranges-v1")["processed_rows"][0]
		outside = processor.process_attendance_draft_rows([
			{**base, "下班时间": "次日 10:30"},
		], attendance_month="2026-07", shift_rules=[rule], shift_rule_version="ranges-v1")["processed_rows"][0]
		outside_with_source_hours = processor.process_attendance_draft_rows([
			{**base, "下班时间": "次日 10:30", "工作日加班（小时）": 3.5},
		], attendance_month="2026-07", shift_rules=[rule], shift_rule_version="ranges-v1")["processed_rows"][0]
		approved_outside = processor.process_attendance_draft_rows([
			{**base, "下班时间": "次日 10:30", "工作日加班（小时）": 3.5, "关联审批单": "加班审批已通过"},
		], attendance_month="2026-07", shift_rules=[rule], shift_rule_version="ranges-v1")["processed_rows"][0]

		self.assertEqual(valid["processed_value"]["workday_overtime_hours"], 3.5)
		self.assertNotIn("CLOCK_OUT_OUTSIDE_PICK_RANGE", valid["exception_codes"])
		self.assertEqual(outside["processed_value"]["workday_overtime_hours"], 0)
		self.assertIn("CLOCK_OUT_OUTSIDE_PICK_RANGE", outside["exception_codes"])
		self.assertEqual(outside["processed_value"]["attendance_details"][0]["punch_out_range"], "20:30-次日10:00")
		self.assertEqual(outside_with_source_hours["processed_value"]["workday_overtime_hours"], 0)
		self.assertEqual(approved_outside["processed_value"]["workday_overtime_hours"], 3.5)

	def test_company_shift_rule_calculates_small_and_large_night_allowances(self):
		base = {
			"姓名": "王浩", "工号": "4145", "日期": "26-07-13", "日期类型": "工作日",
			"实际部门": "生产课", "班次": "生产夜班 20:00-次日04:30", "标准工时": 8,
			"实际出勤（小时）": 8, "上班时间": "19:41", "工作日加班（小时）": 0,
			"关联审批单": "", "source_file": "sample.xlsx", "source_row": 2865,
		}
		rule = {
			"name": "公司生产夜班", "rule_code": "SHIFT-NIGHT", "tokens": ("生产", "夜班"),
			"workday_hours": "3.5", "workday_end_minutes": 8 * 60, "workday_auto": True,
			"restday_auto": True, "basic_time": "20:00-次日04:30",
			"punch_in_range": "18:00-20:29", "punch_out_range": "20:30-次日10:00",
			"small_night_condition": {"minimum_hours": 8, "mode": "区间", "start_minutes": 4 * 60 + 30, "end_minutes": 7 * 60 + 59},
			"large_night_condition": {"minimum_hours": 11.5, "mode": "不早于", "start_minutes": 8 * 60, "end_minutes": None},
		}
		def calculate(clock_out):
			return processor.process_attendance_draft_rows([
				{**base, "下班时间": clock_out},
			], attendance_month="2026-07", shift_rules=[rule], shift_rule_version="night-v1")["processed_rows"][0]["processed_value"]

		small = calculate("次日 06:00")
		large = calculate("次日 08:00")
		self.assertEqual((small["small_night_shifts"], small["large_night_shifts"]), (1, 0))
		self.assertEqual((large["small_night_shifts"], large["large_night_shifts"]), (0, 1))

	def test_all_fixed_schedule_rows_generate_the_workbook_workday_hours(self):
		cases = (
			("生产白班 08:00-16:30", "20:00", 3),
			("生产夜班 20:00-次日04:30", "次日 08:00", 3.5),
			("警卫白班 07:30-16:30", "19:30", 2.5),
			("警卫夜班 19:30-次日04:00", "次日 07:30", 3.5),
			("品保10点生产白班 10:00-19:00", "22:00", 3),
			("中班 13:00-22:00", "次日 01:00", 2.5),
			("清洁阿姨 07:00-16:00", "17:00", 2.5),
			("烧饭阿姨白班 06:30-15:00", "18:00", 2.5),
			("烧饭阿姨夜班 08:00-21:00", "次日 00:00", 3),
			("IQC白班 07:00-15:30", "19:00", 3),
			("CCD人员白班 08:00-17:00", "20:00", 2.5),
			("CCD人员夜班 20:00-次日04:30", "次日 08:00", 3.5),
		)
		for shift, clock_out, expected_hours in cases:
			with self.subTest(shift=shift):
				row = processor.process_attendance_draft_rows([{
					"姓名": "张三", "工号": "E-001", "日期": "26-07-01", "日期类型": "工作日",
					"实际部门": "测试部门", "班次": shift, "标准工时": 8, "实际出勤（小时）": 8,
					"上班时间": shift.split()[1].split("-")[0], "下班时间": clock_out,
					"工作日加班（小时）": 0, "关联审批单": "", "source_file": "sample.xlsx", "source_row": 3,
				}], attendance_month="2026-07")["processed_rows"][0]

				values = row["processed_value"]
				detail = values["attendance_details"][0]
				self.assertEqual(values["workday_overtime_hours"], expected_hours)
				self.assertEqual(detail["schedule_auto_overtime_hours"], expected_hours)
				self.assertEqual(detail["confirmed_overtime_hours"], expected_hours)
				self.assertNotIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", row["exception_codes"])

	def test_schedule_rows_requiring_an_application_do_not_auto_generate_workday_hours(self):
		for shift, clock_out in (
			("药水分析组 10:00-20:00", "22:01"),
			("生管仓库 06:30-15:30", "17:01"),
		):
			with self.subTest(shift=shift):
				row = processor.process_attendance_draft_rows([{
					"姓名": "张三", "工号": "E-001", "日期": "26-07-01", "日期类型": "工作日",
					"实际部门": "测试部门", "班次": shift, "标准工时": 8, "实际出勤（小时）": 8,
					"上班时间": shift.split()[1].split("-")[0], "下班时间": clock_out,
					"工作日加班（小时）": 0, "关联审批单": "", "source_file": "sample.xlsx", "source_row": 3,
				}], attendance_month="2026-07")["processed_rows"][0]
				self.assertEqual(row["processed_value"]["workday_overtime_hours"], 0)
				self.assertIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", row["exception_codes"])

	def test_indirect_staff_17_to_18_is_unpaid_and_source_overtime_is_authoritative(self):
		base = {
			"姓名": "张三", "工号": "E-001", "日期": "26-07-01", "日期类型": "工作日",
			"实际部门": "工程课", "班次": "间接人员 08:00-17:00", "标准工时": 8,
			"实际出勤（小时）": 8, "上班时间": "08:00", "工作日加班（小时）": 0,
			"关联审批单": "", "source_file": "sample.xlsx", "source_row": 3,
		}
		for clock_out, source_overtime, expected_overtime, expected_exception in (
			("17:00", 0, 0, False),
			("17:29", 0, 0, False),
			("17:30", 0, 0, False),
			("17:59", 0, 0, False),
			("18:00", 0, 0, False),
			("18:30", 0, 0, False),
			("18:31", 0, 0, True),
			("20:00", 2, 2, False),
		):
			with self.subTest(clock_out=clock_out):
				row = processor.process_attendance_draft_rows([
					{**base, "下班时间": clock_out, "工作日加班（小时）": source_overtime},
				], attendance_month="2026-07")["processed_rows"][0]
				values = row["processed_value"]
				self.assertEqual(values["special_workday_hours"], 0)
				self.assertEqual(values["workday_overtime_hours"], expected_overtime)
				self.assertEqual(
					"WORKDAY_OUTSIDE_SHIFT_UNAPPROVED" in row["exception_codes"], expected_exception,
				)
				self.assertEqual(values["special_hours_days"], [])
				self.assertEqual(values["attendance_details"][0]["overtime_approval_status"], "原表已判定")

		configured = processor.process_attendance_draft_rows([
			{**base, "下班时间": "18:00"},
		], attendance_month="2026-07", shift_rules=[{
			"name": "公司间接人员", "rule_code": "SHIFT-006", "tokens": ("间接人员",),
			"workday_hours": "0", "workday_auto": False, "restday_auto": False,
			"basic_time": "08:00-17:00", "extended_shift_rule": "加班单；17:00-18:00特殊工时",
		}])["processed_rows"][0]
		self.assertEqual(configured["processed_value"]["special_workday_hours"], 0)
		self.assertNotIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", configured["exception_codes"])

	def test_indirect_long_day_outside_shift_exception_depends_on_workday_overtime_hours(self):
		base = {
			"姓名": "张三", "工号": "E-001", "日期": "26-07-01", "日期类型": "工作日",
			"实际部门": "工程课", "标准工时": 8, "实际出勤（小时）": 8,
			"上班时间": "08:00", "下班时间": "19:00", "关联审批单": "",
			"source_file": "sample.xlsx", "source_row": 3,
		}
		for shift in ("间接长白班 08:00-17:00", "中班-间接长白班 08:00-17:00"):
			with self.subTest(shift=shift):
				missing = processor.process_attendance_draft_rows([
					{**base, "班次": shift, "工作日加班（小时）": 0},
				], attendance_month="2026-07")["processed_rows"][0]
				recorded = processor.process_attendance_draft_rows([
					{**base, "班次": shift, "工作日加班（小时）": 2},
				], attendance_month="2026-07")["processed_rows"][0]

				self.assertIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", missing["exception_codes"])
				self.assertNotIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", recorded["exception_codes"])
				self.assertEqual(recorded["processed_value"]["workday_overtime_hours"], 2)

	def test_middle_shift_weekend_still_requires_an_overtime_application(self):
		row = processor.process_attendance_draft_rows([{
			"姓名": "张三", "工号": "E-001", "日期": "26-07-05", "日期类型": "周末休息日",
			"实际部门": "维修课", "班次": "中班 13:00-22:00", "标准工时": 8,
			"实际出勤（小时）": 8, "上班时间": "13:00", "下班时间": "次日 01:00",
			"休息日加班（小时）": 0, "关联审批单": "", "source_file": "sample.xlsx", "source_row": 3,
		}], attendance_month="2026-07")["processed_rows"][0]

		detail = row["processed_value"]["attendance_details"][0]
		self.assertEqual(row["processed_value"]["restday_overtime_hours"], 0)
		self.assertEqual(detail["overtime_source_mode"], "schedule_auto")
		self.assertEqual(detail["restday_overtime_source_mode"], "overtime_application")
		self.assertIn("RESTDAY_CLOCKED_WITHOUT_OVERTIME", row["exception_codes"])

	def test_ccd_schedule_auto_overtime_is_two_point_five_hours(self):
		row = processor.process_attendance_draft_rows([{
			"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "日期类型": "工作日",
			"实际部门": "品保课", "班次": "CCD人员白班 08:00-17:00", "标准工时": 8,
			"实际出勤（小时）": 8, "上班时间": "08:00", "下班时间": "20:00",
			"工作日加班（小时）": 3, "关联审批单": "", "source_file": "sample.xlsx", "source_row": 3,
		}], attendance_month="2026-06")["processed_rows"][0]

		values = row["processed_value"]
		detail = values["attendance_details"][0]
		self.assertEqual(values["workday_overtime_hours"], 2.5)
		self.assertEqual(detail["raw_workday_overtime_hours"], 3)
		self.assertEqual(detail["schedule_auto_overtime_hours"], 2.5)
		self.assertEqual(detail["confirmed_overtime_hours"], 2.5)
		self.assertNotIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", row["exception_codes"])

	def test_workday_early_arrival_is_excluded_from_overtime_tolerance(self):
		base = {
			"姓名": "张三", "工号": "E-001", "日期": "26-07-21", "日期类型": "工作日", "实际部门": "工程课",
			"班次": "间接人员 8：00-\n17：00", "标准工时": 8, "实际出勤（小时）": 8,
			"上班时间": "07:41", "下班时间": "17:07", "source_row": 1241,
		}
		within_tolerance = processor.process_attendance_draft_rows([base], attendance_month="2026-07")["processed_rows"][0]

		self.assertAlmostEqual(within_tolerance["processed_value"]["attendance_details"][0]["raw_outside_shift_hours"], 7 / 60, places=2)
		self.assertNotIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", within_tolerance["exception_codes"])

		for clock_in, clock_out, expected_exception in (("07:30", "17:00", False), ("07:29", "17:31", False)):
			with self.subTest(clock_in=clock_in, clock_out=clock_out):
				row = processor.process_attendance_draft_rows([
					{**base, "上班时间": clock_in, "下班时间": clock_out}
				], attendance_month="2026-07")["processed_rows"][0]
				self.assertEqual("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED" in row["exception_codes"], expected_exception)

	def test_reprocessing_same_late_source_does_not_double_add_personal_leave(self):
		row = {
			"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "日期类型": "工作日", "实际部门": "工程课",
			"班次": "白班 08:00-17:00", "标准工时": 8, "事假(小时)": 1,
			"上班时间": "08:31", "下班时间": "17:00", "source_row": 3,
		}
		first = processor.process_attendance_draft_rows([row], attendance_month="2026-06")["processed_rows"][0]
		second = processor.process_attendance_draft_rows([row], attendance_month="2026-06")["processed_rows"][0]
		self.assertEqual(first["processed_value"]["personal_leave_hours"], 1.52)
		self.assertEqual(second["processed_value"]["personal_leave_hours"], 1.52)
		self.assertEqual(first["processed_value"]["attendance_note"], second["processed_value"]["attendance_note"])

	def test_blank_shift_outside_known_employment_period_is_data_quality_only(self):
		rows = [
			{"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "实际部门": "工程课", "班次": "", "source_row": 3},
			{"姓名": "张三", "工号": "E-001", "日期": "26-06-11", "实际部门": "工程课", "班次": "", "source_row": 4},
			{"姓名": "张三", "工号": "E-001", "日期": "26-06-21", "实际部门": "工程课", "班次": "", "source_row": 5},
		]
		roster = [{"employee_code": "E-001", "employee_name": "张三", "department": "工程课", "date_of_joining": "2026-06-10", "relieving_date": "2026-06-20"}]
		result = processor.process_attendance_draft_rows(rows, attendance_month="2026-06", employee_directory=roster, source_file="sample.xlsx", source_sheet="每日统计")
		row = result["processed_rows"][0]

		self.assertEqual(row["exception_codes"], [])
		self.assertEqual(row["exception_events"], [])
		self.assertEqual([event["attendance_date"] for event in row["data_quality_events"]], ["2026-06-01", "2026-06-11", "2026-06-21"])
		self.assertEqual(result["data_quality"]["lifecycle_excluded_blank_shift_rows"], 3)
		self.assertEqual(result["data_quality"]["employment_scope_excluded_rows"], 2)
		self.assertEqual(row["processed_value"]["employment_scope_summary"], {"in_scope_rows": 1, "out_of_scope_rows": 2, "unknown_scope_rows": 0})

	def test_employee_joining_after_attendance_month_is_removed_from_processed_results(self):
		rows = [{
			"姓名": "王涛", "工号": "E-009", "日期": "26-07-08", "日期类型": "工作日", "实际部门": "工程课",
			"班次": "", "标准工时": 8, "实际出勤（小时）": 0, "上班缺卡": 1, "下班缺卡": 1,
			"旷工": 1, "迟到次数": 1, "早退次数": 1, "source_file": "sample.xlsx",
			"source_sheet": "每日统计", "source_row": 716,
		}]
		roster = [{"employee_code": "E-009", "employee_name": "王涛", "department": "工程课", "date_of_joining": "2026-09-01"}]

		result = processor.process_attendance_draft_rows(
			rows, attendance_month="2026-07", employee_directory=roster,
		)

		self.assertEqual(result["processed_rows"], [])
		self.assertEqual(result["metrics"]["processed_rows"], 0)
		self.assertEqual(result["metrics"]["eligible_employee_source_rows"], 0)
		self.assertEqual(result["metrics"]["excluded_future_joining_rows"], 1)
		self.assertEqual(result["data_quality"]["excluded_future_joining_rows"], 1)

	def test_employee_joining_on_last_day_of_attendance_month_is_retained(self):
		rows = [{
			"姓名": "王涛", "工号": "E-009", "日期": "26-07-31", "日期类型": "工作日", "实际部门": "工程课",
			"班次": "白班 08:00-17:00", "标准工时": 8, "实际出勤（小时）": 8, "source_row": 716,
		}]
		roster = [{"employee_code": "E-009", "employee_name": "王涛", "department": "工程课", "date_of_joining": "2026-07-31"}]

		result = processor.process_attendance_draft_rows(
			rows, attendance_month="2026-07", employee_directory=roster,
		)

		self.assertEqual(len(result["processed_rows"]), 1)
		self.assertEqual(result["metrics"]["excluded_future_joining_rows"], 0)

	def test_unknown_employment_dates_do_not_silently_suppress_real_hours_mismatch(self):
		row = processor.process_attendance_draft_rows([{
			"姓名": "张三", "工号": "E-010", "日期": "26-07-08", "日期类型": "工作日", "实际部门": "工程课",
			"班次": "白班", "标准工时": 8, "实际出勤（小时）": 0, "source_row": 3,
		}], attendance_month="2026-07", employee_directory=[{
			"employee_code": "E-010", "employee_name": "张三", "department": "工程课",
		}])["processed_rows"][0]

		self.assertIn("ATTENDANCE_HOURS_MISMATCH", row["exception_codes"])
		self.assertEqual(row["processed_value"]["employment_scope_summary"]["unknown_scope_rows"], 1)

	def test_duplicate_dingtalk_headers_do_not_overwrite_the_first_column(self):
		headers = processor.flatten_dingtalk_headers(("姓名", "旷工", "旷工"), ("", "", ""))
		self.assertEqual(headers, ["姓名", "旷工", "旷工_2"])

	def test_large_night_shift_uses_only_the_dingtalk_export_value(self):
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
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")["processed_rows"][0]

		# HRMS does not use clock times or a local rule to replace DingTalk's count.
		self.assertEqual(row["processed_value"]["large_night_shifts"], 10)
		self.assertEqual(row["processed_value"]["night_shift_matching"]["mode"], "source_only")

	def test_deep_night_shift_uses_the_production_shift_schedule_not_actual_punches(self):
		rows = [
			{
				"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "实际部门": "工程课", "班次": "生产夜班 20:00-次日08:00", "标准工时": 8,
				"上班时间": "20:18", "下班时间": "07:40", "source_file": "sample.xlsx", "source_sheet": "每日明细（钉钉导出）", "source_row": 3,
			},
			{
				"姓名": "张三", "工号": "E-001", "日期": "26-06-02", "实际部门": "工程课", "班次": "生产夜班 20:00-07:59", "标准工时": 8,
				"上班时间": "20:00", "下班时间": "08:00", "source_file": "sample.xlsx", "source_sheet": "每日明细（钉钉导出）", "source_row": 4,
			},
			{
				"姓名": "张三", "工号": "E-001", "日期": "26-06-03", "实际部门": "工程课", "班次": "夜班 20:00-次日08:00", "标准工时": 8,
				"上班时间": "20:00", "下班时间": "08:00", "source_file": "sample.xlsx", "source_sheet": "每日明细（钉钉导出）", "source_row": 5,
			},
		]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-06")["processed_rows"][0]

		self.assertEqual(row["processed_value"]["deep_night_shifts"], 1)
		self.assertEqual(
			[detail.get("is_production_deep_night_shift", False) for detail in row["processed_value"]["attendance_details"]],
			[True, False, False],
		)

	def test_current_dingtalk_overtime_header_and_explicit_deep_night_are_loaded(self):
		rows = [
			{
				"姓名": "张三", "工号": "E-001", "日期": "26-07-13", "实际部门": "连续课",
				"班次": "生产夜班 20:00-次日04:30", "标准工时": 8, "工作日加班": 3.5, "深夜班": 1,
				"关联审批单": "加班申请 OT-003",
				"source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 3,
			},
			{
				"姓名": "张三", "工号": "E-001", "日期": "26-07-14", "实际部门": "连续课",
				"班次": "生产白班 08:00-16:30", "标准工时": 8, "工作日加班(小时)": 3, "深夜班": 0,
				"关联审批单": "加班申请 OT-004",
				"source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 4,
			},
		]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-07")["processed_rows"][0]

		self.assertEqual(row["processed_value"]["workday_overtime_hours"], 6.5)
		self.assertEqual(row["processed_value"]["deep_night_shifts"], 1)
		self.assertEqual(row["processed_value"]["night_shift_matching"]["deep_night_source"], "深夜班")
		self.assertEqual(
			[detail.get("is_production_deep_night_shift", False) for detail in row["processed_value"]["attendance_details"]],
			[True, False],
		)

	def test_department_group_and_section_suffixes_are_the_same_department(self):
		rows = [{
			"姓名": "朱耀辉", "工号": "164", "日期": "26-06-01", "实际部门": "设备组", "班次": "白班", "标准工时": 8, "实际出勤": 8,
			"source_file": "sample.xlsx", "source_sheet": "每日明细（钉钉导出）", "source_row": 3,
		}]
		roster = [{"employee_code": "164", "employee_name": "朱耀辉", "department": "设备课"}]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-06", employee_directory=roster)["processed_rows"][0]

		self.assertNotIn("EMPLOYEE_DEPARTMENT_MISMATCH", row["exception_codes"])
		self.assertEqual(row["review_status"], "无需审核")
		self.assertTrue(row["eligible_for_downstream"])

	def test_dingtalk_departed_name_suffix_does_not_create_identity_exception(self):
		rows = [
			{
				"姓名": "张朋军（离职）", "工号": "4005", "日期": "26-07-01", "实际部门": "品保课", "班次": "生产夜班 20:00-次日08:00", "标准工时": 8, "实际出勤": 8,
				"source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 1029,
			},
			{
				"姓名": "张朋军", "工号": "4005", "日期": "26-07-02", "实际部门": "品保课", "班次": "生产夜班 20:00-次日08:00", "标准工时": 8, "实际出勤": 8,
				"source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 1030,
			},
		]
		roster = [{"employee_code": "4005", "employee_name": "张朋军", "department": "品保课", "relieving_date": "2026-08-31"}]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-07", employee_directory=roster)["processed_rows"][0]

		self.assertNotIn("EMPLOYEE_NAME_MISMATCH", row["exception_codes"])
		self.assertNotIn("EMPLOYEE_CODE_NAME_CONFLICT", row["exception_codes"])
		self.assertEqual(row["employee_name"], "张朋军")
		self.assertEqual(row["review_status"], "无需审核")

	def test_genuinely_different_name_still_creates_identity_exception(self):
		rows = [{
			"姓名": "王焱伟", "工号": "4051", "日期": "26-07-01", "实际部门": "品保课", "班次": "白班", "标准工时": 8,
			"source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 1022,
		}]
		roster = [{"employee_code": "4051", "employee_name": "王腾腾", "department": "品保课"}]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-07", employee_directory=roster)["processed_rows"][0]

		self.assertIn("EMPLOYEE_NAME_MISMATCH", row["exception_codes"])
		self.assertEqual(row["review_status"], "待审核")

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

	@unittest.skipUnless(load_workbook is not None, "openpyxl is unavailable")
	@unittest.skipUnless(REAL_WORKBOOK.exists(), "Local real DingTalk sample is unavailable")
	def test_real_dingtalk_sample_has_5820_source_rows_and_194_employee_results(self):
		book = load_workbook(REAL_WORKBOOK, data_only=True, read_only=True)
		rows = processor.rows_from_dingtalk_daily_sheet(book["每日明细（钉钉导出）"], source_file=str(REAL_WORKBOOK))
		result = processor.process_attendance_draft_rows(rows, attendance_month="2026-06", source_file=str(REAL_WORKBOOK))

		self.assertEqual(result["metrics"]["source_rows"], 5820)
		self.assertEqual(result["metrics"]["processed_rows"], 194)
		yang_bo = next(row for row in result["processed_rows"] if row["employee_code"] == "946")
		self.assertEqual(yang_bo["processed_value"]["standard_hours"], 168)
		self.assertEqual(yang_bo["processed_value"]["actual_attendance_hours"], 156.5)
		self.assertEqual(yang_bo["processed_value"]["workday_overtime_hours"], 28)
		self.assertEqual(sum(item["raw_workday_overtime_hours"] for item in yang_bo["processed_value"]["attendance_details"]), 28)
		self.assertNotIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", yang_bo["exception_codes"])
		self.assertEqual(yang_bo["processed_value"]["restday_overtime_hours"], 9)
		self.assertEqual(yang_bo["processed_value"]["annual_leave_hours"], 8)
		# Daily facts remain visible. Rows without a recoverable scheduled start/end
		# now stay pending instead of guessing a cross-day or missing-card schedule.
		self.assertGreater(result["metrics"]["exception_events"], 0)
		# Morning leave approvals, the indirect-staff 17:00-18:00 unpaid interval,
		# and source-judged overtime keep false positives out of the review queue.
		self.assertEqual(result["metrics"]["eligible_rows"], 160)
		self.assertEqual(result["metrics"]["exception_rows"], 34)


if __name__ == "__main__":
	unittest.main()
