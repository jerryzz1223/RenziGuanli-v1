import importlib.util
import sys
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import patch


class Row(dict):
	__getattr__ = dict.get


class OrganizationTemplateTest(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		root = Path(__file__).parents[1]
		roles_spec = importlib.util.spec_from_file_location(
			"hrms.utils.organization_roles",
			root / "hrms/utils/organization_roles.py",
		)
		roles = importlib.util.module_from_spec(roles_spec)
		roles_spec.loader.exec_module(roles)
		with patch.dict(sys.modules, {
			"hrms": ModuleType("hrms"),
			"hrms.api": ModuleType("hrms.api"),
			"hrms.utils": ModuleType("hrms.utils"),
			"hrms.utils.organization_roles": roles,
		}):
			template_spec = importlib.util.spec_from_file_location(
				"organization_template_test",
				root / "hrms/api/organization_template.py",
			)
			cls.module = importlib.util.module_from_spec(template_spec)
			template_spec.loader.exec_module(cls.module)

	def test_organization_position_is_displayed_without_becoming_roster_assignment(self):
		config = {
			"node_kind": "岗位",
			"role_title": "作业员",
			"assigned_employees": [],
			"organization_placements": [{
				"employee": "EMP-1",
				"source_code": "0026",
				"source_name": "张三",
				"role": "作业员",
			}],
		}
		labels = {
			"EMP-1": Row(
				name="EMP-1",
				employee_name="张三",
				custom_employee_code="0026",
				designation="检验员",
				department=None,
				image="/files/avatar.png",
				reports_to=None,
			)
		}

		people = self.module.card_people(config, labels, {"EMP-1"})

		self.assertEqual([person["employee"] for person in people], ["EMP-1"])
		self.assertEqual(people[0]["employee_code"], "0026")
		self.assertEqual(people[0]["role"], "作业员")
		self.assertEqual(config["assigned_employees"], [])


if __name__ == "__main__":
	unittest.main()
