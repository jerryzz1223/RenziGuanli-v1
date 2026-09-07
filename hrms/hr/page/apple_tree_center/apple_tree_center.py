"""Read-only employee, month, and year statistics for Apple-tree records."""

from __future__ import annotations

from collections import defaultdict
from datetime import date

import frappe
from frappe.utils import getdate, nowdate


MAX_VISIBLE_RECORDS = 10000
MONTHLY_SUMMARY_DOCTYPE = "HRMS Monthly Attendance Summary"

# Column order follows 员工考勤明细+汇总 in the supplied workbook.
PERSON_COLUMNS = [
	("attendance_month", "月份", False), ("department", "部门", False),
	("employee_name", "姓名", False), ("employee_code", "工号", False),
	("date_of_joining", "入职日期", False),
	("standard_hours", "标准工时", True), ("actual_attendance_hours", "实际出勤工时", True),
	("missing_hours", "缺勤", True), ("personal_leave_hours", "事假", True),
	("sick_leave_hours", "病假", True), ("annual_leave_hours", "特休", True),
	("rest_leave_hours", "排休", True), ("bereavement_leave_hours", "丧假", True),
	("green_apples", "绿苹果", True), ("red_apples", "红苹果", True),
	("cross_department_support", "支援奖金", True), ("maintenance_bonus", "保养奖金", True),
	("reported_reward", "奖惩提报（奖）", True), ("reported_penalty", "奖惩提报（罚）", True),
	("missing_card_count", "忘打卡（次）", True), ("review_note", "备注", False),
]


def _number(value):
	try:
		return float(value or 0)
	except (TypeError, ValueError):
		return 0.0


def _display_number(value):
	value = _number(value)
	return int(value) if value.is_integer() else value


def _parse_year(value):
	text = str(value or "").strip()
	if not text:
		return getdate(nowdate()).year
	if len(text) != 4 or not text.isdigit():
		frappe.throw("统计年份应为 YYYY。")
	return int(text)


def _parse_month(value, year):
	text = str(value or "").strip()
	if not text:
		return ""
	if text in {f"{year}-Q{quarter}" for quarter in range(1, 5)}:
		return text
	if len(text) != 7 or text[4] != "-" or not text[:4].isdigit() or not text[5:].isdigit():
		frappe.throw("统计期间应为 YYYY-MM 或 YYYY-Q1 至 YYYY-Q4。")
	month_year, month_number = int(text[:4]), int(text[5:])
	if month_year != year or month_number not in range(1, 13):
		frappe.throw("统计月份需属于所选统计年份。")
	return text


def _date_range(year, month):
	if "-Q" in month:
		start_month = (int(month[-1]) - 1) * 3 + 1
		return date(year, start_month, 1), date(year + 1, 1, 1) if start_month == 10 else date(year, start_month + 3, 1)
	if month:
		month_number = int(month[-2:])
		start = date(year, month_number, 1)
		end = date(year + 1, 1, 1) if month_number == 12 else date(year, month_number + 1, 1)
		return start, end
	return date(year, 1, 1), date(year + 1, 1, 1)


def _record_key(row):
	return str(row.get("employee") or row.get("employee_code") or row.get("employee_name") or "未匹配员工").strip()


def _matches_search(row, search):
	if not search:
		return True
	haystack = " ".join(
		str(row.get(field) or "") for field in ("employee_code", "employee_name", "department", "reward_item")
	).casefold()
	return search.casefold() in haystack


