import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "hrms" / "payroll" / "payroll_formula.py"
SPEC = importlib.util.spec_from_file_location("payroll_formula", MODULE_PATH)
payroll_formula = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(payroll_formula)
FormulaError = payroll_formula.FormulaError
FORMULA_TEMPLATES = payroll_formula.FORMULA_TEMPLATES
evaluate_formula = payroll_formula.evaluate_formula
evaluate_formula_set = payroll_formula.evaluate_formula_set


class PayrollFormulaEngineTest(unittest.TestCase):
	def test_chinese_fields_and_excel_round(self):
		value, fields = evaluate_formula("ROUND([底薪] / 174 * [平日加班时数] * 1.5, 2)", {"base_salary": 2770, "weekday_overtime_hours": 12})
		self.assertEqual(value, 286.55)
		self.assertEqual(fields, ["base_salary", "weekday_overtime_hours"])

	def test_formula_set_matches_payroll_chain(self):
		result, trace = evaluate_formula_set(FORMULA_TEMPLATES, {
			"base_salary": 2770,
			"function_allowance": 30,
			"certificate_skill_allowance": 0,
			"standard_hours": 176,
			"basic_attendance_hours": 160,
			"raw_weekend_overtime_hours": 8,
			"weekday_overtime_hours": 12,
			"holiday_overtime_hours": 0,
			"large_night_shift_count": 1,
			"small_night_shift_count": 2,
			"full_attendance_bonus": 100,
			"social_security_personal": 524.96,
		})
		self.assertEqual(result["salary_subtotal"], 2800)
		self.assertEqual(result["missing_hours"], 16)
		self.assertEqual(result["adjusted_absence_hours"], 8)
		self.assertEqual(result["social_security_company"], 1256.82)
		self.assertEqual(len(trace), len(FORMULA_TEMPLATES))

	def test_rejects_unsafe_python(self):
		with self.assertRaises(FormulaError):
			evaluate_formula("__import__('os').system('id')", {})

	def test_rejects_unknown_field(self):
		with self.assertRaises(FormulaError):
			evaluate_formula("[不存在字段] + 1", {})


if __name__ == "__main__":
	unittest.main()
