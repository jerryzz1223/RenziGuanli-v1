import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
PROCESSOR_PATH = ROOT / "hrms" / "api" / "attendance_processors" / "attendance_draft.py"
API_PATH = ROOT / "hrms" / "api" / "payroll_input.py"
SPEC = importlib.util.spec_from_file_location("attendance_draft", PROCESSOR_PATH)
attendance_draft = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(attendance_draft)


class NightShiftTimeToleranceTest(unittest.TestCase):
	def test_deep_shift_requires_the_production_schedule_and_exact_shift_hours(self):
		helper = attendance_draft.is_production_deep_night_shift
		self.assertTrue(helper("生产夜班 20:00-次日08:00"))
		self.assertTrue(helper("生产夜班（20:00-08:00）"))
		self.assertFalse(helper("生产夜班 20:00-07:59"))
		self.assertFalse(helper("夜班 20:00-次日08:00"))
		self.assertFalse(helper("生产夜班"))

	def test_payroll_uses_the_locked_attendance_classification(self):
		source = API_PATH.read_text()
		self.assertIn('deep_night_shift_count = flt(row.get("deep_night_shifts"))', source)
		self.assertIn('生产夜班 20:00 至次日', source)
		self.assertNotIn("_locked_night_shift_matches", source)
		self.assertIn('max(flt(row.get("large_night_shifts")) - deep_night_shift_count, 0)', source)
		self.assertIn('small_night_shift_count = flt(row.get("small_night_shifts"))', source)


if __name__ == "__main__":
	unittest.main()
