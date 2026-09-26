"""Business cases for daily rules, including source audit and monthly totals."""
import unittest
import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import Mock

from test_attendance_draft_processor import processor
from test_attendance_daily_exception_resolution import load_processing_center


class AttendanceWeekendHoursPolicyTest(unittest.TestCase):
	def test_manual_editor_fields_and_recalculation_keep_other_days_pending(self):
		api = load_processing_center()
		sources = [{"工号": "E001", "姓名": "测试", "日期": day, "source_row": index, "标准工时": 8, "实际出勤(小时)": 7, "请假/病假(小时)": 0} for index, day in ((3, "2026-09-17"), (4, "2026-09-18"))]
		original = {"original_value": {"rows": sources}, "confirmed_value": {"_daily_row_overrides": {"3": {"实际出勤(小时)": 8}}}}
		editor = api._daily_row_editor_payload(original)
		fields = {field["fieldname"] for field in editor[0]["editable_fields"]}
		self.assertTrue({"实际出勤(小时)", "标准工时", "请假/病假(小时)"}.issubset(fields))
		result = processor.process_attendance_draft_rows(api._effective_daily_source_rows(original), attendance_month="2026-09")["processed_rows"][0]
		result = api._apply_daily_exception_decisions(result, {"4": {"ATTENDANCE_HOURS_MISMATCH": True}})
		self.assertEqual([line["source_row"] for line in result["proposed_value"]["exception_lines"]], [4])
		self.assertEqual(sources[0]["实际出勤(小时)"], 7)

	def process(self, **changes):
		source = {"姓名": "测试员工", "工号": "E001", "日期": "2026-09-18", "班次": "白班 08:00-17:00", "标准工时": 8, "source_row": 3, "source_file": "test.xlsx", "source_sheet": "每日统计", **changes}
		return processor.process_attendance_draft_rows([source], attendance_month="2026-09")["processed_rows"][0]

	def test_calendar_weekends_ignore_late_early_even_with_scheduled_hours(self):
		for day in ("2026-09-19", "2026-09-20"):
			with self.subTest(day=day):
				row = self.process(**{"日期": day, "上班时间": "09:00", "下班时间": "16:00", "迟到次数": 1, "早退次数": 1, "实际出勤": 7})
				self.assertFalse({"LATE_MARKED", "EARLY_MARKED"} & set(row["exception_codes"]))
				self.assertEqual(row["processed_value"]["late_count"], 0)
				self.assertEqual(row["processed_value"]["early_count"], 0)
				self.assertEqual(row["processed_value"]["absence_hours"], 0)
				self.assertEqual(row["original_value"]["rows"][0]["迟到次数"], 1)

	def test_calendar_weekend_schedule_without_work_never_becomes_absence(self):
		for day in ("2026-09-19", "2026-09-20"):
			with self.subTest(day=day):
				row = self.process(**{
					"日期": day, "日期类型": "周末排班", "实际出勤": 0,
					"旷工": 1, "旷工(小时)": 8,
				})
				values = row["processed_value"]
				self.assertEqual(values["absence_marker_count"], 0)
				self.assertEqual(values["absence_hours"], 0)
				self.assertEqual(values["standard_hours"], 0)
				self.assertNotIn("ABSENCE_MARKED", row["exception_codes"])
				self.assertNotIn("ATTENDANCE_HOURS_MISMATCH", row["exception_codes"])
				detail = values["attendance_details"][0]
				self.assertTrue(detail["weekend_restday_mode"])
				self.assertEqual(detail["reconciliation_mode"], "restday_overtime_only")
				self.assertEqual(detail["source_numbers"]["absence_marker_count"], 1)
				self.assertEqual(detail["source_numbers"]["absence_hours"], 8)
				self.assertEqual(detail["source_numbers"]["standard_hours"], 8)

	def test_saturday_and_sunday_exclude_every_leave_type_but_keep_source_audit(self):
		leave_values = {
			"事假(小时)": 1, "病假(小时)": 2, "特休(小时)": 3,
			"工伤(小时)": 4, "团圆假(小时)": 5, "排休(小时)": 6,
			"丧假(小时)": 7, "婚假(小时)": 8, "公假(小时)": 9,
			"产假(小时)": 10,
		}
		expected_excluded = {
			"事假": 1, "病假": 2, "特休": 3, "工伤": 4, "团圆假": 5,
			"排休": 6, "丧假": 7, "婚假": 8, "公假": 9, "产假": 10,
		}
		for day in ("2026-09-19", "2026-09-20"):
			with self.subTest(day=day):
				row = self.process(**{"日期": day, **leave_values})
				values = row["processed_value"]
				self.assertEqual(values["leave_hours"], 0)
				self.assertEqual(values["standard_hours"], 0)
				self.assertTrue(all(values[field] == 0 for field in processor.LEAVE_FIELDS))
				self.assertNotIn("ATTENDANCE_HOURS_MISMATCH", row["exception_codes"])
				detail = values["attendance_details"][0]
				self.assertEqual(detail["excluded_leave_hours"], expected_excluded)
				self.assertEqual(detail["source_numbers"]["personal_leave_hours"], 1)
		weekday = self.process(**{"病假(小时)": 4, "排休(小时)": 4})
		self.assertEqual(weekday["processed_value"]["leave_hours"], 8)

	def test_explicit_weekend_makeup_day_still_uses_workday_attendance(self):
		row = self.process(**{
			"日期": "2026-09-19", "日期类型": "周末补班", "实际出勤": 0,
			"旷工": 1, "旷工(小时)": 8,
		})
		values = row["processed_value"]
		self.assertEqual(values["standard_hours"], 8)
		self.assertEqual(values["absence_hours"], 8)
		self.assertIn("ABSENCE_MARKED", row["exception_codes"])
		self.assertFalse(values["attendance_details"][0]["weekend_restday_mode"])

	def test_scheduling_policy_can_intentionally_treat_calendar_weekend_as_workday(self):
		source = {
			"姓名": "测试员工", "工号": "E001", "日期": "2026-09-19", "日期类型": "周末排班",
			"班次": "白班 08:00-17:00", "标准工时": 8, "实际出勤": 0,
			"上班时间": "08:00", "旷工": 1, "旷工(小时)": 8, "source_row": 3,
		}
		row = processor.process_attendance_draft_rows(
			[source], attendance_month="2026-09", scheduling_policies=[{
				"name": "POLICY-001", "enabled": 1, "policy_name": "测试周末工作日规则",
				"priority": 100, "scope_type": "全公司", "effective_from": "2026-01-01",
				"calendar_weekend_mode": "按工作日考勤",
			}],
		)["processed_rows"][0]
		self.assertEqual(row["processed_value"]["standard_hours"], 8)
		self.assertEqual(row["processed_value"]["absence_hours"], 8)
		self.assertIn("ABSENCE_MARKED", row["exception_codes"])
		self.assertIn("CLOCK_OUT_MISSING", row["exception_codes"])
		self.assertEqual(
			row["processed_value"]["attendance_details"][0]["scheduling_policy"]["name"],
			"POLICY-001",
		)

	def test_employee_company_code_policy_overrides_company_weekend_policy(self):
		source = {
			"姓名": "测试员工", "工号": "E001", "日期": "2026-09-19", "日期类型": "周末排班",
			"班次": "白班 08:00-17:00", "标准工时": 8, "实际出勤": 0,
			"旷工": 1, "旷工(小时)": 8, "source_row": 3,
		}
		policies = [
			{"name": "COMPANY", "enabled": 1, "policy_name": "公司规则", "priority": 999,
			 "scope_type": "全公司", "effective_from": "2026-01-01", "calendar_weekend_mode": "按工作日考勤"},
			{"name": "EMPLOYEE", "enabled": 1, "policy_name": "员工规则", "priority": 1,
			 "scope_type": "员工", "scope_values": "E001", "effective_from": "2026-01-01",
			 "calendar_weekend_mode": "休息日加班口径"},
		]
		row = processor.process_attendance_draft_rows(
			[source], attendance_month="2026-09", scheduling_policies=policies,
		)["processed_rows"][0]
		self.assertEqual(row["processed_value"]["standard_hours"], 0)
		self.assertNotIn("ABSENCE_MARKED", row["exception_codes"])
		self.assertEqual(
			row["processed_value"]["attendance_details"][0]["scheduling_policy"]["name"],
			"EMPLOYEE",
		)

	def test_only_full_day_leave_exempts_both_explicit_and_single_punch(self):
		for standard, leave, exempt in ((8, 8, True), (8, 7.99, False), (8, 0, False), (12, 8, False), (12, 12, True), (0, 8, False)):
			with self.subTest(standard=standard, leave=leave):
				row = self.process(**{"标准工时": standard, "事假(小时)": leave, "上班时间": "08:00", "下班缺卡": 1, "上班未打卡次数": 1})
				self.assertEqual("CLOCK_OUT_MISSING" not in row["exception_codes"], exempt)
				self.assertEqual("CLOCK_IN_MISSING" not in row["exception_codes"], exempt)

	def test_weekend_single_punch_is_audit_only_not_a_missing_punch_exception(self):
		row = self.process(**{"日期": "2026-09-20", "病假(小时)": 8, "上班时间": "08:00"})
		self.assertNotIn("CLOCK_OUT_MISSING", row["exception_codes"])
		self.assertEqual(row["processed_value"]["attendance_details"][0]["clock_in"], "08:00")

	def test_explicit_weekday_restday_punches_never_create_attendance_exceptions(self):
		row = self.process(**{
			"日期": "2026-09-18", "日期类型": "休息日", "实际出勤": 2,
			"上班时间": "05:00", "下班时间": "23:00",
			"上班缺卡": 1, "下班缺卡": 1, "迟到次数": 1, "早退次数": 1,
			"旷工": 1, "旷工(小时)": 8, "休息日加班（小时）": 2.5,
		})
		values = row["processed_value"]
		detail = values["attendance_details"][0]

		self.assertEqual(row["exception_codes"], [])
		self.assertEqual(row["review_status"], "无需审核")
		self.assertTrue(row["eligible_for_downstream"])
		self.assertEqual(values["standard_hours"], 0)
		self.assertEqual(values["absence_hours"], 0)
		self.assertEqual(values["restday_overtime_hours"], 2.5)
		self.assertEqual(detail["clock_in"], "05:00")
		self.assertEqual(detail["clock_out"], "23:00")
		self.assertEqual(detail["overtime_approval_status"], "休息日打卡免申请")
		self.assertTrue(detail["weekend_restday_mode"])
		self.assertTrue(detail["source_numbers"]["clock_in_missing_count"])
		self.assertTrue(detail["source_numbers"]["clock_out_missing_count"])
		self.assertEqual(detail["source_numbers"]["absence_hours"], 8)

	def test_weekday_rest_shift_is_the_same_genuine_restday_policy(self):
		row = self.process(**{
			"日期": "2026-09-18", "日期类型": "", "班次": "休息",
			"上班时间": "08:00", "实际出勤": 0, "下班缺卡": 1,
		})
		detail = row["processed_value"]["attendance_details"][0]
		self.assertEqual(row["exception_codes"], [])
		self.assertTrue(detail["genuine_restday_mode"])
		self.assertEqual(detail["overtime_approval_status"], "休息日打卡免申请")

	def test_difference_is_per_day_and_overtime_is_separate(self):
		for actual, leave, overtime, difference in ((6, 2, 3, 0), (7, 2, 0, 1), (8.01, 0, 0, 0.01), (6, 1, 3, -1)):
			with self.subTest(actual=actual):
				row = self.process(**{"实际出勤": actual, "事假(小时)": leave, "工作日加班（小时）": overtime})
				self.assertEqual("ATTENDANCE_HOURS_MISMATCH" in row["exception_codes"], difference != 0)
				self.assertEqual(row["processed_value"]["attendance_details"][0]["hours_difference"], difference)
				if difference:
					self.assertEqual(row["review_status"], "待审核")
					self.assertFalse(row["eligible_for_downstream"])
					self.assertEqual(row["processed_value"]["exception_lines"][0]["attendance_date"], "2026-09-18")

	def test_only_user_specified_terms_enter_equation_and_all_leave_types_supported(self):
		for label in ("特休", "工伤", "丧假", "婚假", "公假", "产假"):
			with self.subTest(label=label):
				row = self.process(**{"实际出勤": 8, f"请假/{label}(小时)": 8, "下班缺卡": 1})
				self.assertNotIn("ATTENDANCE_HOURS_MISMATCH", row["exception_codes"])
				self.assertNotIn("CLOCK_OUT_MISSING", row["exception_codes"])
		for label in ("公假", "产假", "团圆假", "婚假", "丧假"):
			row = self.process(**{f"请假/{label}(天)": 1})
			self.assertEqual(row["processed_value"]["leave_hours"], 8)
		row = self.process(**{"实际出勤": 4, "病假(小时)": 8})
		self.assertEqual(row["processed_value"]["attendance_details"][0]["accounted_hours"], 8)
		row = self.process(**{"实际出勤": 1, "事假(小时)": 1, "病假(小时)": 2, "团圆假(小时)": 1, "排休(小时)": 1, "旷工(小时)": 3})
		self.assertNotIn("ATTENDANCE_HOURS_MISMATCH", row["exception_codes"])
		self.assertEqual(row["processed_value"]["attendance_details"][0]["accounted_hours"], 8)
		row = self.process(**{"实际出勤": 8, "团圆假(小时)": 8})
		self.assertEqual(row["processed_value"]["attendance_details"][0]["hours_difference"], 8)

	def test_opposite_daily_differences_cannot_cancel_each_other(self):
		rows = [{"姓名": "测试", "工号": "E001", "日期": f"2026-09-{day}", "标准工时": 8, "实际出勤": actual, "source_row": day} for day, actual in ((17, 7), (18, 9))]
		row = processor.process_attendance_draft_rows(rows, attendance_month="2026-09")["processed_rows"][0]
		self.assertEqual(row["processed_value"]["actual_attendance_hours"], 16)
		self.assertEqual([line["hours_difference"] for line in row["processed_value"]["exception_lines"]], [-1, 1])
		self.assertFalse(row["eligible_for_downstream"])

	def test_recheck_preserves_daily_corrections_and_refuses_monthly_overwrite(self):
		module = load_processing_center()
		row = self.process(**{"实际出勤": 7, "事假(小时)": 2})
		row["confirmed_value"] = {**row["proposed_value"], "_daily_row_overrides": {"3": {"实际出勤": 6}}}
		replacement, reason = module._attendance_policy_replacement(row, attendance_month="2026-09", employee_directory=None, exception_policy=None)
		self.assertEqual(reason, "")
		self.assertNotIn("ATTENDANCE_HOURS_MISMATCH", replacement["exception_codes"])
		self.assertEqual(replacement["proposed_value"]["actual_attendance_hours"], 6)
		row["review_history"] = [{"field_name": "actual_attendance_hours"}]
		replacement, reason = module._attendance_policy_replacement(row, attendance_month="2026-09", employee_directory=None, exception_policy=None)
		self.assertIsNone(replacement)
		self.assertIn("月度工时人工调整", reason)

	def test_recheck_with_workbook_source_reapplies_saved_daily_correction(self):
		module = load_processing_center()
		row = self.process(**{"实际出勤": 7, "事假(小时)": 2})
		row["confirmed_value"] = {**row["proposed_value"], "_daily_row_overrides": {"3": {"实际出勤": 6}}}
		workbook_rows = [{**row["original_value"]["rows"][0], "实际出勤": 7}]
		replacement, reason = module._attendance_policy_replacement(
			row, attendance_month="2026-09", employee_directory=None, exception_policy=None,
			source_rows_override=workbook_rows,
		)
		self.assertEqual(reason, "")
		self.assertEqual(replacement["proposed_value"]["actual_attendance_hours"], 6)
		self.assertNotIn("ATTENDANCE_HOURS_MISMATCH", replacement["exception_codes"])
		self.assertEqual(workbook_rows[0]["实际出勤"], 7)

	def test_recheck_preview_apply_audit_idempotency_and_stale_token_in_memory(self):
		api = load_processing_center()
		row = self.process(**{"实际出勤": 7})
		row["proposed_value"].pop("attendance_policy_version")
		class Record:
			def __init__(self):
				self.name, self.company, self.import_batch = "record-1", "TEST", "batch-1"
				for field in ("employee_code", "employee_name", "department", "source_type", "source_file", "source_sheet", "source_row", "source_id", "approval_no", "review_status", "exception_message", "eligible_for_downstream"):
					setattr(self, field, row.get(field))
				self.attendance_month = "2026-09"
				self.processed_value_json = self.proposed_value_json = api._json(row["proposed_value"])
				self.original_value_json = api._json(row["original_value"])
				self.confirmed_value_json = ""
				self.exception_codes = api._json(row["exception_codes"])
				self.review_history_json = "[]"
				self.saves = 0
			def as_dict(self):
				return {key: value for key, value in vars(self).items() if key != "saves"}
			def save(self, **kwargs):
				self.saves += 1
		doc = Record()
		batch = SimpleNamespace(name="batch-1", company="TEST", attendance_month="2026-09", source_type="attendance_draft", notes="")
		api._require_processing_manager = lambda: None
		api._require_company = api._require_month = lambda value: value
		api._employee_directory = lambda company: None
		api._attendance_draft_exception_policy = lambda: None
		api._latest_batch = lambda *args: batch
		api._result_rows = lambda *args: [api._serialize_record(doc.as_dict())]
		api.frappe.get_doc = lambda *args: doc
		api.frappe.throw = lambda message: (_ for _ in ()).throw(ValueError(message))
		api.frappe.db.commit = Mock()
		api.now_datetime = lambda: datetime(2026, 9, 20, 12)
		api._refresh_batch_review_status = Mock()
		api._invalidate_monthly_final_after_source_change = Mock()
		api._save_batch_notes = Mock()
		api._export_processed_result = Mock(return_value={})
		original_source = doc.original_value_json
		preview = api.recheck_attendance_policy("TEST", "2026-09")
		self.assertEqual(preview["changed_count"], 1)
		self.assertEqual(doc.saves, 0)
		api.frappe.db.commit.assert_not_called()
		with self.assertRaisesRegex(ValueError, "数据已变化"):
			api.recheck_attendance_policy("TEST", "2026-09", execute=1, preview_token="old")
		self.assertEqual(doc.saves, 0)
		api.recheck_attendance_policy("TEST", "2026-09", execute=1, preview_token=preview["preview_token"])
		self.assertEqual(doc.saves, 1)
		self.assertEqual(doc.original_value_json, original_source)
		self.assertEqual(json.loads(doc.review_history_json)[-1]["field_name"], "__attendance_policy_recheck__")
		self.assertFalse(doc.eligible_for_downstream)
		api._invalidate_monthly_final_after_source_change.assert_called_once()
		self.assertEqual(api.recheck_attendance_policy("TEST", "2026-09")["changed_count"], 0)
		api._require_processing_source_type = lambda value: value
		with self.assertRaisesRegex(ValueError, "修改本日"):
			api.update_processing_record("TEST", "2026-09", "attendance_draft", doc.name, "__review_decision__", review_status="已通过", reason="不能跳过等式校验")


if __name__ == "__main__":
	unittest.main()
