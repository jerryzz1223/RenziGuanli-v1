from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_attendance_daily_exception_resolution import load_processing_center


ROOT = Path(__file__).resolve().parents[1]
SHIFT_RULE_JSON = ROOT / "hrms/hr/doctype/hrms_attendance_shift_rule/hrms_attendance_shift_rule.json"
POLICY_JSON = ROOT / "hrms/hr/doctype/hrms_attendance_scheduling_policy/hrms_attendance_scheduling_policy.json"
POLICY_PY = ROOT / "hrms/hr/doctype/hrms_attendance_scheduling_policy/hrms_attendance_scheduling_policy.py"
API_PY = ROOT / "hrms/api/attendance_processing_center.py"
PAGE_JS = ROOT / "hrms/hr/page/attendance_import_center/attendance_import_center.js"


class AttendanceScheduleLinkageContractTest(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls.api = load_processing_center()

	def test_segmented_shift_has_native_outer_window_and_business_segment_marker(self):
		values = self.api._schedule_shift_type_values({
			"basic_time": "08:00-13:00\n15:30-18:00",
			"punch_in_range": "06:00-08:29",
			"punch_out_range": "08:30-24:00",
		})
		self.assertEqual(values["start_time"], "08:00:00")
		self.assertEqual(values["end_time"], "18:00:00")
		self.assertEqual(values["segment_count"], 2)
		self.assertEqual(values["begin_check_in_before_shift_start_time"], 120)
		self.assertEqual(values["allow_check_out_after_shift_end_time"], 360)

	def test_rule_and_policy_schemas_retain_linkage_audit_fields(self):
		shift_fields = {field["fieldname"] for field in json.loads(SHIFT_RULE_JSON.read_text())["fields"]}
		policy_fields = {field["fieldname"] for field in json.loads(POLICY_JSON.read_text())["fields"]}
		self.assertTrue({"shift_type", "shift_sync_status", "shift_sync_message"} <= shift_fields)
		self.assertTrue({"generated_from_schedule", "source_version", "source_file", "source_checksum", "source_sync_on", "calendar_weekend_mode"} <= policy_fields)

	def test_all_source_columns_have_explicit_rule_mapping_and_usage(self):
		mapping = self.api._schedule_source_field_mapping()
		self.assertEqual([item["column"] for item in mapping], list("BCDEFGHIJKLMNOPQRSTU"))
		self.assertEqual(len({item["fieldname"] for item in mapping}), len(mapping))
		self.assertEqual(next(item for item in mapping if item["column"] == "L")["fieldname"], "weekday_overtime_hours")
		self.assertIn("数值栏优先于备注", next(item for item in mapping if item["column"] == "L")["application"])
		self.assertIn("缺单判断", next(item for item in mapping if item["column"] == "O")["application"])

	def test_imported_ccd_value_reaches_processor_bundle_without_audit_version_noise(self):
		base = {
			"name": "rule-ccd", "enabled": 1, "rule_code": "SHIFT-014", "rule_name": "CCD人员白班",
			"match_tokens": "CCD人员|白班", "weekday_overtime_hours": 2.5,
			"weekday_overtime_mode": "不提交加班单", "weekday_overtime_time": "17:00-20:00",
			"source_payload_json": '["first source row"]',
		}
		with patch.object(self.api.frappe.db, "exists", return_value=True), patch.object(
			self.api.frappe, "get_all", return_value=[base], create=True
		):
			first = self.api._attendance_shift_rule_bundle("永新")
		self.assertEqual(first["rules"][0]["workday_hours"], "2.5")
		self.assertEqual(first["rules"][0]["workday_end_minutes"], 20 * 60)
		with patch.object(self.api.frappe.db, "exists", return_value=True), patch.object(
			self.api.frappe, "get_all", return_value=[{**base, "source_payload_json": '["new audit text"]'}], create=True
		):
			second = self.api._attendance_shift_rule_bundle("永新")
		self.assertEqual(first["version"], second["version"])

	def test_specific_quality_shift_precedes_broad_production_shift(self):
		base = {"enabled": 1, "weekday_overtime_hours": 3, "weekday_overtime_mode": "不提交加班单"}
		rows = [
			{**base, "name": "production", "rule_code": "SHIFT-001", "rule_name": "生产人员白班", "match_tokens": "生产|白班"},
			{**base, "name": "quality", "rule_code": "SHIFT-005", "rule_name": "品保10点生产白班", "match_tokens": "品保10点生产白班"},
		]
		with patch.object(self.api.frappe.db, "exists", return_value=True), patch.object(
			self.api.frappe, "get_all", return_value=rows, create=True
		):
			bundle = self.api._attendance_shift_rule_bundle("永新")
		self.assertEqual([rule["name"] for rule in bundle["rules"]], ["品保10点生产白班", "生产人员白班"])
		self.assertEqual(bundle["rules"][0]["dingtalk_attendance_groups"], "品保10点班生产白班|品保10点生产白班")
		self.assertIn("品保10点班生产白班", bundle["rules"][0]["dingtalk_shift_aliases"])

	def test_existing_shift_type_is_preserved_for_review(self):
		item = {
			"rule_code": "SHIFT-001", "rule_name": "生产人员白班", "basic_time": "08:00-16:30",
			"punch_in_range": "06:00-08:29", "punch_out_range": "08:30-22:00",
		}
		with patch.object(self.api.frappe.db, "exists", return_value=True), patch.object(
			self.api, "_schedule_shift_type_name", return_value="YX-SHIFT-001"
		), patch.object(self.api.frappe, "get_doc", side_effect=AssertionError("existing Shift Type must not be rewritten"), create=True):
			result = self.api._sync_schedule_shift_type("永新", item, "YX-SHIFT-001")
		self.assertEqual(result["action"], "保留并复核")
		self.assertEqual(result["name"], "YX-SHIFT-001")

	def test_special_note_time_conflict_is_reported_without_guessing(self):
		warnings = self.api._schedule_special_note_warnings(
			[{
				"rule_name": "烧饭阿姨夜班", "source_row": 17,
				"weekday_overtime_time": "21:30-24:00",
			}],
			[{
				"source_row": 26,
				"text": "2）夜班11H出勤：08:00-13:00 15:30-18:00 21:00-24:00",
			}],
		)
		self.assertEqual(len(warnings), 1)
		self.assertEqual(warnings[0]["source_row"], 17)
		self.assertEqual(warnings[0]["related_source_row"], 26)
		self.assertIn("请确认后再启用", warnings[0]["message"])
		mapped_name = self.api._schedule_special_note_warnings(
			[{"rule_name": "食堂夜班", "source_row": 17, "weekday_overtime_time": "21:30-24:00"}],
			[{"source_row": 26, "text": "夜班：08:00-13:00 15:30-18:00 21:00-24:00"}],
		)
		self.assertEqual(len(mapped_name), 1)

	def test_ccd_white_uses_numeric_source_hours_not_remark(self):
		sheet = self._ccd_source_sheet()
		with patch.object(self.api, "_load_workbook", return_value=SimpleNamespace(worksheets=[sheet])), patch.object(
			self.api, "_file_checksum", return_value="source-checksum"
		), patch.object(self.api, "_file_doc", return_value=SimpleNamespace(file_name="排班表.xlsx")):
			parsed = self.api._schedule_rule_import_rows("fixture.xlsx")
		self.assertEqual(len(parsed["items"]), 1)
		self.assertEqual(parsed["issues"], [])
		item = parsed["items"][0]
		self.assertEqual(item["weekday_overtime_hours"], 2.5)
		self.assertEqual(item["meal_deduction_rule"], "12:00-13:00扣1H\n17:00-17:30扣0.5H")
		self.assertEqual(item["remarks"], "工作日系统自动生成3小时平时加班单")
		self.assertEqual(json.loads(item["source_payload_json"])[11], "2.5")
		self.assertEqual(json.loads(item["source_payload_json"])[9], "12:00-12:00扣1H\n17:00-17:30扣0.5H")
		self.assertEqual({entry["fieldname"] for entry in parsed["source_resolutions"]}, {"weekday_overtime_hours", "meal_deduction_rule"})
		self.assertFalse(any("休息时段合计" in warning["message"] for warning in parsed["warnings"]))
		self.assertFalse(any("采用数值栏 2.5 小时" in warning["message"] for warning in parsed["warnings"]))
		self.assertTrue(any("数值栏 2.5 小时" in entry["message"] for entry in parsed["source_resolutions"]))

	def test_confirmed_food_note_changes_only_known_night_source_conflict(self):
		items = [
			{"rule_name": "食堂夜班", "source_row": 17, "weekday_overtime_time": "21:30-24:00", "workday_end_minutes": 0},
			{"rule_name": "食堂白班", "source_row": 16, "weekday_overtime_time": "16:00-18:00", "workday_end_minutes": 1080},
		]
		notes = [{"source_row": 26, "text": "2）夜班11H出勤：08:00-13:00 15:30-18:00 21:00-24:00"}]
		resolutions = self.api._schedule_apply_confirmed_source_values(items, notes)
		self.assertEqual(items[0]["weekday_overtime_time"], "21:00-24:00")
		self.assertEqual(items[0]["workday_end_minutes"], 0)
		self.assertEqual(items[1]["weekday_overtime_time"], "16:00-18:00")
		self.assertEqual(resolutions[0]["related_source_row"], 26)
		self.assertEqual(self.api._schedule_special_note_warnings(items, notes), [])
		unchanged = [{"rule_name": "食堂夜班", "source_row": 17, "weekday_overtime_time": "20:30-24:00"}]
		self.assertEqual(self.api._schedule_apply_confirmed_source_values(unchanged, notes), [])
		self.assertEqual(unchanged[0]["weekday_overtime_time"], "20:30-24:00")
		self.assertEqual(len(self.api._schedule_special_note_warnings(unchanged, notes)), 1)

	def test_shift_import_rejects_moved_source_column(self):
		sheet = self._ccd_source_sheet()
		sheet.rows[5][11] = "周末加班"
		def reject(message):
			raise ValueError(message)
		with patch.object(self.api, "_load_workbook", return_value=SimpleNamespace(worksheets=[sheet])), patch.object(
			self.api, "_file_checksum", return_value="source-checksum"
		), patch.object(self.api, "_file_doc", return_value=SimpleNamespace(file_name="排班表.xlsx")), patch.object(
			self.api.frappe, "throw", side_effect=reject, create=True
		):
			with self.assertRaisesRegex(ValueError, "L5.*平日加班"):
				self.api._schedule_rule_import_rows("fixture.xlsx")

	@staticmethod
	def _ccd_source_sheet():
		class Sheet:
			title = "班别排配表"
			max_row = 6
			rows = {number: [None] * 21 for number in range(1, 7)}

			def cell(self, row, column):
				return SimpleNamespace(value=self.rows[row][column - 1])

			def iter_rows(self, min_row=1, max_row=None, values_only=False):
				for number in range(min_row, (max_row or self.max_row) + 1):
					values = self.rows[number]
					yield tuple(values) if values_only else tuple(SimpleNamespace(value=value) for value in values)

		sheet = Sheet()
		for letter, label, row in (
			("B", "序号", 4), ("C", "班别名称", 4), ("E", "基本工时上下班时间", 4),
			("F", "平日加班起止时间", 4), ("G", "周末加班起止时间", 4),
			("H", "班后开始加班时间", 4), ("I", "是否隔夜", 4),
			("J", "吃饭扣除时间段（休息）", 4), ("K", "基本工时", 5),
			("L", "平日加班", 5), ("M", "延班", 5), ("N", "周末加班", 5),
			("O", "节日加班", 5), ("P", "小夜班（24元/个）", 5),
			("Q", "大夜班（45元/个）", 5), ("R", "备注", 4),
			("S", "建议岗位", 4), ("T", "上班时间", 5), ("U", "下班时间", 5),
		):
			sheet.rows[row][ord(letter) - ord("A")] = label
		for letter, value in (
			("B", 14), ("C", "CCD人员"), ("D", "白班"), ("E", "08:00-17:00"),
			("F", "17:00-20:00"), ("H", "20:00"), ("I", "否"),
			("J", "12:00-12:00扣1H\n17:00-17:30扣0.5H"), ("K", 8), ("L", 2.5),
			("M", "特殊工时"), ("N", "不提交加班单"), ("P", "无"), ("Q", "无"),
			("R", "工作日系统自动生成3小时平时加班单"), ("S", "CCD人员"),
			("T", "06:00-08:29"), ("U", "08:30-22:00"),
		):
			sheet.rows[6][ord(letter) - ord("A")] = value
		return sheet

	def test_warehouse_shift_accepts_production_control_department_scope_wording(self):
		api_source = API_PY.read_text(encoding="utf-8")
		self.assertIn('"生管仓库": ("生管课",)', api_source)

	def test_ccd_night_accepts_production_night_allowance_wording(self):
		api_source = API_PY.read_text(encoding="utf-8")
		self.assertIn('"CCD人员": ("生产人员",)', api_source)

	def test_import_preview_and_policy_validation_use_the_link(self):
		api_source = API_PY.read_text(encoding="utf-8")
		policy_source = POLICY_PY.read_text(encoding="utf-8")
		page_source = PAGE_JS.read_text(encoding="utf-8")
		for marker in ("_sync_schedule_shift_type", "shift_type_created_count", "create_default_policy", "linkage_options"):
			self.assertIn(marker, api_source)
		self.assertIn("linked_shift_hours", policy_source)
		for marker in ("联动计划", "sync_shift_types", "系统班次联动"):
			self.assertIn(marker, page_source)
		for marker in ("calendar_weekend_mode", "周末与调班边界"):
			self.assertIn(marker, api_source)
		self.assertIn("普通周六日考勤口径", page_source)
		self.assertNotIn("confirm_source_warnings", api_source)
		self.assertNotIn("confirm_source_warnings", page_source)
		self.assertIn('if not options.get("source_checksum"):', api_source)


if __name__ == "__main__":
	unittest.main()
