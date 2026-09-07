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
		for title, expected in [("技术总监", "技术总监：甲"), ("课长", "课长（代理）：甲")]:
			self.assertEqual(roles.role_lines({"role_title": title, "assignment_mode": "自动", "primary_employee": "A"}, self.people), [expected])
		self.assertEqual(self.people["A"]["designation"], "技术总监")

	def test_explicit_mode_wins_and_legacy_stays_formal(self):
		for mode, expected in [("正式", "课长：甲"), ("代理", "课长（代理）：甲"), (None, "课长：甲")]:
			self.assertEqual(roles.role_lines({"role_title": "课长", "assignment_mode": mode, "primary_employee": "A"}, self.people), [expected])

	def test_vacant_title_and_proxy_without_primary(self):
		self.assertEqual(roles.role_lines({"role_title": "课长", "proxy_employee": "B"}, self.people), ["课长：空缺", "课长·代理人：乙"])

	def test_multi_holder_mode_is_per_person_and_deduplicates(self):
		self.assertEqual(roles.role_lines({"role_title": "组长", "assignment_mode": "自动", "primary_employee": "A", "assigned_employees": ["A", "B"]}, self.people), ["组长（代理）：甲", "组长：乙"])

	def test_person_and_supervisor_roles(self):
		for kind, field in [("分管", "manager_employee"), ("员工", "employee")]:
			self.assertEqual(roles.role_lines({"node_kind": kind, field: "A", "role_title": "总监"}, self.people), ["总监：甲"])
