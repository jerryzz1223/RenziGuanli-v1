import importlib.util
import unittest
from pathlib import Path


path = Path(__file__).parents[1] / "hrms/utils/business_department.py"
spec = importlib.util.spec_from_file_location("business_department_test", path)
business_department = importlib.util.module_from_spec(spec)
spec.loader.exec_module(business_department)
business_departments = business_department.business_departments
is_business_department = business_department.is_business_department
organization_report_from_tree = business_department.organization_report_from_tree


class Row:
	def __init__(self, **values):
		self.__dict__.update(values)


class BusinessDepartmentTest(unittest.TestCase):
	def test_group_suffix_is_not_a_department(self):
		for value in ("业务组", "QE组", "量试组"):
			self.assertFalse(is_business_department(value))

	def test_department_and_section_names_remain_available(self):
		for value in ("总办室", "品保课", "设备课", "组装课"):
			self.assertTrue(is_business_department(value))

	def test_explicit_group_metadata_supports_dict_and_attribute_rows(self):
		self.assertFalse(is_business_department({"name": "IPQC", "node_type": "team"}))
		self.assertFalse(is_business_department(Row(name="厂务", hrms_org_role="组")))
		self.assertEqual(
			[row["name"] for row in business_departments([{"name": "总办室"}, {"name": "业务组"}])],
			["总办室"],
		)

	def test_report_uses_only_created_office_and_section_nodes(self):
		root = {
			"name": "永新公司",
			"organization_node_type": "公司",
			"children": [
				{
					"name": "品保课",
					"organization_node_type": "课",
					"planned_headcount": 14,
					"current_headcount": 12,
					"vacancy_count": 2,
					"children": [{
						"name": "量试组",
						"organization_node_type": "组",
						"planned_headcount": 4,
						"current_headcount": 4,
						"vacancy_count": 0,
						"children": [],
					}],
				},
				{
					"name": "总办室",
					"organization_node_type": "室",
					"planned_headcount": 15,
					"current_headcount": 13,
					"vacancy_count": 2,
					"children": [],
				},
			],
		}
		report = organization_report_from_tree(root)
		self.assertEqual([row["department"] for row in report["rows"]], ["品保课", "总办室"])
		self.assertEqual(report["total"]["planned_headcount"], 29)
		self.assertEqual(report["total"]["current_headcount"], 25)
		self.assertEqual(report["total"]["vacancy_count"], 4)


if __name__ == "__main__":
	unittest.main()
