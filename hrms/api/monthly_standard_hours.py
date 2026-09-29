"""Company-wide monthly standard hours, separate from personal daily schedules."""

from calendar import monthrange
from datetime import date, timedelta


def monthly_standard_hours(company: str, attendance_month: str) -> int:
	"""Count company workdays in a month at eight hours per day.

	A Holiday List with weekly-off rows defines the working calendar, including
	weekend make-up workdays. Otherwise use Monday to Friday minus listed holidays.
	"""
	import frappe

	year, month = (int(part) for part in attendance_month.split("-", 1))
	start = date(year, month, 1)
	end = date(year, month, monthrange(year, month)[1])
	holiday_list = frappe.db.get_value("Company", company, "default_holiday_list") if company else None
	holidays = frappe.get_all(
		"Holiday", filters={"parent": holiday_list, "holiday_date": ["between", [start, end]]},
		fields=["holiday_date", "weekly_off"], limit_page_length=100,
	) if holiday_list else []
	holiday_dates = set()
	has_weekly_off = False
	for row in holidays:
		value = row.get("holiday_date") if isinstance(row, dict) else row.holiday_date
		holiday_dates.add(value if isinstance(value, date) else date.fromisoformat(str(value)[:10]))
		has_weekly_off |= str(row.get("weekly_off") if isinstance(row, dict) else row.weekly_off) == "1"
	return 8 * sum(
		day not in holiday_dates and (has_weekly_off or day.weekday() < 5)
		for offset in range((end - start).days + 1)
		for day in (start + timedelta(days=offset),)
	)
