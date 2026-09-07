import importlib.util
import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch


class Row(dict):
	__getattr__ = dict.get


class OrganizationRosterTest(unittest.TestCase):
	def setUp(self):
		frappe = ModuleType("frappe")
		frappe.whitelist = lambda: lambda fn: fn
		frappe._ = lambda text: text
		frappe.throw = lambda text: (_ for _ in ()).throw(ValueError(text))
		frappe.get_doc = Mock(return_value=SimpleNamespace(company="永新", disabled=0, check_permission=Mock()))
		self.rows = [Row(name="E1", employee_name="甲", custom_employee_code="1", department="总办室", designation="文员", grade="文组级"), Row(name="E2", employee_name="乙", custom_employee_code="2", department="总办室", designation="主管", grade="管理级")]
		def get_list(doctype, filters, **kwargs):
			return [row for row in self.rows if all(row.get(key) == value for key, value in filters.items() if key not in {"company", "status"})]
		frappe.get_list = Mock(side_effect=get_list)
		self.frappe = frappe
		path = Path(__file__).parents[1] / "hrms/api/organization_roster.py"
		with patch.dict(sys.modules, {"frappe": frappe}):
			spec = importlib.util.spec_from_file_location("organization_roster_test", path)
			self.module = importlib.util.module_from_spec(spec)
			spec.loader.exec_module(self.module)

	def test_no_department_never_falls_back_to_company(self):
		self.assertEqual(self.module.get_candidates("永新")["employees"], [])
		self.frappe.get_list.assert_not_called()

	def test_empty_framework_without_source_and_scoped_assignment(self):
		self.assertEqual(self.module.validate_chart_selection("永新", "", [], "岗位")["employees"], [])
		with self.assertRaises(ValueError):
			self.module.validate_chart_selection("永新", "", ["E1"], "岗位")
		self.module.validate_chart_selection("永新", "总办室", ["E1", "E2"], "岗位")

	def test_roster_department_position_and_grade_scope(self):
		result = self.module.get_candidates("永新", "总办室", "文员", "文组级")
		self.assertEqual([row.name for row in result["employees"]], ["E1"])
		self.assertEqual(self.frappe.get_list.call_args.kwargs["filters"], {"company": "永新", "status": "Active", "department": "总办室", "designation": "文员", "grade": "文组级"})

	def test_chart_rejects_wrong_position_and_changed_roster(self):
		self.module.validate_chart_selection("永新", "总办室", ["E1"], "岗位", "文员", "文组级")
		with self.assertRaises(ValueError):
			self.module.validate_chart_selection("永新", "总办室", ["E2"], "岗位", "文员", "文组级")
		self.rows[0]["department"] = "行政课"
		with self.assertRaises(ValueError):
			self.module.validate_chart_selection("永新", "总办室", ["E1"], "岗位", "文员", "文组级")

	def test_empty_department_allows_vacant_node_but_not_invented_employee(self):
		self.module.validate_chart_selection("永新", "QE组", [], "组")
		with self.assertRaises(ValueError):
			self.module.validate_chart_selection("永新", "QE组", ["E1"], "组")

	def test_structural_group_can_use_parent_roster_only_when_requested(self):
		departments = {
			"QE组": SimpleNamespace(company="永新", disabled=0, parent_department="总办室", check_permission=Mock()),
			"总办室": SimpleNamespace(company="永新", disabled=0, parent_department="", check_permission=Mock()),
		}
		self.frappe.get_doc.side_effect = lambda doctype, name: departments[name]

		result = self.module.get_candidates("永新", "QE组", inherit_parent=True)

		self.assertEqual(result["requested_department"], "QE组")
		self.assertEqual(result["roster_department"], "总办室")
		self.assertEqual([row.name for row in result["employees"]], ["E1", "E2"])
		self.module.validate_chart_selection("永新", "QE组", ["E1"], "组", inherit_parent=True)

	def test_cross_company_and_permission_errors_propagate(self):
		self.frappe.get_doc.return_value.company = "其他公司"
		with self.assertRaises(ValueError):
			self.module.get_candidates("永新", "总办室")
		self.frappe.get_doc.return_value.check_permission.side_effect = PermissionError()
		with self.assertRaises(PermissionError):
			self.module.get_candidates("永新", "总办室")
