from __future__ import annotations

import ast
import json
import unittest
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
POLICY_DIR = ROOT / "hrms" / "hr" / "doctype" / "hrms_attendance_scheduling_policy"
POLICY_PY = POLICY_DIR / "hrms_attendance_scheduling_policy.py"
POLICY_JSON = POLICY_DIR / "hrms_attendance_scheduling_policy.json"
SHIFT_ASSIGNMENT_PY = ROOT / "hrms" / "hr" / "doctype" / "shift_assignment" / "shift_assignment.py"
EMPLOYEE_CHECKIN_PY = ROOT / "hrms" / "hr" / "doctype" / "employee_checkin" / "employee_checkin.py"
API_PY = ROOT / "hrms" / "api" / "attendance_processing_center.py"
PAGE_JS = ROOT / "hrms" / "hr" / "page" / "attendance_import_center" / "attendance_import_center.js"


class SchedulingPolicyContractTest(unittest.TestCase):
	def test_policy_schema_covers_reusable_governance_cases(self):
		doc = json.loads(POLICY_JSON.read_text(encoding="utf-8"))
		fields = {field["fieldname"] for field in doc["fields"]}
		required = {
			"company", "policy_name", "scope_type", "scope_values", "effective_from", "effective_to",
			"allow_workday", "max_workday_hours", "allow_restday", "max_restday_hours",
			"allow_holiday", "max_holiday_hours", "max_daily_hours", "allow_multiple_shifts",
			"merge_consecutive_shifts", "consecutive_gap_minutes", "past_change_months",
			"future_change_days", "allow_change_after_checkin", "allow_expired_unscheduled_change",
			"unscheduled_punch_mode",
		}
		self.assertTrue(required <= fields)
		scope = next(field for field in doc["fields"] if field["fieldname"] == "scope_type")
		self.assertEqual(scope["options"], "全公司\n部门\n员工")

	def test_policy_is_server_enforced_and_company_code_scoped(self):
		policy_source = POLICY_PY.read_text(encoding="utf-8")
		ast.parse(policy_source)
		for marker in (
			"custom_employee_code", "get_applicable_scheduling_policy", "validate_shift_assignment_policy",
			"shift_duration_hours", "max_daily_hours", "allow_change_after_checkin",
		):
			self.assertIn(marker, policy_source)
		assignment_source = SHIFT_ASSIGNMENT_PY.read_text(encoding="utf-8")
		self.assertIn("validate_shift_assignment_policy(self)", assignment_source)
		self.assertIn("policy_allows_multiple_shifts", assignment_source)
		checkin_source = EMPLOYEE_CHECKIN_PY.read_text(encoding="utf-8")
		self.assertIn("merged_consecutive_shift_for_checkin", checkin_source)
		self.assertIn("unscheduled_punch_mode", checkin_source)

	def test_linked_shift_hours_include_fixed_workday_overtime_only_on_workdays(self):
		source = ast.parse(POLICY_PY.read_text(encoding="utf-8"))
		function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == "linked_shift_hours")
		rule = SimpleNamespace(basic_hours=8, weekday_overtime_hours=3.5, weekday_overtime_mode="不提交加班单")
		db = SimpleNamespace(exists=lambda *_args: True, get_value=lambda *_args, **_kwargs: rule)
		namespace = {
			"frappe": SimpleNamespace(db=db), "flt": lambda value: float(value or 0),
			"shift_duration_hours": lambda *_args: 99,
		}
		exec(compile(ast.Module(body=[function], type_ignores=[]), str(POLICY_PY), "exec"), namespace)
		hours = namespace["linked_shift_hours"]
		self.assertEqual(hours("永新", "生产夜班", day_type="workday"), 11.5)
		self.assertEqual(hours("永新", "生产夜班", day_type="restday"), 8)

	def test_api_and_rule_center_expose_the_policy(self):
		api_source = API_PY.read_text(encoding="utf-8")
		page_source = PAGE_JS.read_text(encoding="utf-8")
		for marker in ("list_attendance_scheduling_policies", "upsert_attendance_scheduling_policy", '"scheduling_policies"'):
			self.assertIn(marker, api_source)
		for marker in ("一、周末与日历口径", "open_scheduling_policy_dialog", "data-edit-scheduling-policy", "普通周六日考勤口径"):
			self.assertIn(marker, page_source)
		for removed_editor_field in ("工作日排班上限（小时）", "连续班次合并取卡", "未排班打卡方式"):
			dialog = page_source.split("open_scheduling_policy_dialog(existing = {}) {")[1].split("\n\tsplit_schedule_ranges(")[0]
			self.assertNotIn(removed_editor_field, dialog)


if __name__ == "__main__":
	unittest.main()
