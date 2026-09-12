import ast
import types
import unittest
from pathlib import Path


SOURCE_PATH = Path(__file__).parents[1] / "hrms" / "api" / "employee_field_template.py"
HELPERS = {
	"_employee_codes_for_links",
	"_business_user_permissions",
	"_employee_link_from_company_code",
}


class _FrappeStub:
	def __init__(self, employees):
		self.employees = employees
		self.calls = []

	def get_all(self, doctype, **kwargs):
		self.calls.append((doctype, kwargs))
		filters = kwargs.get("filters") or {}
		if "name" in filters:
			requested = set(filters["name"][1])
			return [row for row in self.employees if row.name in requested]
		if "custom_employee_code" in filters:
			return [row for row in self.employees if row.custom_employee_code == filters["custom_employee_code"]]
		return []

	def throw(self, message):
		raise ValueError(message)


def _load_helpers(frappe_stub):
	tree = ast.parse(SOURCE_PATH.read_text())
	nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in HELPERS]
	module = ast.Module(body=nodes, type_ignores=[])
	namespace = {
		"frappe": frappe_stub,
		"_": lambda message: message,
		"EMPLOYEE_DOCTYPE": "Employee",
	}
	exec(compile(ast.fix_missing_locations(module), str(SOURCE_PATH), "exec"), namespace)
	return types.SimpleNamespace(**namespace)


class EmployeePermissionIdentityTests(unittest.TestCase):
	def test_employee_scope_returns_company_code_without_internal_link(self):
		frappe_stub = _FrappeStub([
			types.SimpleNamespace(name="HR-EMP-00002", custom_employee_code="4018"),
		])
		helpers = _load_helpers(frappe_stub)
		scopes = [
			types.SimpleNamespace(
				name="scope-1", allow="Employee", for_value="HR-EMP-00002",
				applicable_for=None, is_default=0, hide_descendants=0,
			),
			types.SimpleNamespace(
				name="scope-2", allow="Company", for_value="永新",
				applicable_for=None, is_default=1, hide_descendants=0,
			),
		]

		result = helpers._business_user_permissions(scopes)

		self.assertEqual(result[0]["for_value"], "4018")
		self.assertNotIn("HR-EMP-00002", str(result))
		self.assertEqual(result[0]["allow_label"], "公司工号")
		self.assertEqual(result[1]["for_value"], "永新")

	def test_employee_matching_uses_only_company_code(self):
		frappe_stub = _FrappeStub([
			types.SimpleNamespace(name="HR-EMP-00002", custom_employee_code="4018"),
		])
		helpers = _load_helpers(frappe_stub)

		self.assertEqual(helpers._employee_link_from_company_code(" 4018 "), "HR-EMP-00002")
		self.assertEqual(frappe_stub.calls[-1][1]["filters"], {"custom_employee_code": "4018"})
		with self.assertRaisesRegex(ValueError, "未找到公司工号 HR-EMP-00002"):
			helpers._employee_link_from_company_code("HR-EMP-00002")


if __name__ == "__main__":
	unittest.main()