def _summarize_records(records):
	"""Build employee and monthly aggregates from permission-filtered records."""
	people = {}
	months = defaultdict(lambda: {"record_count": 0, "green_apples": 0.0, "red_apples": 0.0, "reward_amount": 0.0})
	for row in records:
		key = _record_key(row)
		person = people.setdefault(
			key,
			{
				"employee": row.get("employee") or "",
				"employee_code": row.get("employee_code") or "",
				"employee_name": row.get("employee_name") or "未匹配员工",
				"department": row.get("department") or "",
				"record_count": 0,
				"green_apples": 0.0,
				"red_apples": 0.0,
				"reward_amount": 0.0,
			},
		)
		green = _number(row.get("green_apples"))
		red = _number(row.get("red_apples"))
		amount = _number(row.get("reward_amount"))
		person["record_count"] += 1
		person["green_apples"] += green
		person["red_apples"] += red
		person["reward_amount"] += amount
		month_key = str(row.get("reward_date") or "")[:7]
		if month_key:
			months[month_key]["record_count"] += 1
			months[month_key]["green_apples"] += green
			months[month_key]["red_apples"] += red
			months[month_key]["reward_amount"] += amount

	def finalize(row):
		result = dict(row)
		result["net_apples"] = _display_number(result["green_apples"] - result["red_apples"])
		for field in ("green_apples", "red_apples", "reward_amount"):
			result[field] = _display_number(result[field])
		return result

	people_rows = [finalize(row) for row in people.values()]
	people_rows.sort(key=lambda row: (-_number(row["net_apples"]), -_number(row["green_apples"]), row["employee_name"]))
	month_rows = [finalize({"month": month, **values}) for month, values in months.items()]
	month_rows.sort(key=lambda row: row["month"], reverse=True)
	summary = finalize(
		{
			"record_count": sum(row["record_count"] for row in people_rows),
			"green_apples": sum(_number(row["green_apples"]) for row in people_rows),
			"red_apples": sum(_number(row["red_apples"]) for row in people_rows),
			"reward_amount": sum(_number(row["reward_amount"]) for row in people_rows),
		}
	)
	summary["employee_count"] = len(people_rows)
	return summary, people_rows, month_rows


def _available_years(records, current_year):
	years = {current_year}
	for row in records:
		date_text = str(row.get("reward_date") or "")
		if len(date_text) >= 4 and date_text[:4].isdigit():
			years.add(int(date_text[:4]))
	return sorted(years, reverse=True)


def _summary_record(row):
	"""Adapt a current monthly final row to the Apple-tree table contract."""
	attendance_month = str(row.get("attendance_month") or "").strip()
	return {
		**{field: row.get(field) for field, _label, _numeric in PERSON_COLUMNS},
		"name": row.get("name") or "",
		"reward_date": f"{attendance_month}-01" if attendance_month else "",
		"attendance_month": attendance_month,
		"employee": row.get("employee") or "",
		"employee_code": row.get("employee_code") or "",
		"employee_name": row.get("employee_name") or "未匹配员工",
		"department": row.get("department") or "",
		"reward_item": "月度考勤终稿",
		"green_apples": row.get("green_apples"),
		"red_apples": row.get("red_apples"),
		"reward_amount": row.get("apple_reward_amount"),
		"approval_no": row.get("attendance_lock_version") or "",
		"approval_result": row.get("status") or "",
		"approval_status": row.get("lock_status") or "",
		"is_valid_approval": 1 if row.get("lock_status") == "已锁定" else 0,
		"created_by_name": row.get("locked_by") or "",
	}


def _list_active_month_records(company, attendance_month):
	"""Use the established active-version resolver for monthly attendance finals."""
	from hrms.api.attendance_import import list_monthly_attendance_summary

	return list_monthly_attendance_summary(company=company, attendance_month=attendance_month, page_length=MAX_VISIBLE_RECORDS)


def _person_totals(rows):
	# Unknown data must not be presented as a zero or a complete annual total.
	return {
		field: _display_number(sum(_number(row[field]) for row in rows))
		if rows and all(row.get(field) not in (None, "") for row in rows) else None
		for field, _label, numeric in PERSON_COLUMNS if numeric
	}


def _locked_detail_extras(company, attendance_month, employee_code=""):
	from hrms.api.attendance_processing_center import get_monthly_final_preview

	try:
		return get_monthly_final_preview(company, attendance_month, kind="signed", employee_code=employee_code)
	except frappe.PermissionError:
		return {"available": False}


@frappe.whitelist()
def get_employee_summary(employee: str, year: str = "", company: str = ""):
	"""Return one employee's Apple-tree totals for the employee-detail card.

	The card deliberately reuses ``get_data`` so its company, year and active
	monthly-final rules stay identical to the Apple-tree centre.  Employee code
	is the business identity for both aggregation and drilldown; names and the
	internal Employee document name are never used as the matching key.
	"""
	employee_doc = frappe.get_doc("Employee", employee)
	employee_doc.check_permission("read")
	employee_code = str(employee_doc.get("custom_employee_code") or "").strip()
	if not employee_code:
		return {"available": False, "reason": "该员工未设置工号，无法匹配苹果树终稿。", "person_key": "", "person": {}, "year": _parse_year(year), "company": company}
	data = get_data(year=year, company=company)
	person = next((row for row in data["people"] if str(row.get("employee_code") or "") == employee_code), None)
	return {
		"available": bool(person),
		"reason": "所选年度内没有该员工可查看的苹果树记录。" if not person else "",
		"person_key": employee_code,
		"person": person or {},
		"year": data["filters"]["year"],
		"company": data["filters"]["company"],
	}


