import importlib.util
import sys
import types
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch


PATH = Path(__file__).resolve().parents[1] / "hrms" / "api" / "monthly_standard_hours.py"
spec = importlib.util.spec_from_file_location("monthly_standard_hours_test", PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MonthlyStandardHoursTest(unittest.TestCase):
	def calculate(self, month, holidays=None, holiday_list=""):
		frappe = types.ModuleType("frappe")
		frappe.db = types.SimpleNamespace(get_value=lambda *_args: holiday_list)
		frappe.get_all = lambda *_args, **_kwargs: holidays or []
		with patch.dict(sys.modules, {"frappe": frappe}):
			return module.monthly_standard_hours("测试公司", month)

	def test_fallback_weekdays_are_shared_month_baseline(self):
		self.assertEqual(self.calculate("2026-08"), 168)

	def test_company_holidays_exclude_weekdays_and_allow_makeup_weekends(self):
		start = date(2026, 8, 1)
		rows = [
			{"holiday_date": start + timedelta(days=offset), "weekly_off": 1}
			for offset in range(31)
			if (start + timedelta(days=offset)).weekday() >= 5
			and start + timedelta(days=offset) != date(2026, 8, 8)
		]
		rows.append({"holiday_date": "2026-08-03", "weekly_off": 0})
		self.assertEqual(self.calculate("2026-08", rows, "公司日历"), 168)

	def test_holiday_list_without_weekly_off_still_uses_weekdays(self):
		self.assertEqual(self.calculate("2026-08", [{"holiday_date": "2026-08-03", "weekly_off": 0}], "公司日历"), 160)


if __name__ == "__main__":
	unittest.main()
