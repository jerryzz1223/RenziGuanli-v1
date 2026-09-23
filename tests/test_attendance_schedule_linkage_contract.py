from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
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

	def test_ccd_white_confirmed_resolution_is_present_in_import_source(self):
		api_source = API_PY.read_text(encoding="utf-8")
		self.assertIn('ccd_white_confirmed = current_group == "CCD人员" and shift_name == "白班"', api_source)
		self.assertIn('item["weekday_overtime_hours"] = 3', api_source)
		self.assertIn('平日加班3H，总休息1H', api_source)

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


if __name__ == "__main__":
	unittest.main()
