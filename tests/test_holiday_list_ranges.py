from __future__ import annotations

import importlib.util
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
HOLIDAY_LIST_PY = ROOT / "hrms/utils/holiday_list.py"


def load_holiday_list_module():
	"""Load the date-range helpers without requiring a running Frappe site."""
	frappe = ModuleType("frappe")
	frappe._ = lambda message: message
	frappe_utils = ModuleType("frappe.utils")
	frappe_utils.add_days = lambda value, days: getdate(value) + timedelta(days=days)
	frappe_utils.formatdate = str
	frappe_utils.get_link_to_form = lambda *args, **kwargs: "Holiday List Assignment"
	frappe_utils.getdate = getdate
	frappe.utils = frappe_utils

	spec = importlib.util.spec_from_file_location("holiday_list_ranges_under_test", HOLIDAY_LIST_PY)
	module = importlib.util.module_from_spec(spec)
	with patch.dict(sys.modules, {"frappe": frappe, "frappe.utils": frappe_utils}):
		spec.loader.exec_module(module)
	return module


def getdate(value):
	return value if isinstance(value, date) else date.fromisoformat(str(value)[:10])


class HolidayListRangeTest(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls.holiday_list = load_holiday_list_module()

	def test_effective_ranges_support_document_rows_and_clip_the_switch_date(self):
		assignments = {
			"EMP-001": [
				SimpleNamespace(
					holiday_list="HL-JAN",
					from_date=date(2026, 1, 1),
					holiday_list_to_date=date(2026, 1, 31),
				),
				SimpleNamespace(
					holiday_list="HL-FEB",
					from_date=date(2026, 1, 16),
					holiday_list_to_date=date(2026, 2, 28),
				),
			]
		}

		self.assertEqual(
			self.holiday_list.build_effective_date_ranges_for_holiday_assignments(
				assignments, date(2026, 1, 10), date(2026, 1, 20)
			),
			{
				"EMP-001": [
					{"holiday_list": "HL-JAN", "from_date": date(2026, 1, 10), "to_date": date(2026, 1, 15)},
					{"holiday_list": "HL-FEB", "from_date": date(2026, 1, 16), "to_date": date(2026, 1, 20)},
				]
			},
		)

	def test_company_ranges_fill_only_employee_coverage_gaps(self):
		result = self.holiday_list.fill_employee_holiday_list_date_gaps_with_company_holiday_list(
			primary_ranges=[
				{"holiday_list": "EMPLOYEE", "from_date": "2026-01-16", "to_date": "2026-01-31"},
			],
			fallback_ranges=[
				{"holiday_list": "COMPANY", "from_date": "2026-01-01", "to_date": "2026-01-31"},
			],
			start_date=date(2026, 1, 10),
			end_date=date(2026, 1, 20),
		)

		self.assertEqual(
			result,
			[
				{"holiday_list": "COMPANY", "from_date": date(2026, 1, 10), "to_date": date(2026, 1, 15)},
				{"holiday_list": "EMPLOYEE", "from_date": date(2026, 1, 16), "to_date": date(2026, 1, 20)},
			],
		)


if __name__ == "__main__":
	unittest.main()