@frappe.whitelist()
def get_person_detail(person: str, year: str = "", company: str = ""):
	"""Employee drilldown uses the same company and active-version scope as totals."""
	data = get_data(year=year, company=company)
	key = str(person or "").strip()
	employee = next(
		(row for row in data["people"] if str(row.get("employee_code") or "") == key or _record_key(row) == key),
		None,
	)
	if not employee:
		return {"available": False, "reason": "所选年度内没有该员工可查看的苹果树记录。"}
	person_code = str(employee.get("employee_code") or "")
	rows = [dict(row) for row in data["records"] if str(row.get("employee_code") or "") == person_code]
	for row in rows:
		standard, actual = row.get("standard_hours"), row.get("actual_attendance_hours")
		# Reference workbook: 缺勤 = 标准工时 - 实际出勤工时.
		row["missing_hours"] = round(_number(standard) - _number(actual), 4) if standard not in (None, "") and actual not in (None, "") else None
		if row.get("employee_code") and str(row.get("approval_no") or "").startswith("处理终稿:"):
			preview = _locked_detail_extras(data["filters"]["company"], row["attendance_month"], str(row.get("employee_code") or ""))
			if preview.get("available") and row["approval_no"] == f"处理终稿:{preview.get('locked_snapshot_version')}":
				matches = [item for item in preview.get("rows", []) if row.get("employee_code") and str(item.get("employee_code") or "") == str(row["employee_code"])]
				if len(matches) == 1:
					for field in ("bereavement_leave_hours", "cross_department_support", "maintenance_bonus", "reported_reward", "reported_penalty", "missing_card_count", "review_note"):
						if field in matches[0]:
							row[field] = matches[0][field]
	rows.sort(key=lambda row: row["attendance_month"])
	return {
		"available": True, "person": employee, "year": data["filters"]["year"],
		"available_years": data.get("available_years", [data["filters"]["year"]]),
		"company": data["filters"]["company"], "rows": rows, "totals": _person_totals(rows),
		"columns": [{"field": field, "label": label, "numeric": numeric} for field, label, numeric in PERSON_COLUMNS],
	}


@frappe.whitelist()
def get_data(year: str = "", month: str = "", search: str = "", company: str = ""):
	"""Return a permission-aware Apple-tree statistical view.

	The active monthly attendance final is the canonical source for the annual
	and monthly Apple-tree tables.  It never changes attendance finals or
	payroll results.
	"""
	year = _parse_year(year)
	month = _parse_month(month, year)
	defaults = getattr(frappe, "defaults", None)
	default_company = defaults.get_user_default("Company") if defaults else ""
	company = str(company or default_company or "").strip()
	if not company:
		frappe.throw("请先选择公司后再查看苹果树统计。")
	available_months = frappe.get_list(
		MONTHLY_SUMMARY_DOCTYPE,
		fields=["attendance_month"],
		filters={"company": company},
		order_by="attendance_month desc, modified desc",
		page_length=MAX_VISIBLE_RECORDS,
	)
	available_months = sorted(
		{
			str(row.get("attendance_month") or "").strip()
			for row in available_months
			if len(str(row.get("attendance_month") or "")) == 7
		},
		reverse=True,
	)
	available_years = _available_years([{"reward_date": f"{item}-01"} for item in available_months], year)
	target_months = [month] if month else [item for item in available_months if item.startswith(f"{year}-")]
	if "-Q" in month:
		quarter_start = (int(month[-1]) - 1) * 3 + 1
		target_months = [f"{year}-{number:02d}" for number in range(quarter_start, quarter_start + 3) if f"{year}-{number:02d}" in available_months]
	records = [
		_summary_record(row)
		for attendance_month in target_months
		for row in _list_active_month_records(company, attendance_month)
	]
	records = [row for row in records if _matches_search(row, str(search or "").strip())]
	summary, people, months = _summarize_records(records)
	return {
		"filters": {"year": str(year), "month": month, "search": str(search or "").strip(), "company": company},
		"available_years": available_years,
		"summary": summary,
		"people": people,
		"months": months,
		"records": records,
		"notice": "统计范围为当前公司、当前账号可查看的月度考勤终稿当前生效版本；原始苹果树记录仅作为导入审计来源，不决定本页统计。" + (" 当前筛选结果超过 10000 条，请缩小年份或月份范围。" if len(records) >= MAX_VISIBLE_RECORDS else ""),
	}
