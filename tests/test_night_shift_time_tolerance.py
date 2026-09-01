import ast
import unittest
from pathlib import Path


API_PATH = Path(__file__).parents[1] / "hrms" / "api" / "payroll_input.py"


def _night_shift_helpers():
	"""Load just the pure time helpers without requiring a Frappe site."""
	tree = ast.parse(API_PATH.read_text())
	names = {"_clock_time_minutes", "_attendance_detail_matches_night_shift"}
	helpers = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
	namespace = {"re": __import__("re"), "cint": lambda value: int(float(value or 0))}
	exec(compile(ast.Module(body=helpers, type_ignores=[]), str(API_PATH), "exec"), namespace)
	return namespace


class NightShiftTimeToleranceTest(unittest.TestCase):
	def test_deep_shift_accepts_the_configured_ten_minute_boundary(self):
		helper = _night_shift_helpers()["_attendance_detail_matches_night_shift"]
		self.assertTrue(helper({"clock_in": "07:50", "clock_out": "20:10"}, "08:00", "20:00", 10))
		self.assertFalse(helper({"clock_in": "07:49", "clock_out": "20:10"}, "08:00", "20:00", 10))
		self.assertFalse(helper({"clock_in": "07:50", "clock_out": "20:11"}, "08:00", "20:00", 10))

	def test_only_deep_shift_has_a_local_time_rule(self):
		source = API_PATH.read_text()
		self.assertIn('"deep_night_shift_start": "08:00"', source)
		self.assertIn('"deep_night_shift_end": "20:00"', source)
		self.assertIn('"deep_night_shift_tolerance_minutes": 10', source)
		self.assertIn('tiers = (("deep_night_shift_count", "deep_night_shift_start", "deep_night_shift_end"),)', source)
		self.assertIn('never let them affect classification', source)
		self.assertIn('max(flt(row.get("large_night_shifts")) - deep_night_shift_count, 0)', source)
		self.assertIn('small_night_shift_count = flt(row.get("small_night_shifts"))', source)


if __name__ == "__main__":
	unittest.main()
