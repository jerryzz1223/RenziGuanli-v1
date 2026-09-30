"""Verify complete roster imports replace membership atomically."""

import ast
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "hrms/api/employee_field_template.py"


class EmployeeDoc:
	def __init__(self, fixture, name):
		self.fixture = fixture
		self.name = name
		self.values = deepcopy(fixture.employees[name])

	def set(self, fieldname, value):
		self.values[fieldname] = value

	def save(self, **kwargs):
		if self.name == self.fixture.fail_on:
			raise RuntimeError("invalid employee row")
		self.values["custom_roster_excluded"] = self.custom_roster_excluded
		self.fixture.employees[self.name] = deepcopy(self.values)


class RosterReplaceAtomicTests(unittest.TestCase):
	def setUp(self):
		self.employees = {
			"A-1": {"employee_name": "Old One", "custom_roster_excluded": 0, "status": "Active"},
			"A-2": {"employee_name": "Old Two", "custom_roster_excluded": 0, "status": "Active"},
			"A-3": {"employee_name": "Historical", "custom_roster_excluded": 0, "status": "Left"},
		}
		self.fail_on = None
		self.snapshots = {}
		self.commits = 0
		self.db = SimpleNamespace(
			savepoint=lambda name: self.snapshots.__setitem__(name, deepcopy(self.employees)),
			rollback=lambda save_point: setattr(self, "employees", deepcopy(self.snapshots[save_point])),
			set_value=self.set_value,
			commit=lambda: setattr(self, "commits", self.commits + 1),
		)
		self.frappe = SimpleNamespace(
			db=self.db,
			get_doc=lambda doctype, name: EmployeeDoc(self, name),
			log_error=lambda *args: None,
			get_traceback=lambda: "traceback",
			throw=lambda message: (_ for _ in ()).throw(ValueError(message)),
		)
		tree = ast.parse(SOURCE.read_text())
		function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "import_employee_roster")
		function.decorator_list = []
		self.namespace = {
			"frappe": self.frappe,
			"_": lambda text: text,
			"EMPLOYEE_DOCTYPE": "Employee",
			"require_hrms_capability": lambda capability: None,
			"_build_employee_roster_import_plan": self.plan,
			"_drop_invalid_employee_date_ranges": lambda *args: None,
			"_ensure_employee_base_records": lambda *args: None,
			"_get_employee_roster_replace_candidates": lambda rows, company: ["A-3"],
			"_make_failed_row": lambda row, error, source: {"row": row, **error},
			"_store_employee_roster_failed_rows": lambda rows: "test-key",
		}
		exec(compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), "exec"), self.namespace)

	def set_value(self, doctype, name, fieldname, value):
		self.assertEqual((doctype, fieldname, value), ("Employee", "custom_roster_excluded", 1))
		self.employees[name][fieldname] = value

	def plan(self, *args):
		result = {
			"failed": 0, "skipped": 0, "errors": [], "warnings": [], "failed_rows": [],
			"base_records": {"性别": 0, "部门": 0, "岗位": 0, "工作性质": 0},
		}
		rows = [
			{"row_index": index, "row": [name], "values": {"employee_name": name, "company": "A"},
			 "action": "update", "existing": employee}
			for index, (employee, name) in enumerate((("A-1", "New One"), ("A-2", "New Two")), 2)
		]
		return result, rows, {"employee_name": {}}

	def test_success_replaces_visible_roster_without_changing_history_status(self):
		result = self.namespace["import_employee_roster"]("file", mode="replace")
		self.assertEqual((result["updated"], result["archived"], result["failed"]), (2, 1, 0))
		self.assertEqual(self.employees["A-1"]["employee_name"], "New One")
		self.assertEqual(self.employees["A-3"]["custom_roster_excluded"], 1)
		self.assertEqual(self.employees["A-3"]["status"], "Left")

	def test_failed_row_rolls_back_all_previous_updates(self):
		original = deepcopy(self.employees)
		self.fail_on = "A-2"
		result = self.namespace["import_employee_roster"]("file", mode="replace")
		self.assertEqual(result["failed"], 1)
		self.assertEqual((result["updated"], result["archived"]), (0, 0))
		self.assertEqual(self.employees, original)
		self.assertFalse(result["can_import"])

	def test_roster_filters_always_exclude_historical_nonmembers(self):
		tree = ast.parse(SOURCE.read_text())
		function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_build_employee_roster_filters")
		namespace = {
			"_parse_json": lambda filters, default: filters,
			"_get_employee_meta_field_map": lambda: {"company": {}, "custom_work_nature": {}, "custom_roster_excluded": {}},
			"frappe": SimpleNamespace(defaults=SimpleNamespace(get_user_default=lambda key: "A")),
		}
		exec(compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), "exec"), namespace)
		filters = namespace["_build_employee_roster_filters"]({"custom_work_nature": "离职", "custom_roster_excluded": 1})
		self.assertEqual(filters, {"custom_work_nature": "离职", "company": "A", "custom_roster_excluded": 0})


if __name__ == "__main__":
	unittest.main()
