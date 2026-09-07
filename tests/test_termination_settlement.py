import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("termination", ROOT / "hrms/payroll/termination_settlement.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def sample(**changes):
    values = {field: 0 for field, _, _ in module.INPUT_FIELDS}
    values.update(base_salary=2660, standard_hours=184, basic_attendance_hours=32,
                  raw_weekend_overtime_hours=11, weekday_overtime_hours=6, utilities_deduction=67.65)
    values.update(changes)
    return values


class TerminationSettlementTest(unittest.TestCase):
    def test_supplied_workbook_all_outputs(self):
        result = module.calculate_termination_settlement(sample())
        expected = {"salary_subtotal": 2660, "missing_hours": 152,
                    "adjusted_absence_hours": 152, "absence_deduction_amount": 2197.391304347826,
                    "weekend_overtime_hours": 11, "weekday_overtime_pay": 137.59,
                    "weekend_overtime_pay": 336.32, "holiday_overtime_pay": 0,
                    "overtime_pay_total": 473.91, "night_shift_allowance": 0,
                    "absenteeism_deduction": 0, "gross_pay": 936.52,
                    "taxable_salary": 936.52, "income_tax": 0, "net_pay": 868.87}
        for key, value in expected.items():
            with self.subTest(field=key):
                self.assertAlmostEqual(result["calculated"][key], value, places=8)
        self.assertEqual(result["rule_version"], module.RULE_VERSION)

    def test_monthly_divisor_changes_fixed_pay_but_not_overtime(self):
        july = module.calculate_termination_settlement(sample())["calculated"]
        august = module.calculate_termination_settlement(sample(standard_hours=176))["calculated"]
        self.assertNotEqual(july["absence_deduction_amount"], august["absence_deduction_amount"])
        self.assertEqual(july["weekend_overtime_pay"], august["weekend_overtime_pay"])
        self.assertEqual(august["adjusted_absence_hours"], 144)
        self.assertEqual(august["weekend_overtime_hours"], 11)

    def test_nonzero_columns_and_full_month(self):
        result = module.calculate_termination_settlement(sample(base_salary=3480, function_allowance=520,
            standard_hours=176, basic_attendance_hours=176, weekday_overtime_hours=2,
            raw_weekend_overtime_hours=3, holiday_overtime_hours=1,
            large_night_shift_count=2, small_night_shift_count=1,
            green_apple_amount=100, red_apple_amount=30, attendance_housing_allowance=200,
            social_security_personal=300, housing_fund_personal=100,
            utilities_deduction=50, insurance_deduction=20))["calculated"]
        self.assertEqual(result["absence_deduction_amount"], 0)
        self.assertEqual(result["overtime_pay_total"], 240)
        self.assertEqual(result["night_shift_allowance"], 114)
        self.assertEqual(result["gross_pay"], 4624)
        self.assertEqual(result["net_pay"], 4154)

    def test_rounding_preserves_unrounded_holiday_and_absence(self):
        # Both intermediate values have fractions of a cent; rounding them
        # separately would change the final worksheet AA5 result.
        result = module.calculate_termination_settlement(sample(base_salary=1, standard_hours=3,
            basic_attendance_hours=1, raw_weekend_overtime_hours=0,
            weekday_overtime_hours=0, holiday_overtime_hours=1, utilities_deduction=0))["calculated"]
        self.assertEqual(result["gross_pay"], .35)
        self.assertAlmostEqual(result["holiday_overtime_pay"], 3 / 174)

    def test_tax_boundaries_and_explicit_zero_override(self):
        for salary, tax in [(4999, 0), (5000, 0), (8000, 90), (8000.01, 90),
                            (17000, 990), (17000.01, 990), (30000, 3590),
                            (30000.01, 3590), (40000, 6090)]:
            with self.subTest(salary=salary):
                result = module.calculate_termination_settlement(sample(base_salary=salary, standard_hours=174,
                    basic_attendance_hours=174, weekday_overtime_hours=0, raw_weekend_overtime_hours=0))["calculated"]
                self.assertEqual(result["income_tax"], tax)
        values = sample(base_salary=40001, standard_hours=174, basic_attendance_hours=174,
                        weekday_overtime_hours=0, raw_weekend_overtime_hours=0)
        with self.assertRaisesRegex(ValueError, "AF5"):
            module.calculate_termination_settlement(values)
        values["income_tax_override"] = 0
        self.assertEqual(module.calculate_termination_settlement(values)["calculated"]["income_tax"], 0)

    def test_missing_invalid_and_nonfinite_inputs_rejected(self):
        for field, value in [("standard_hours", 0), ("standard_hours", None),
                             ("basic_attendance_hours", 185), ("raw_weekend_overtime_hours", ""),
                             ("green_apple_amount", "NaN"), ("base_salary", "Infinity"),
                             ("insurance_deduction", -1), ("large_night_shift_count", 1.5)]:
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                module.calculate_termination_settlement(sample(**{field: value}))

    def test_normal_formula_set_remains_unchanged(self):
        normal_spec = importlib.util.spec_from_file_location("normal", ROOT / "hrms/payroll/payroll_formula.py")
        normal = importlib.util.module_from_spec(normal_spec)
        normal_spec.loader.exec_module(normal)
        inputs = sample()
        before, _ = normal.evaluate_formula_set(normal.FORMULA_TEMPLATES, inputs)
        module.calculate_termination_settlement(inputs)
        after, _ = normal.evaluate_formula_set(normal.FORMULA_TEMPLATES, inputs)
        self.assertEqual(before, after)
        self.assertEqual(after["adjusted_absence_hours"], 141)
        self.assertEqual(after["weekend_overtime_hours"], 0)


if __name__ == "__main__":
    unittest.main()
