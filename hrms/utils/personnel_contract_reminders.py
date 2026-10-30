"""Contract reminders shared by the roster API and its UI contract."""

from datetime import date, datetime, timedelta


def contract_expiry_warning(employee, today):
	if employee.get("status") == "Left" or employee.get("custom_work_nature") in {"离职", "已离职"}:
		return False
	try:
		end = date.fromisoformat(str(employee.get("contract_end_date") or "")[:10])
		current = today.date() if isinstance(today, datetime) else today if isinstance(today, date) else date.fromisoformat(str(today)[:10])
	except (ValueError, TypeError):
		return False
	# Match the existing browser's Date(year, month + 2, day) calendar window,
	# including its rollover for short months.
	month = current.month + 2
	cutoff = date(current.year + (month - 1) // 12, (month - 1) % 12 + 1, 1) + timedelta(days=current.day - 1)
	return end <= cutoff
