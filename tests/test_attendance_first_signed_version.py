from __future__ import annotations

import importlib.util
import io
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

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
	export_watermark.save_workbook_with_logo_watermark = lambda book, output, **kwargs: book.save(output)
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

	def test_monthly_final_keeps_reviewed_employee_standard_hours(self):
		api = self.api
		attendance = types.SimpleNamespace(source_type="attendance_draft", company="测试公司", attendance_month="2026-08")
		records = [
			{"source_type": "attendance_draft", "eligible_for_downstream": True, "employee_code": code,
			 "processed_value": {"employee_code": code, "employee_name": code, "standard_hours": source_hours}}
			for code, source_hours in (("E-001", 160), ("E-002", 48))
		]
		with patch.object(api, "_result_rows", return_value=records):
			rows = api._monthly_final_rows({"attendance_draft": attendance})
			historical = api._monthly_final_rows({"attendance_draft": attendance}, shared_standard_hours=True, standard_hours_override=168)
		self.assertEqual([row["standard_hours"] for row in rows], [160, 48])
		self.assertEqual([row["standard_hours"] for row in historical], [168, 168])
		self.assertIn("standard_hours", api.MONTHLY_FINAL_WEB_EDITABLE_FIELDS)

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

	def test_second_signed_apple_amounts_follow_included_source_quantities(self):
		api = self.api
		batches = {
			kind: types.SimpleNamespace(source_type=kind, company="测试公司", attendance_month="2026-08")
			for kind in ("attendance_draft", "apple_tree", "missing_card")
		}
		def record(code, kind, values, included=True):
			return {
				"source_type": kind, "employee_code": code, "employee_name": code,
				"eligible_for_downstream": included, "processed_value": values,
			}
		records = {
			"attendance_draft": [record("E-001", "attendance_draft", {"standard_hours": 168})],
			"apple_tree": [
				record("E-001", "apple_tree", {"苹果类型": "绿苹果", "有效苹果数": 3}),
				record("E-001", "apple_tree", {"苹果类型": "红苹果", "有效苹果数": 2}),
				record("E-001", "apple_tree", {"苹果类型": "绿苹果", "有效苹果数": 99}, False),
				record("E-002", "apple_tree", {"苹果类型": "绿苹果", "有效苹果数": 4}),
			],
			"missing_card": [
				record("E-001", "missing_card", {"included": True, "red_apples": 2, "amount": 10}),
				record("E-001", "missing_card", {"included": False, "red_apples": 2, "amount": 10}, False),
			],
		}
		with patch.object(api, "_result_rows", side_effect=lambda batch, *_args, **_kwargs: records[batch.source_type]), patch.object(
			api, "_employee_directory", side_effect=lambda company: [{"employee_code": "E-001", "date_of_joining": "2008-06-16"}] if company == "测试公司" else []
		):
			rows = api._monthly_final_rows(batches)
		self.assertEqual(len(rows), 1)
		self.assertEqual(rows[0]["employee_code"], "E-001")
		self.assertEqual(rows[0]["date_of_joining"], "2008-06-16")
		self.assertEqual(rows[0]["green_apples"], 3)
		self.assertEqual(rows[0]["red_apples"], 4)
		self.assertEqual(rows[0]["missing_card_count"], 1)
		self.assertEqual(rows[0]["green_apple_amount"], 15)
		self.assertEqual(rows[0]["red_apple_amount"], 20)
		self.assertNotIn("missing_card_count", api.MONTHLY_FINAL_WEB_EDITABLE_FIELDS)
		self.assertIn(("missing_card_count", "忘打卡次数"), api.FINAL_SIGNED_COLUMNS)

		captured = {}
		file_manager = sys.modules["frappe.utils.file_manager"]
		with patch.object(file_manager, "save_file", side_effect=lambda name, content, *args, **kwargs: (
			captured.update(content=content) or types.SimpleNamespace(file_url="/private/files/second-signed.xlsx", file_name=name)
		)):
			api._save_monthly_signed_confirmation_file("2026-08", rows)
		sheet = load_workbook(io.BytesIO(captured["content"]))["第二次员工签字版"]
		self.assertEqual(sheet["F5"].value, "2008-06-16")
		self.assertEqual(sheet["BE2"].value, "忘打卡次数")
		self.assertEqual(sheet["BE5"].value, 1)
		self.assertEqual(sheet["BE5"].number_format, "0")
		self.assertEqual(sheet["BF2"].value, "绿苹果金额\n（元）")
		self.assertEqual(sheet["BG2"].value, "红苹果金额\n（含忘打卡，元）")
		self.assertEqual(sheet["BF5"].value, 15)
		self.assertEqual(sheet["BG5"].value, 20)
		self.assertEqual(sheet["BE6"].value, "=SUM(BE5:BE5)")

	def test_signed_reports_keep_attendance_people_while_review_is_pending(self):
		api = self.api
		batches = {
			kind: types.SimpleNamespace(source_type=kind, company="测试公司", attendance_month="2026-08")
			for kind in ("attendance_draft", "apple_tree")
		}
		attendance_rows = [
			{
				"source_type": "attendance_draft", "employee_code": code, "employee_name": code,
				"department": "工程课", "review_status": status, "eligible_for_downstream": eligible,
				"processed_value": {"standard_hours": 168, "actual_attendance_hours": 160,
					"source_row_count": 31, "review_note": "来源备注" if code == "E-002" else ""},
			}
			for code, status, eligible in (("E-001", "无需审核", True), ("E-002", "待审核", False))
		]
		attendance_rows[1]["original_value"] = {"rows": [{"姓名": "E-002", "工号": "E-002", "日期": "26-08-01 星期六", "source_row": 5}]}
		apple_rows = [
			{"source_type": "apple_tree", "employee_code": code, "employee_name": code,
			 "eligible_for_downstream": True, "processed_value": {"苹果类型": "绿苹果", "有效苹果数": 3}}
			for code in ("E-002", "E-999")
		]
		with patch.object(api, "_result_rows", side_effect=lambda batch, *_args, **_kwargs:
			attendance_rows if batch.source_type == "attendance_draft" else apple_rows), patch.object(
			api, "_employee_directory", return_value=[]
		):
			rows = api._monthly_final_rows(batches)
			first_rows = api._monthly_first_signed_rows(batches)
			daily_rows = api._monthly_first_signed_daily_rows(batches)
		self.assertEqual([row["employee_code"] for row in rows], ["E-001", "E-002"])
		self.assertEqual(rows[0].get("green_apple_amount", 0), 0)
		self.assertEqual(rows[1]["green_apple_amount"], 15)
		self.assertFalse(rows[1]["eligible_for_downstream"])
		self.assertIn("考勤初稿待审核（是否计入下游：否）", rows[1]["review_note"])
		self.assertIn("考勤初稿待审核（是否计入下游：否）", first_rows[1]["review_note"])
		self.assertEqual([row[1] for row in daily_rows], ["E-002"])
		captured = {}
		file_manager = sys.modules["frappe.utils.file_manager"]
		with patch.object(file_manager, "save_file", side_effect=lambda name, content, *args, **kwargs: (
			captured.update({name: content}) or types.SimpleNamespace(file_url=f"/private/files/{name}", file_name=name)
		)):
			api._save_monthly_signed_confirmation_file("2026-08", rows)
			api._save_monthly_finance_confirmation_file("2026-08", rows)
		signed = load_workbook(io.BytesIO(captured["2026-08_第二次员工签字版.xlsx"]), data_only=False).active
		finance = load_workbook(io.BytesIO(captured["2026-08_财务版.xlsx"]), data_only=False).active
		self.assertEqual([signed[f"D{row}"].value for row in (5, 6)], ["E-001", "E-002"])
		self.assertIn("考勤初稿待审核", signed["BK6"].value)
		self.assertIn("考勤初稿待审核", finance["S6"].value)

	def test_pending_attendance_date_excludes_only_that_date(self):
		api = self.api
		batch = types.SimpleNamespace(source_type="attendance_draft", company="测试公司", attendance_month="2026-08")
		details = [
			{"attendance_date": f"2026-08-0{day}", "source_row": day + 4,
			 "standard_hours": 8, "actual_attendance_hours": 8}
			for day in (1, 2)
		]
		record = {
			"source_type": "attendance_draft", "attendance_month": "2026-08",
			"employee_code": "E-002", "employee_name": "张三", "department": "工程课",
			"review_status": "待审核", "eligible_for_downstream": False,
			"exception_codes": ["LATE"],
			"processed_value": {"standard_hours": 16, "actual_attendance_hours": 16,
				"source_row_count": 2, "attendance_details": details,
				"exception_lines": [{**details[0], "exception_codes": ["LATE"]}]},
			"original_value": {"rows": [
				{"姓名": "张三", "工号": "E-002", "日期": f"26-08-0{day} 星期六", "source_row": day + 4}
				for day in (1, 2)
			]},
		}
		with patch.object(api, "_result_rows", return_value=[record]), patch.object(api, "_employee_directory", return_value=[]):
			rows = api._monthly_final_rows({"attendance_draft": batch})
			daily = api._monthly_first_signed_daily_rows({"attendance_draft": batch})
		self.assertEqual(len(rows), 1)
		self.assertEqual((rows[0]["standard_hours"], rows[0]["actual_attendance_hours"]), (8, 8))
		self.assertIn("1条待审核考勤日期未计入本次汇总", rows[0]["review_note"])
		self.assertEqual([row[2] for row in daily], ["26-08-01 星期六", "26-08-02 星期六"])
		self.assertIn("待审核，本次汇总未计入", daily[0][-1])
		self.assertNotIn("待审核", daily[1][-1])

	def test_old_second_signed_output_requires_regeneration_before_preview(self):
		api = self.api
		with (
			patch.object(api, "_require_processing_manager"),
			patch.object(api, "_require_company", side_effect=lambda value: value),
			patch.object(api, "_require_month", side_effect=lambda value: value),
			patch.object(api, "_latest_batch", return_value=types.SimpleNamespace()),
			patch.object(api, "get_locked_final_outputs", return_value={
				"locked_snapshot_version": "snapshot", "layout_version": api.MONTHLY_FINAL_LAYOUT_VERSION - 1,
			}),
		):
			preview = api.get_monthly_final_preview("测试公司", "2026-08", "signed")
		self.assertFalse(preview["available"])
		self.assertTrue(preview["stale"])
		self.assertIn("重新锁定", preview["reason"])

	def test_first_signed_remark_only_shows_monthly_late_count(self):
		api = self.api
		monthly_rows = [
			{"employee_code": "E-001", "late_count": 2, "review_note": "2026-07-01迟到30分钟；2026-07-08迟到15分钟"},
			{"employee_code": "E-002", "late_count": 0, "review_note": "来源处理明细"},
		]
		with patch.object(api, "_monthly_final_rows", return_value=monthly_rows), patch.object(api, "_employee_directory", return_value=[]):
			rows = api._monthly_first_signed_rows({"attendance_draft": types.SimpleNamespace(company="测试公司")})
		self.assertEqual([row["review_note"] for row in rows], ["迟到2次", ""])

	def test_confirmed_special_hours_override_same_day_derived_from_attendance(self):
		api = self.api
		attendance = types.SimpleNamespace(
			source_type="attendance_draft", company="测试公司", attendance_month="2026-07",
		)
		special = types.SimpleNamespace(
			source_type="special_hours", company="测试公司", attendance_month="2026-07",
		)
		api._result_rows = lambda batch, *args, **kwargs: [{
			"employee_code": "E-001", "employee_name": "张三", "department": "工程课",
			"eligible_for_downstream": True,
			"processed_value": {
				"standard_hours": 176, "actual_attendance_hours": 176,
				"special_hours": 1, "special_hours_days": [{"day": 1, "hours": 1}],
			},
		}] if batch.source_type == "attendance_draft" else [{
			"employee_code": "E-001", "employee_name": "张三", "department": "工程课",
			"eligible_for_downstream": True,
			"processed_value": {
				"special_hours": 2.5,
				"special_hours_days": [{"day": 1, "hours": 0.5}, {"day": 2, "hours": 2}],
			},
		}]
		api._special_hours_breakdown = lambda entries, *_args: {
			"special_workday_hours": sum(entry["hours"] for entry in entries),
			"special_restday_hours": 0,
			"special_holiday_hours": 0,
		}

		rows = api._monthly_final_rows({"attendance_draft": attendance, "special_hours": special})

		self.assertEqual(rows[0]["special_hours_days"], [{"day": 1, "hours": 0.5}, {"day": 2, "hours": 2.0}])
		self.assertEqual(rows[0]["special_workday_hours"], 2.5)

	def test_confirmed_special_hours_blank_dates_and_missing_people_do_not_keep_derived_hours(self):
		api = self.api
		attendance = types.SimpleNamespace(
			source_type="attendance_draft", company="测试公司", attendance_month="2026-08",
		)
		special = types.SimpleNamespace(
			source_type="special_hours", company="测试公司", attendance_month="2026-08",
		)
		attendance_records = [
			{"source_type": "attendance_draft", "employee_code": code, "employee_name": code,
			 "eligible_for_downstream": True, "processed_value": {
				 "employee_code": code, "employee_name": code,
				 "special_workday_hours": sum(item["hours"] for item in entries),
				 "special_hours_days": entries,
			 }}
			for code, entries in (
				("E-001", [{"day": 3, "hours": 1}, {"day": 4, "hours": 1}]),
				("E-002", [{"day": 3, "hours": 1}]),
			)
		]
		special_records = [{
			"employee_code": "E-001", "employee_name": "E-001", "eligible_for_downstream": True,
			"processed_value": {"special_hours_days": [{"day": 3, "hours": 0.5}], "special_hours": 0.5},
		}]
		with (
			patch.object(api, "_result_rows", side_effect=lambda batch, *args, **kwargs:
				attendance_records if batch.source_type == "attendance_draft" else special_records),
			patch.object(api, "_company_statutory_holidays", return_value=set()),
		):
			with_source = api._monthly_final_rows({"attendance_draft": attendance, "special_hours": special})
			without_source = api._monthly_final_rows({"attendance_draft": attendance})
		self.assertEqual([(row["employee_code"], row["special_workday_hours"]) for row in with_source],
			[("E-001", 0.5), ("E-002", 0.0)])
		self.assertEqual(with_source[0]["special_hours_days"], [{"day": 3, "hours": 0.5}])
		self.assertEqual(with_source[1]["special_hours_days"], [])
		self.assertEqual([(row["employee_code"], row["special_workday_hours"]) for row in without_source],
			[("E-001", 2.0), ("E-002", 1.0)])

	def test_old_first_signed_output_requires_regeneration_before_preview(self):
		api = self.api
		with (
			patch.object(api, "_require_processing_manager"),
			patch.object(api, "_require_company", side_effect=lambda value: value),
			patch.object(api, "_require_month", side_effect=lambda value: value),
			patch.object(api, "_latest_batch", return_value=types.SimpleNamespace()),
			patch.object(api, "_processing_meta", return_value={"first_signed_outputs": {
				"locked_snapshot_version": "snapshot", "layout_version": api.FIRST_SIGNED_LAYOUT_VERSION - 1,
			}}),
		):
			preview = api.get_monthly_final_preview("测试公司", "2026-08", "first_signed")
		self.assertFalse(preview["available"])
		self.assertTrue(preview["stale"])
		self.assertIn("重新生成", preview["reason"])

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
			daily_row = ["张三", "E-001", "26-07-01 星期三", "工程课", "工作日", "长白班", "08:01", "17:00"] + [None] * 32 + ["08:00", "17:00", 0, 0, "无申请", "2026-07-01迟到1分钟（半小时以内）"]
			result = api._save_monthly_first_signed_confirmation_file("2026-07", [{
				"sequence": 1, "department": "工程课", "employee_name": "张三", "employee_code": "E-001",
				"date_of_joining": "2008-06-16", "standard_hours": 176, "actual_attendance_hours": 168,
				"special_workday_hours": 2, "workday_overtime_hours": 2, "large_night_shifts": 1, "absence_hours": 0,
				"review_note": "迟到2次",
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
		self.assertEqual(daily.max_column, 46)
		self.assertEqual(daily["AO1"].value, "计划上班")
		self.assertEqual(daily["AT3"].value, "2026-07-01迟到1分钟（半小时以内）")
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
		self.assertEqual(sheet["Z5"].value, "迟到2次")
		self.assertEqual(sheet.max_column, 29)
		self.assertTrue(all(sheet.column_dimensions[column].hidden for column in "RSTUVWX"))
		self.assertFalse(sheet.column_dimensions["Y"].hidden)

	def test_leave_columns_follow_monthly_values_for_excel_and_preview(self):
		api = self.api
		rows = [
			{"employee_code": "E-001", "personal_leave_hours": 0, "sick_leave_hours": None},
			{"employee_code": "E-002", "sick_leave_hours": 8, "reunion_leave_hours": 4},
		]
		visible_fields = [field for field, _label in api._first_signed_visible_columns(rows)]
		self.assertNotIn("personal_leave_hours", visible_fields)
		self.assertIn("sick_leave_hours", visible_fields)
		self.assertIn("reunion_leave_hours", visible_fields)
		self.assertIn("employee_signature", visible_fields)

		captured = {}
		file_manager = sys.modules["frappe.utils.file_manager"]
		old_save_file = file_manager.save_file
		file_manager.save_file = lambda name, content, *args, **kwargs: (captured.update(content=content) or types.SimpleNamespace(file_url="/private/files/first-signed.xlsx", file_name=name))
		try:
			api._save_monthly_first_signed_confirmation_file("2026-07", rows)
		finally:
			file_manager.save_file = old_save_file
		sheet = load_workbook(io.BytesIO(captured["content"]))["工时汇总"]
		self.assertTrue(sheet.column_dimensions["R"].hidden)
		self.assertFalse(sheet.column_dimensions["S"].hidden)
		self.assertTrue(all(sheet.column_dimensions[column].hidden for column in "TUVW"))
		self.assertFalse(sheet.column_dimensions["X"].hidden)
		self.assertEqual(sheet["S6"].value, 8)
		self.assertEqual(sheet["X6"].value, 4)

	def test_employee_preview_uses_whole_month_to_choose_columns(self):
		api = self.api
		batch = types.SimpleNamespace(company="测试公司")
		rows = [
			{"employee_code": "E-001", "sick_leave_hours": 0},
			{"employee_code": "E-002", "sick_leave_hours": 8},
		]
		with (
			patch.object(api, "_require_processing_manager"),
			patch.object(api, "_require_company", side_effect=lambda value: value),
			patch.object(api, "_require_month", side_effect=lambda value: value),
			patch.object(api, "_latest_batch", return_value=batch),
			patch.object(api, "_processing_meta", return_value={"first_signed_outputs": {"locked_snapshot_version": "snapshot", "layout_version": api.FIRST_SIGNED_LAYOUT_VERSION}}),
			patch.object(api, "_first_signed_snapshot_batches", return_value={"attendance_draft": batch}),
			patch.object(api, "_monthly_snapshot_version", return_value="snapshot"),
			patch.object(api, "_monthly_first_signed_rows", return_value=rows),
		):
			preview = api.get_monthly_final_preview("测试公司", "2026-07", "first_signed", "E-001")
		self.assertEqual([row["employee_code"] for row in preview["rows"]], ["E-001"])
		self.assertIn("sick_leave_hours", [column["field"] for column in preview["columns"]])

	def test_daily_projection_exports_calculated_and_confirmed_overtime_separately(self):
		api = self.api
		batch = types.SimpleNamespace(source_type="attendance_draft")
		api._result_rows = lambda *_args, **_kwargs: [{
			"employee_code": "E-001", "employee_name": "张三", "department": "工程课", "eligible_for_downstream": True,
			"source_file": "sample.xlsx", "source_sheet": "每日统计",
			"original_value": {"rows": [{
				"姓名": "张三", "工号": "E-001", "日期": "26-07-01", "实际部门": "工程课", "工作类型": "工作日",
				"班次": "白班 08:00-17:00", "上班时间": "08:30", "下班时间": "18:00", "source_file": "sample.xlsx",
				"source_sheet": "每日统计", "source_row": 3,
			}]},
			"processed_value": {"attendance_details": [{
				"attendance_date": "2026-07-01", "source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 3,
				"personal_leave_hours": 0.5, "late_count": 1, "scheduled_start": "08:00", "scheduled_end": "17:00",
				"raw_outside_shift_hours": 1.75, "calculated_workday_overtime_hours": 1.5,
				"confirmed_overtime_hours": 0.75, "overtime_approval_status": "人工确认",
				"attendance_note": "2026-07-01迟到30分钟（半小时以内）",
			}]},
		}]

		rows = api._monthly_first_signed_daily_rows({"attendance_draft": batch})

		self.assertEqual(rows[0][14], 1.5)
		self.assertEqual(rows[0][19], 0.5)
		self.assertEqual(rows[0][4], "工作日")
		self.assertEqual(rows[0][38], 1)
		self.assertEqual(rows[0][40:46], ["08:00", "17:00", 1.75, 0.75, "人工确认", "2026-07-01迟到30分钟（半小时以内）"])

	def test_daily_projection_never_derives_weekday_overtime_from_punches(self):
		api = self.api
		batch = types.SimpleNamespace(source_type="attendance_draft")
		api._result_rows = lambda *_args, **_kwargs: [{
			"employee_code": "E-001", "employee_name": "张三", "department": "工程课", "eligible_for_downstream": True,
			"source_file": "sample.xlsx", "source_sheet": "每日统计",
			"original_value": {"rows": [{
				"姓名": "张三", "工号": "E-001", "日期": "26-07-01", "实际部门": "工程课", "工作类型": "工作日",
				"班次": "间接长白班 08:00-17:00", "上班时间": "08:00", "下班时间": "20:03",
				"工作日加班（小时）": 0, "source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 3,
			}]},
			"processed_value": {"attendance_details": [{
				"attendance_date": "2026-07-01", "source_file": "sample.xlsx", "source_sheet": "每日统计", "source_row": 3,
				"raw_workday_overtime_hours": 0, "raw_outside_shift_hours": 3.05, "special_workday_hours": 1,
				"confirmed_overtime_hours": 0, "overtime_approval_status": "无申请",
			}]},
		}]

		rows = api._monthly_first_signed_daily_rows({"attendance_draft": batch})

		self.assertEqual(rows[0][14], 0)
		self.assertEqual(rows[0][42:45], [3.05, 0, "无申请"])

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
				"review_note": "2026-07-01迟到30分钟（半小时以内）",
			}])
		finally:
			file_manager.save_file = old_save_file

		self.assertEqual(captured["name"], "2026-07_第二次员工签字版.xlsx")
		book = load_workbook(io.BytesIO(captured["content"]), data_only=False)
		sheet = book["第二次员工签字版"]
		self.assertIn("D1:BK1", {str(item) for item in sheet.merged_cells.ranges})
		self.assertIn("J2:K2", {str(item) for item in sheet.merged_cells.ranges})
		self.assertIn("AE2:AG2", {str(item) for item in sheet.merged_cells.ranges})
		self.assertIn("B6:H6", {str(item) for item in sheet.merged_cells.ranges})
		self.assertEqual(sheet["D1"].value, "7月工时奖惩确认表")
		self.assertEqual(sheet["AG3"].value, "团圆假\n工时")
		self.assertEqual(sheet["BK2"].value, "备注")
		self.assertEqual(sheet["BK5"].value, "2026-07-01迟到30分钟（半小时以内）")
		self.assertEqual(sheet["X5"].value, 40)
		self.assertEqual(sheet["AJ5"].value, "=J5+K5")
		self.assertTrue(sheet.row_dimensions[4].hidden)
		self.assertTrue(all(sheet.cell(row=4, column=column).value is None for column in range(2, sheet.max_column + 1)))
		self.assertEqual(sheet.freeze_panes, "J4")
		self.assertEqual(sheet["R10"].value, "审核：")
		self.assertEqual(sheet["AS10"].value, "审核：")
		self.assertEqual(sheet["BA10"].value, "复核：")
		self.assertEqual(sheet["BI10"].value, "制表：李微微2026.6.11")

	def test_all_disabled_company_shift_rules_do_not_use_builtin_fallback(self):
		api = self.api
		row = {
			"name": "RULE-1", "enabled": 0, "rule_code": "SHIFT-002", "rule_name": "生产夜班",
			"sequence": 2, "match_tokens": "生产|夜班", "basic_time": "20:00-4:30",
			"weekday_overtime_time": "4:30-8:00", "weekday_overtime_hours": 3.5,
			"weekday_overtime_mode": "不提交加班单", "weekend_overtime_mode": "不提交加班单",
			"punch_in_range": "18:00-20:29", "punch_out_range": "20:30-10:00",
		}
		old_get_all = api.frappe.get_all
		old_exists = getattr(api.frappe.db, "exists", None)
		try:
			api.frappe.get_all = lambda *args, **kwargs: [row]
			api.frappe.db.exists = lambda *args, **kwargs: True
			bundle = api._attendance_shift_rule_bundle("永新")
		finally:
			api.frappe.get_all = old_get_all
			if old_exists is None:
				delattr(api.frappe.db, "exists")
			else:
				api.frappe.db.exists = old_exists

		self.assertEqual(bundle["rules"], [])
		self.assertFalse(bundle["version"].startswith("builtin-"))

	def test_complete_rule_center_returns_shift_policy_and_system_rules(self):
		api = self.api
		fake_import = types.ModuleType("hrms.api.attendance_import")
		fake_import.list_attendance_custom_rules = lambda page_length=0: [{
			"rule_code": "ATT-LATE-30", "rule_name": "迟到提示", "enabled": 1,
		}]
		old_import = sys.modules.get("hrms.api.attendance_import")
		old_bundle = api._attendance_shift_rule_bundle
		old_scheduling_policies = api.list_attendance_scheduling_policies
		old_permission = api._require_processing_manager
		old_company = api._require_company
		try:
			sys.modules["hrms.api.attendance_import"] = fake_import
			api._attendance_shift_rule_bundle = lambda company: {
				"items": [{"rule_code": "SHIFT-001", "rule_name": "生产白班"}],
				"rules": [{"rule_code": "SHIFT-001"}], "version": "rules-v1",
			}
			api.list_attendance_scheduling_policies = lambda company: {"items": []}
			api._require_processing_manager = lambda: None
			api._require_company = lambda company: company
			result = api.get_complete_attendance_rules("永新")
		finally:
			api._attendance_shift_rule_bundle = old_bundle
			api.list_attendance_scheduling_policies = old_scheduling_policies
			api._require_processing_manager = old_permission
			api._require_company = old_company
			if old_import is None:
				del sys.modules["hrms.api.attendance_import"]
			else:
				sys.modules["hrms.api.attendance_import"] = old_import

		self.assertEqual(result["shift_rule_version"], "rules-v1")
		self.assertEqual(result["shift_rules"][0]["rule_code"], "SHIFT-001")
		self.assertEqual(result["policy_rules"][0]["rule_code"], "ATT-LATE-30")
		self.assertTrue(any(row["rule_name"] == "中班" for row in result["builtin_shift_rules"]))
		self.assertGreaterEqual(len(result["system_boundaries"]), 9)
		self.assertTrue(any(item["name"] == "周末与调班边界" for item in result["system_boundaries"]))
		self.assertTrue(any(item["name"] == "单边打卡（含周末）" for item in result["system_boundaries"]))
		self.assertTrue(any(item["name"] == "入职前或离职后日期" for item in result["system_boundaries"]))

	def test_shift_match_preview_uses_active_matcher_without_writing(self):
		api = self.api
		old_bundle = api._attendance_shift_rule_bundle
		old_permission = api._require_processing_manager
		old_company = api._require_company
		try:
			api._attendance_shift_rule_bundle = lambda company: {"rules": None, "version": "builtin-test"}
			api._require_processing_manager = lambda: None
			api._require_company = lambda company: company
			result = api.preview_attendance_shift_match("永新", "中班 13:00-22:00", "2026-07-05")
			api._attendance_shift_rule_bundle = lambda company: {"rules": [], "version": "company-disabled"}
			disabled = api.preview_attendance_shift_match("永新", "中班 13:00-22:00", "2026-07-05")
		finally:
			api._attendance_shift_rule_bundle = old_bundle
			api._require_processing_manager = old_permission
			api._require_company = old_company
		self.assertTrue(result["matched"])
		self.assertEqual(result["rule_name"], "中班")
		self.assertEqual(result["source"], "内置兼容规则")
		self.assertEqual(result["rule_version"], "builtin-test")
		self.assertFalse(disabled["matched"])


if __name__ == "__main__":
	unittest.main()
