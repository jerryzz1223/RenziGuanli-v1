from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RULE_PATH = ROOT / "hrms" / "hr" / "doctype" / "hrms_attendance_shift_rule" / "hrms_attendance_shift_rule.py"


def load_rule_module():
	frappe = types.ModuleType("frappe")
	frappe._ = lambda value, *args: value
	frappe.throw = lambda message, *args, **kwargs: (_ for _ in ()).throw(RuntimeError(message))
	frappe.db = types.SimpleNamespace(get_value=lambda *args, **kwargs: None)
	model = types.ModuleType("frappe.model")
	document = types.ModuleType("frappe.model.document")
	document.Document = type("Document", (), {})
	sys.modules.update({"frappe": frappe, "frappe.model": model, "frappe.model.document": document})
	spec = importlib.util.spec_from_file_location("attendance_shift_rule_validation_test", RULE_PATH)
	module = importlib.util.module_from_spec(spec)
	sys.modules[spec.name] = module
	spec.loader.exec_module(module)
	return module


rule_module = load_rule_module()


class AttendanceShiftRuleValidationTest(unittest.TestCase):
	def make_rule(self, **overrides):
		values = {
			"doctype": "HRMS Attendance Shift Rule", "name": "SHIFT-RULE-00001", "company": "永新",
			"rule_code": "SHIFT-001", "rule_name": "生产夜班", "match_tokens": "生产|夜班",
			"basic_hours": 8, "weekday_overtime_hours": 3.5, "weekday_overtime_mode": "不提交加班单",
			"weekend_overtime_mode": "不提交加班单", "holiday_overtime_mode": "", "basic_time": "20:00-04:30",
			"weekday_overtime_time": "04:30-08:00", "weekend_overtime_time": "", "overtime_begin_time": "08:00",
			"extended_overtime_mode": "加班单", "special_workday_time": "17:00-18:00",
			"overtime_approval_time_mode": "有审批时段则校验", "overtime_approval_reapply_minutes": 30,
			"punch_in_range": "18:00-20:29", "punch_out_range": "20:30-次日10:00",
			"small_night_rule": "上班时间>=8小时，且下班时间在04:30-07:59之间",
			"large_night_rule": "上班时间>=11.5小时，且下班时间等于或晚于08:00",
		}
		values.update(overrides)
		rule = rule_module.HRMSAttendanceShiftRule()
		for key, value in values.items():
			setattr(rule, key, value)
		return rule

	def test_complete_fixed_format_rule_is_accepted(self):
		self.make_rule().validate()

	def test_segmented_shift_and_24_point_night_rule_are_accepted(self):
		self.make_rule(
			basic_time="08:00-13:00\n15:30-18:00",
			small_night_rule="上班时间满8H，且下班时间等于或晚于24点",
			large_night_rule="无",
		).validate()

	def test_unstructured_night_rule_is_rejected(self):
		with self.assertRaisesRegex(RuntimeError, "必须同时包含最低工时"):
			self.make_rule(small_night_rule="符合情况时发小夜班津贴").validate()

	def test_incomplete_pick_range_is_rejected(self):
		with self.assertRaisesRegex(RuntimeError, "固定格式"):
			self.make_rule(punch_out_range="20:30").validate()

	def test_special_work_time_and_extension_mode_are_fixed_fields(self):
		with self.assertRaisesRegex(RuntimeError, "特殊工时时段"):
			self.make_rule(special_workday_time="17:00").validate()
		with self.assertRaisesRegex(RuntimeError, "后续来源"):
			self.make_rule(extended_overtime_mode="随意文字").validate()
		with self.assertRaisesRegex(RuntimeError, "后续免申请"):
			self.make_rule(extended_overtime_mode="不提交加班单", weekday_overtime_mode="加班单").validate()
		with self.assertRaisesRegex(RuntimeError, "审批时间校验方式"):
			self.make_rule(overtime_approval_time_mode="随意文字").validate()
		with self.assertRaisesRegex(RuntimeError, "不能小于"):
			self.make_rule(overtime_approval_reapply_minutes=-1).validate()


if __name__ == "__main__":
	unittest.main()
