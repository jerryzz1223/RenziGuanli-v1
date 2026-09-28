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
		self.assertTrue(values["attendance_details"][0]["restday_overtime_time_match"]["matched"])

	def test_weekend_zero_overtime_hours_still_follow_the_application_rule(self):
		row = self.process(**{
			"日期": "2026-08-30", "日期类型": "周末休息日",
			"上班时间": "07:47", "下班时间": "12:02",
			"实际出勤（小时）": 4, "休息日加班（小时）": 0,
		})
		self.assertIn("RESTDAY_CLOCKED_WITHOUT_APPROVAL", row["exception_codes"])

	def test_weekend_overtime_hours_with_valid_approval_do_not_raise_missing_approval(self):
		row = self.process(**{
			"日期": "2026-08-30", "日期类型": "周末休息日",
			"上班时间": "07:47", "下班时间": "12:02",
			"实际出勤（小时）": 4, "休息日加班（小时）": 4,
			"关联审批单": "加班08-30 08:00到08-30 12:00 4小时 已通过",
		})
		self.assertNotIn("RESTDAY_CLOCKED_WITHOUT_APPROVAL", row["exception_codes"])
		self.assertNotIn("RESTDAY_OVERTIME_TIME_MISMATCH", row["exception_codes"])

	def test_weekend_overtime_time_mismatch_is_audit_only_and_keeps_source_hours(self):
		row = self.process(**{
			"日期": "2026-08-30", "日期类型": "周末休息日",
			"上班时间": "08:00", "下班时间": "12:00",
			"休息日加班（小时）": 3,
			"source_file": "daily.xlsx", "source_sheet": "每日统计",
		})
		values = row["processed_value"]
		self.assertEqual(values["restday_overtime_hours"], 3)
		self.assertNotIn("RESTDAY_CLOCKED_WITHOUT_APPROVAL", row["exception_codes"])
		self.assertIn("RESTDAY_OVERTIME_TIME_MISMATCH", row["exception_codes"])
		self.assertTrue(row["eligible_for_downstream"])
		self.assertEqual(values["attendance_details"][0]["restday_overtime_time_match"]["difference_minutes"], 60)

	def test_weekend_overtime_time_match_uses_the_same_thirty_minute_boundary(self):
		for clock_out, expected_mismatch in (("11:29", False), ("11:30", True)):
			with self.subTest(clock_out=clock_out):
				row = self.process(**{
					"日期": "2026-08-30", "日期类型": "周末休息日",
					"上班时间": "07:00", "下班时间": clock_out,
					"休息日加班（小时）": 4,
				})
				self.assertEqual(
					"RESTDAY_OVERTIME_TIME_MISMATCH" in row["exception_codes"],
					expected_mismatch,
				)
				self.assertEqual(row["processed_value"]["restday_overtime_hours"], 4)


if __name__ == "__main__":
	unittest.main()
