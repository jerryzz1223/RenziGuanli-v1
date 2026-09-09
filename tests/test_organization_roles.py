import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("organization_roles", Path(__file__).parents[1] / "hrms/utils/organization_roles.py")
roles = importlib.util.module_from_spec(spec)
spec.loader.exec_module(roles)


class OrganizationRolesTest(unittest.TestCase):
	def setUp(self):
		self.people = {"A": {"name": "A", "employee_name": "甲", "designation": "技术总监"}, "B": {"name": "B", "employee_name": "乙", "designation": "组长"}}

	def test_main_and_lower_acting_keep_local_title_and_do_not_mutate_roster(self):
		for title, expected in [("技术总监", "技术总监：甲"), ("课长", "课长：甲")]:
			self.assertEqual(roles.role_lines({"role_title": title, "assignment_mode": "自动", "primary_employee": "A"}, self.people), [expected])
		self.assertEqual(self.people["A"]["designation"], "技术总监")

	def test_explicit_mode_wins_and_legacy_stays_formal(self):
		for mode, expected in [("正式", "课长：甲"), ("代理", "课长（代理）：甲"), (None, "课长：甲")]:
			self.assertEqual(roles.role_lines({"role_title": "课长", "assignment_mode": mode, "primary_employee": "A"}, self.people), [expected])

	def test_vacant_title_and_proxy_without_primary(self):
		self.assertEqual(roles.role_lines({"role_title": "课长", "proxy_employee": "B"}, self.people), ["课长：空缺", "课长·代理人：乙"])

	def test_multi_holder_mode_is_per_person_and_deduplicates(self):
		self.assertEqual(roles.role_lines({"role_title": "组长", "assignment_mode": "自动", "primary_employee": "A", "assigned_employees": ["A", "B"]}, self.people), ["组长：甲", "组长：乙"])

	def test_person_and_supervisor_roles(self):
		for kind, field in [("分管", "manager_employee"), ("员工", "employee")]:
			self.assertEqual(roles.role_lines({"node_kind": kind, field: "A", "role_title": "总监"}, self.people), ["总监：甲"])

	def test_unit_legacy_members_never_become_leaders(self):
		for kind in roles.ROSTER_UNIT_KINDS:
			config = {"node_kind": kind, "role_title": "负责人", "primary_employee": "A", "assigned_employees": ["A", "B"]}
			self.assertEqual(roles.role_lines(config, self.people), ["负责人：甲"])
			self.assertEqual(config["assigned_employees"], ["A", "B"])
			config.pop("primary_employee")
			self.assertEqual(roles.role_lines(config, self.people), ["负责人：空缺"])

	def test_position_keeps_multiple_actual_holders(self):
		self.assertEqual(roles.role_lines({"node_kind": "岗位", "role_title": "组长", "assigned_employees": ["A", "B"]}, self.people), ["组长：甲", "组长：乙"])

	def test_acting_marker_requires_same_base_post(self):
		self.assertEqual(roles.display_role("课长", "课长（代）", "自动"), "课长（代）")
		self.assertEqual(roles.display_role("组长", "课长（代）", "自动"), "组长")
		self.assertEqual(roles.display_role("组长（兼）", "总监", "自动"), "组长（兼）")

	def test_source_mentions_are_not_confirmed_formal_posts(self):
		self.assertEqual(roles.binding_assignment_type({"role": "组长"}), "待确认")
		self.assertEqual(roles.binding_assignment_type({"role": "组长", "manual_confirmed": True}), "正式")
		self.assertEqual(roles.binding_assignment_type({"role": "组长（兼）"}), "兼任")
		self.assertEqual(roles.binding_assignment_type({"role": "组长", "assignment_type": "待确认"}), "待确认")
		self.assertEqual(roles.binding_assignment_type({"role": "课长"}, "课长（代）"), "代理任职")
