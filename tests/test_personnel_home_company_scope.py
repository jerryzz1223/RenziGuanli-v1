"""The personnel homepage must count the same company as the roster."""

import ast
from pathlib import Path
from types import SimpleNamespace
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "hrms/hr/page/hrms_workbench/hrms_workbench.py"


class PersonnelHomeCompanyScopeTests(unittest.TestCase):
	def test_distribution_queries_only_current_company(self):
		calls = []

		def get_list(doctype, **kwargs):
			calls.append((doctype, kwargs))
			if kwargs.get("group_by"):
				return [{"custom_native_place": "江苏", "count": 2}]
			return [{"custom_native_place": "江苏", "name": "EMP-1", "employee_name": "示例员工"}]

		frappe = SimpleNamespace(
			defaults=SimpleNamespace(get_user_default=lambda key: "永新"),
			get_list=get_list,
		)
		tree = ast.parse(SOURCE.read_text())
		functions = [
			node for node in tree.body
			if isinstance(node, ast.FunctionDef)
			and node.name in {"_employee_company_filters", "_employee_distribution"}
		]
		scope = {
			"frappe": frappe,
			"_has_field": lambda doctype, fieldname: True,
			"_safe_filters": lambda doctype, filters: filters,
			"_as_int": int,
		}
		exec(compile(ast.Module(body=functions, type_ignores=[]), str(SOURCE), "exec"), scope)
		result = scope["_employee_distribution"]("custom_native_place", include_employee_names=True)
		self.assertEqual(result["total"], 2)
		self.assertEqual(len(calls), 2)
		for doctype, kwargs in calls:
			self.assertEqual(doctype, "Employee")
			self.assertEqual(kwargs["filters"], {"company": "永新", "status": "Active"})


if __name__ == "__main__":
	unittest.main()
