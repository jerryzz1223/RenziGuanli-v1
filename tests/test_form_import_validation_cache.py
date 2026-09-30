"""Exercise the import validator without loading a Frappe site."""

import ast
from pathlib import Path
import unittest
from types import SimpleNamespace


SOURCE = Path(__file__).resolve().parents[1] / "hrms/api/form_data_intake.py"


class FormImportValidationCacheTest(unittest.TestCase):
	def test_sparse_workbook_skips_raw_field_work_for_blank_rows(self):
		function = next(
			node for node in ast.parse(SOURCE.read_text()).body
			if isinstance(node, ast.FunctionDef) and node.name == "_read_plan"
		)
		calls = 0
		headers = ("工号", *[f"空列{number}" for number in range(19)])
		blank = (None,) * len(headers)
		filled = ("1001", *([None] * 19))

		class Sheet:
			title = "数据"

			def iter_rows(self, **_kwargs):
				return iter([blank] * 100 + [filled])

		def normalise(value):
			nonlocal calls
			calls += 1
			return "" if value is None else str(value)

		namespace = {
			"_load_workbook": lambda file_url: object(),
			"_find_sheet_and_header": lambda workbook, profile: (1, Sheet(), 1, headers, {"employee_code"}),
			"_profile_alias_map": lambda profile: {"工号": "employee_code"},
			"_normalise_header": lambda value: value,
			"_normalise_text": normalise,
		}
		exec(compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), "exec"), namespace)
		plan = namespace["_read_plan"]("unused.xlsx", {
			"columns": [{"key": "employee_code", "label": "工号", "required": True}],
			"row_identity_keys": ["employee_code"],
		})
		self.assertEqual(len(plan["rows"]), 1)
		self.assertEqual(plan["rows"][0]["row_number"], 102)
		self.assertEqual(len(plan["rows"][0]["raw"]), 20)
		self.assertLess(calls, 170, "blank rows should not build all raw fields")

	def test_repeated_rows_reuse_lookups_but_next_validation_reads_again(self):
		function = next(
			node for node in ast.parse(SOURCE.read_text()).body
			if isinstance(node, ast.FunctionDef) and node.name == "_validate_rows"
		)
		calls = {"code": 0, "department": 0, "employee_department": 0, "display": 0}

		def employee_by_code(company, code):
			calls["code"] += 1
			return "EMP-1"

		def department_exists(company, department):
			calls["department"] += 1
			return ""

		def get_value(doctype, employee, field):
			calls["employee_department"] += 1
			return "D-1"

		def matches_department(department, display):
			calls["display"] += 1
			return True

		namespace = {
			"_": lambda value: value,
			"_employee_by_code": employee_by_code,
			"_employee_by_name": lambda company, name: "",
			"_department_exists": department_exists,
			"_matches_department_display_name": matches_department,
			"_record_key": lambda profile, data, number: str(number),
			"_onboarding_import_context": lambda data, company: None,
			"_normalise_reward_punishment_data": lambda data, company: [],
			"EMPLOYEE_ONBOARDING_TEMPLATE_KEY": "employee_onboarding",
			"frappe": SimpleNamespace(db=SimpleNamespace(get_value=get_value)),
		}
		exec(compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), "exec"), namespace)
		profile = {"key": "attendance_daily", "columns": []}
		plan = {"rows": [
			{"row_number": number, "normalized": {"employee_code": "1001", "department": "行政课"}}
			for number in range(1, 31)
		]}
		for expected in (1, 2):
			rows = namespace["_validate_rows"](profile, "Company A", plan)
			self.assertEqual(len(rows), 30)
			self.assertTrue(all(row["employee"] == "EMP-1" and row["department"] == "D-1" and not row["errors"] for row in rows))
			self.assertEqual(calls, {key: expected for key in calls})


if __name__ == "__main__":
	unittest.main()
