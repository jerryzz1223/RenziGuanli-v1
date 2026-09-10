"""Exercise employee-profile pay summary selection without a live database."""
import ast
from pathlib import Path
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "hrms/api/employee_field_template.py"


class EmployeeDetailStandingSummaryTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse(SOURCE.read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                        and node.name == "_build_employee_standing_pay_summary")
        namespace = {"flt": lambda value: float(value or 0), "cint": lambda value: int(value or 0)}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), "exec"), namespace)
        self.build = namespace["_build_employee_standing_pay_summary"]

    def test_current_salary_social_and_housing_standards(self):
        salaries = [{"effective_date": "2026-09-01", "full_salary": 6427}]
        contributions = [
            {"contribution_type": "社保", "effective_date": "2026-07-01", "enabled": 1,
             "personal_amount": 811.82, "company_amount": 1950.20},
            {"contribution_type": "公积金", "effective_date": "2026-09-01", "enabled": 0,
             "personal_amount": 270, "company_amount": 270},
        ]

        result = self.build(salaries, contributions)

        self.assertEqual(result["salary"]["amount"], 6427)
        self.assertEqual(result["social"]["personal_amount"], 811.82)
        self.assertFalse(result["housing"]["enabled"])
        self.assertEqual(result["housing"]["company_amount"], 0)

    def test_missing_standards_remain_explicit(self):
        self.assertEqual(self.build([], []), {"salary": None, "social": None, "housing": None})


if __name__ == "__main__":
    unittest.main()
