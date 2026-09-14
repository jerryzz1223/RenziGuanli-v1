import importlib.util
import sys
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import patch


class Row(dict):
	__getattr__ = dict.get


class PendingOrganizationConfigurationTest(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		frappe = ModuleType("frappe")
		frappe.whitelist = lambda *args, **kwargs: (lambda fn: fn)
		utils = ModuleType("frappe.utils")
		utils.cint = lambda value: int(value or 0)
		utils.cstr = lambda value: "" if value is None else str(value)
		frappe.utils = utils
		path = Path(__file__).parents[1] / "hrms/api/organization_roster_sync.py"
		with patch.dict(sys.modules, {"frappe": frappe, "frappe.utils": utils}):
			spec = importlib.util.spec_from_file_location("organization_roster_sync_pending_test", path)
			cls.module = importlib.util.module_from_spec(spec)
			spec.loader.exec_module(cls.module)

	def test_pending_master_labels_resolve_after_roster_masters_exist(self):
		config = {
			"node_kind": "岗位",
			"department": None,
			"department_label": "业务组",
			"designation": None,
			"designation_label": "业务员",
			"grade": None,
			"grade_label": "文员级",
		}
		unresolved, issues = self.module.resolve_pending_master_links(config, {}, [], [])
		self.assertEqual(unresolved["department_label"], config["department_label"])
		self.assertIsNone(unresolved["department"])
		self.assertIsNone(unresolved["roster_department"])
		self.assertEqual(issues, [])

		resolved, issues = self.module.resolve_pending_master_links(
			config,
			{"D-BUSINESS": Row(name="D-BUSINESS", department_name="业务组")},
			["业务员"],
			["文员级"],
		)
		self.assertEqual(resolved["department"], "D-BUSINESS")
		self.assertEqual(resolved["designation"], "业务员")
		self.assertEqual(resolved["grade"], "文员级")
		self.assertEqual(resolved["department_label"], "业务组")
		self.assertEqual(resolved["designation_label"], "业务员")
		self.assertEqual(resolved["grade_label"], "文员级")
		self.assertEqual(issues, [])

	def test_pending_employee_waits_for_department_then_resolves_by_unique_code(self):
		config = {
			"node_kind": "岗位",
			"assigned_employees": [],
			"pending_person_references": [{
				"field": "assigned_employees", "type": "岗位成员", "source_code": "0026", "source_name": "张三",
			}],
		}
		staff = [Row(name="EMP-26", employee_name="张三", custom_employee_code="0026", department="D-BUSINESS")]
		waiting, issues = self.module.resolve_pending_person_references(config, staff, set())
		self.assertEqual(waiting["assigned_employees"], [])
		self.assertEqual(waiting["pending_person_references"][0]["issue"], "花名册部门与节点配置不一致")
		self.assertEqual(len(issues), 1)

		resolved, issues = self.module.resolve_pending_person_references(config, staff, {"D-BUSINESS"})
		self.assertEqual(resolved["assigned_employees"], ["EMP-26"])
		self.assertEqual(resolved["pending_person_references"], [])
		self.assertEqual(issues, [])

	def test_duplicate_business_code_never_guesses(self):
		config = {"node_kind": "分管", "assigned_employees": [], "pending_person_references": [{
			"field": "manager_employee", "source_code": "88", "source_name": "负责人",
		}]}
		staff = [
			Row(name="A", employee_name="甲", custom_employee_code="88", department="D1"),
			Row(name="B", employee_name="乙", custom_employee_code="88", department="D2"),
		]
		result, issues = self.module.resolve_pending_person_references(config, staff)
		self.assertIsNone(result.get("manager_employee"))
		self.assertEqual(len(result["pending_person_references"]), 1)
		self.assertEqual(issues[0]["reason"], "工号未唯一匹配在职花名册")


if __name__ == "__main__":
	unittest.main()
