"""Decision matrix for DingTalk-authoritative daily attendance fields."""

import unittest

from test_attendance_draft_processor import processor


class AttendanceSourceAuthorityTest(unittest.TestCase):
	def process(self, **changes):
		source = {
			"姓名": "测试员工",
			"工号": "E-SOURCE",
			"日期": "2026-08-03",
			"日期类型": "工作日",
			"班次": "间接长白班 08:00-17:00",
			"标准工时": 8,
			"实际出勤（小时）": 8,
			"上班时间": "08:00",
			"下班时间": "17:00",
			"工作日加班（小时）": 0,
			"休息日加班（小时）": 0,
			"节假日加班（小时）": 0,
			"小夜班": 0,
			"大夜班": 0,
			"上班未打卡次数": 0,
			"下班未打卡次数": 0,
			"迟到次数": 0,
			"早退次数": 0,
			"旷工": 0,
			"旷工(小时)": 0,
			"source_row": 4,
		}
		result = processor.process_attendance_draft_rows(
			[{**source, **changes}], attendance_month="2026-08",
		)
		return result["processed_rows"][0]

	def test_punch_time_does_not_create_late_or_missing_markers(self):
		row = self.process(**{"上班时间": "09:00", "下班时间": ""})
		values = row["processed_value"]
		self.assertEqual(values["late_count"], 0)
		self.assertEqual(values["clock_out_missing_count"], 0)
		self.assertEqual(values["personal_leave_hours"], 0)
		self.assertFalse({"LATE_MARKED", "CLOCK_OUT_MISSING"} & set(row["exception_codes"]))

	def test_explicit_late_mark_is_reported_without_changing_leave(self):
		row = self.process(**{
			"上班时间": "09:00", "迟到次数": 1, "请假/事假(小时)": 0.25,
			"关联审批单": "事假 08-03 08:00到09:00 1小时",
		})
		values = row["processed_value"]
		self.assertEqual(values["late_count"], 1)
		self.assertEqual(values["personal_leave_hours"], 0.25)
		self.assertEqual(values["attendance_details"][0]["late_personal_leave_hours"], 0)
		self.assertIn("LATE_MARKED", row["exception_codes"])

	def test_explicit_early_mark_does_not_create_absence_hours(self):
		row = self.process(**{
			"下班时间": "15:00", "实际出勤（小时）": 6, "早退次数": 1,
			"关联审批单": "事假 08-03 15:00到17:00 2小时",
		})
		values = row["processed_value"]
		self.assertEqual(values["early_count"], 1)
		self.assertEqual(values["absence_hours"], 0)
		self.assertIn("EARLY_MARKED", row["exception_codes"])

	def test_source_overtime_precision_and_night_counts_are_preserved(self):
		row = self.process(**{
			"班次": "生产夜班 20:00-次日08:00",
			"上班时间": "20:00",
			"下班时间": "次日 08:00",
			"工作日加班（小时）": 1.74,
			"休息日加班（小时）": 2.49,
			"节假日加班（小时）": 0.75,
			"小夜班": 1,
			"大夜班": 0,
		})
		values = row["processed_value"]
		self.assertEqual(values["workday_overtime_hours"], 1.74)
		self.assertEqual(values["restday_overtime_hours"], 2.49)
		self.assertEqual(values["holiday_overtime_hours"], 0.75)
		self.assertEqual((values["small_night_shifts"], values["large_night_shifts"]), (1, 0))

	def test_weekend_overtime_hours_are_authoritative_without_approval(self):
		row = self.process(**{
			"工号": "3694", "日期": "2026-08-30", "日期类型": "周末休息日",
			"上班时间": "07:47", "下班时间": "12:02",
			"实际出勤（小时）": 4, "休息日加班（小时）": 4,
		})
		values = row["processed_value"]
		self.assertEqual(values["restday_overtime_hours"], 4)
		self.assertEqual(values["late_count"], 0)
		self.assertEqual(values["early_count"], 0)
		self.assertEqual(values["absence_hours"], 0)
		self.assertFalse({"LATE_MARKED", "EARLY_MARKED", "ABSENCE_MARKED"} & set(row["exception_codes"]))
		self.assertNotIn("RESTDAY_CLOCKED_WITHOUT_APPROVAL", row["exception_codes"])
		self.assertNotIn("RESTDAY_OVERTIME_TIME_MISMATCH", row["exception_codes"])
		self.assertEqual(values["attendance_details"][0]["overtime_approval_status"], "采用钉钉休息日加班")
		self.assertNotIn("RESTDAY_CLOCKED_WITHOUT_OVERTIME", row["exception_codes"])

	def test_weekend_zero_overtime_hours_with_long_complete_punches_is_an_exception(self):
		row = self.process(**{
			"日期": "2026-08-30", "日期类型": "周末休息日",
			"上班时间": "07:47", "下班时间": "12:02",
			"实际出勤（小时）": 4, "休息日加班（小时）": 0,
		})
		self.assertIn("RESTDAY_CLOCKED_WITHOUT_OVERTIME", row["exception_codes"])
		self.assertNotIn("RESTDAY_CLOCKED_WITHOUT_APPROVAL", row["exception_codes"])
		self.assertEqual(row["processed_value"]["restday_overtime_hours"], 0)

	def test_weekend_overtime_hours_with_valid_approval_do_not_raise_missing_approval(self):
		row = self.process(**{
			"日期": "2026-08-30", "日期类型": "周末休息日",
			"上班时间": "07:47", "下班时间": "12:02",
			"实际出勤（小时）": 4, "休息日加班（小时）": 4,
			"关联审批单": "加班08-30 08:00到08-30 12:00 4小时 已通过",
		})
		self.assertNotIn("RESTDAY_CLOCKED_WITHOUT_APPROVAL", row["exception_codes"])
		self.assertNotIn("RESTDAY_OVERTIME_TIME_MISMATCH", row["exception_codes"])

	def test_weekend_positive_overtime_is_kept_without_duration_comparison(self):
		row = self.process(**{
			"日期": "2026-08-30", "日期类型": "周末休息日",
			"上班时间": "08:00", "下班时间": "12:00",
			"休息日加班（小时）": 3,
			"source_file": "daily.xlsx", "source_sheet": "每日统计",
		})
		values = row["processed_value"]
		self.assertEqual(values["restday_overtime_hours"], 3)
		self.assertNotIn("RESTDAY_CLOCKED_WITHOUT_APPROVAL", row["exception_codes"])
		self.assertNotIn("RESTDAY_CLOCKED_WITHOUT_OVERTIME", row["exception_codes"])
		self.assertNotIn("RESTDAY_OVERTIME_TIME_MISMATCH", row["exception_codes"])
		self.assertTrue(row["eligible_for_downstream"])

	def test_weekend_zero_overtime_requires_more_than_thirty_minutes_of_complete_punches(self):
		for clock_out, expected_exception in (("08:30", False), ("08:31", True), ("", False), ("次日08:31", True)):
			with self.subTest(clock_out=clock_out):
				row = self.process(**{
					"日期": "2026-08-30", "日期类型": "周末休息日",
					"上班时间": "08:00", "下班时间": clock_out,
					"休息日加班（小时）": 0,
				})
				self.assertEqual(
					"RESTDAY_CLOCKED_WITHOUT_OVERTIME" in row["exception_codes"],
					expected_exception,
				)
				self.assertEqual(row["processed_value"]["restday_overtime_hours"], 0)

	def test_weekend_zero_overtime_is_flagged_even_with_an_approval_and_never_filled(self):
		row = self.process(**{
			"日期": "2026-08-30", "日期类型": "周末休息日",
			"班次": "生产白班 08:00-16:30", "上班时间": "08:00", "下班时间": "09:00",
			"休息日加班（小时）": 0, "实际出勤（小时）": 1,
			"关联审批单": "加班08-30 08:00到08-30 09:00 1小时 已通过",
		})
		self.assertIn("RESTDAY_CLOCKED_WITHOUT_OVERTIME", row["exception_codes"])
		self.assertFalse({
			"RESTDAY_CLOCKED_WITHOUT_APPROVAL", "RESTDAY_OVERTIME_TIME_MISMATCH",
			"RESTDAY_PUNCH_APPROVAL_MISMATCH",
		} & set(row["exception_codes"]))
		self.assertEqual(row["processed_value"]["restday_overtime_hours"], 0)

		missing_column = self.process(**{
			"日期": "2026-08-30", "日期类型": "周末休息日",
			"班次": "生产白班 08:00-16:30", "上班时间": "08:00", "下班时间": "09:00",
			"休息日加班（小时）": "", "实际出勤（小时）": 1,
		})
		self.assertIn("RESTDAY_CLOCKED_WITHOUT_OVERTIME", missing_column["exception_codes"])
		self.assertEqual(missing_column["processed_value"]["restday_overtime_hours"], 0)

	def test_adjusted_weekend_workday_does_not_use_restday_overtime_check(self):
		row = self.process(**{
			"日期": "2026-08-30", "日期类型": "调班工作日",
			"上班时间": "08:00", "下班时间": "17:00", "休息日加班（小时）": 0,
		})
		self.assertNotIn("RESTDAY_CLOCKED_WITHOUT_OVERTIME", row["exception_codes"])

	def test_august_weekends_keep_source_hours_and_missing_punch_marker(self):
		for attendance_date, shift, clock_in, clock_out, overtime_hours in (
			("2026-08-01", "生产白班 08:00-16:30", "07:44", "20:03", 11),
			("2026-08-02", "生产白班 08:00-16:30", "07:44", "18:32", 9.5),
			("2026-08-08", "生产白班 08:00-16:30", "07:43", "20:00", 11),
			("2026-08-16", "生产夜班 20:00-次日04:30", "19:47", "次日08:18", 11.5),
		):
			with self.subTest(attendance_date=attendance_date):
				row = self.process(**{
					"工号": "4150", "日期": attendance_date, "日期类型": "周末休息日",
					"班次": shift, "标准工时": 0,
					"实际出勤（小时）": 0, "上班时间": clock_in, "下班时间": clock_out,
					"休息日加班（小时）": overtime_hours,
				})
				self.assertNotIn("RESTDAY_OVERTIME_TIME_MISMATCH", row["exception_codes"])
				self.assertNotIn("RESTDAY_CLOCKED_WITHOUT_OVERTIME", row["exception_codes"])
				self.assertEqual(row["processed_value"]["restday_overtime_hours"], overtime_hours)

		missing = self.process(**{
			"工号": "4150", "日期": "2026-08-23", "日期类型": "周末休息日",
			"班次": "生产夜班 20:00-次日04:30", "标准工时": 0,
			"实际出勤（小时）": 0, "上班时间": "19:48", "下班时间": "",
			"休息日加班（小时）": 0, "下班未打卡次数": 1,
		})
		self.assertIn("CLOCK_OUT_MISSING", missing["exception_codes"])
		self.assertNotIn("RESTDAY_CLOCKED_WITHOUT_OVERTIME", missing["exception_codes"])
		self.assertNotIn("RESTDAY_OVERTIME_TIME_MISMATCH", missing["exception_codes"])


if __name__ == "__main__":
	unittest.main()
