"""Employee, month, and year statistics plus isolated Apple-tree history imports."""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from datetime import date, datetime
from io import BytesIO

import frappe
from frappe.utils import getdate, now_datetime, nowdate


MAX_VISIBLE_RECORDS = 10000
MONTHLY_SUMMARY_DOCTYPE = "HRMS Monthly Attendance Summary"
ATTENDANCE_BATCH_DOCTYPE = "HRMS Attendance Import Batch"
HISTORY_SUMMARY_DOCTYPE = "HRMS Apple Tree History Summary"
HISTORY_SOURCE_TYPE = "apple_tree_history"
APPLE_RECORD_DOCTYPE = "HRMS Apple Reward Record"
APPLE_UNIT_AMOUNT = 5
HISTORY_REQUIRED_HEADERS = {"奖/惩日期", "受奖/惩人", "绿苹果", "红苹果"}

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

# A personal Apple-tree page is a reward/penalty ledger, not an attendance
# detail page. Keep this order identical to the latest requested table.
APPLE_DETAIL_COLUMNS = [
	("sequence", "序号", False), ("created_at", "创建时间", False), ("reward_date", "奖/惩日期", False),
	("department", "受奖/惩人部门", False), ("employee_name", "受奖/惩人", False),
	("green_apples", "绿苹果", True), ("red_apples", "红苹果", True), ("reward_item", "奖/惩项目", False),
	("note", "备注", False), ("created_by_name", "创建人", False), ("signature", "签名", False), ("note_2", "备注", False),
]


def _number(value):
	try:
		return float(value or 0)
	except (TypeError, ValueError):
		return 0.0


def _display_number(value):
	value = _number(value)
	return int(value) if value.is_integer() else value


def _cell_text(value):
	if value is None:
		return ""
	if isinstance(value, datetime):
		return value.strftime("%Y-%m-%d %H:%M:%S")
	if isinstance(value, date):
		return value.isoformat()
	return str(value).strip()


def _excel_value(value):
	"""Keep numbers numeric and prevent spreadsheet formulas in exported text."""
	if value is None:
		return ""
	if isinstance(value, (int, float, date, datetime)):
		return value
	text = str(value)
	return f"'{text}" if text.startswith(("=", "+", "-", "@")) else text


def _normalise_header(value):
	return re.sub(r"\s+", "", _cell_text(value).replace("\n", ""))


def _history_file_content(file_url):
	file_name = frappe.db.get_value("File", {"file_url": file_url}, "name")
	if not file_name:
		frappe.throw("未找到上传的 Excel 文件。")
	content = frappe.get_doc("File", file_name).get_content()
	return content.encode() if isinstance(content, str) else content


def _history_sheet_rows(content):
	from openpyxl import load_workbook

	workbook = load_workbook(BytesIO(content), data_only=True, read_only=True)
	for sheet in workbook.worksheets:
		rows = list(sheet.iter_rows(values_only=True))
		for header_index, values in enumerate(rows[:20]):
			headers = [_normalise_header(value) for value in values]
			if not HISTORY_REQUIRED_HEADERS.issubset(set(headers)):
				continue
			seen = defaultdict(int)
			normalised_headers = []
			for header in headers:
				if not header:
					normalised_headers.append("")
					continue
				seen[header] += 1
				normalised_headers.append(f"{header}_{seen[header]}" if seen[header] > 1 else header)
			parsed = []
			for source_row, row_values in enumerate(rows[header_index + 1 :], start=header_index + 2):
				row = {
					header: _cell_text(row_values[index]) if index < len(row_values) else ""
					for index, header in enumerate(normalised_headers)
					if header
				}
				if any(row.values()):
					row["__source_row"] = source_row
					parsed.append(row)
			return sheet.title, header_index + 1, parsed
	frappe.throw("未找到符合格式的工作表：第 1–20 行需包含“奖/惩日期、受奖/惩人、绿苹果、红苹果”表头。")


def _history_row_value(row, *headers):
	for header in headers:
		value = row.get(_normalise_header(header))
		if value not in (None, ""):
			return value
	return ""


def _history_number(value):
	try:
		return float(str(value or "0").replace(",", "").strip())
	except (TypeError, ValueError):
		return None


def _history_date(value):
	try:
		return getdate(value) if value else None
	except (TypeError, ValueError):
		return None


def _history_employee_code(value):
	text = _cell_text(value)
	return re.sub(r"\.0+$", "", text) if re.fullmatch(r"\d+\.0+", text) else text


def _history_employee(company, employee_code="", employee_name=""):
	employee_code = _history_employee_code(employee_code)
	employee_name = str(employee_name or "").strip()
	filters = {"company": company}
	filters["custom_employee_code" if employee_code else "employee_name"] = employee_code or employee_name
	rows = frappe.get_all(
		"Employee",
		filters=filters,
		fields=["name", "employee_name", "custom_employee_code", "department"],
		limit_page_length=3,
	)
	if len(rows) != 1:
		if employee_code:
			return None, "未按工号在当前公司匹配员工" if not rows else "当前公司存在重复工号，无法确定人员"
		return None, "未在当前公司匹配员工" if not rows else "当前公司存在同名员工，请填写受奖/惩人工号"
	employee = rows[0]
	resolved_code = str(employee.get("custom_employee_code") or "").strip()
	if not resolved_code:
		return None, "匹配员工未设置工号"
	if employee_code and employee_name and str(employee.get("employee_name") or "").strip() != employee_name:
		return None, f"工号与姓名不一致，该工号对应{employee.get('employee_name') or '-'}"
	return employee, ""


def _build_history_import_template():
	from copy import copy

	from openpyxl import Workbook
	from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
	from openpyxl.utils import get_column_letter

	workbook = Workbook()
	sheet = workbook.active
	sheet.title = "苹果树合计"
	sheet.merge_cells("B1:N1")
	sheet.merge_cells("B2:N2")
	sheet["B1"] = "填写说明：每个文件只填一个月份；工号按文本填写；绿苹果、红苹果未发生时留空。"
	sheet["B2"] = "苹果树合计填写模板"
	headers = ["序号", "创建时间", "奖/惩日期", "受奖/惩人部门", "受奖/惩人工号", "受奖/惩人", "绿苹果", "红苹果", "奖/惩项目", "备注", "创建人", "签名", "备注"]
	for index, value in enumerate(headers, start=2):
		sheet.cell(3, index, value)
	widths = [6, 12.625, 10.375, 8.125, 13, 7.5, 5.375, 13, 30.75, 28.625, 7.5, 8.25, 13]
	for index, width in enumerate(widths, start=2):
		sheet.column_dimensions[get_column_letter(index)].width = width
	sheet.column_dimensions["A"].width = 6.5
	sheet["B1"].font = Font(name="宋体", size=10, italic=True, color="666666")
	sheet["B2"].font = Font(name="宋体", size=22)
	for cell in (sheet["B1"], sheet["B2"]):
		cell.alignment = Alignment(horizontal="center", vertical="center")
	header_fill = PatternFill("solid", fgColor="BDD7EE")
	thin = Side(style="thin", color="808080")
	border = Border(left=thin, right=thin, top=thin, bottom=thin)
	for cell in sheet[3][1:14]:
		cell.font = Font(name="宋体", size=11, bold=True)
		cell.fill = header_fill
		cell.border = border
		cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
	for row in range(4, 204):
		for column in range(2, 15):
			cell = sheet.cell(row, column)
			cell.font = Font(name="宋体", size=10)
			cell.border = copy(border)
			cell.alignment = Alignment(horizontal="left" if column in (10, 11) else "center", vertical="center", wrap_text=True)
		sheet.row_dimensions[row].height = 24
		sheet.cell(row, 3).number_format = "yyyy-mm-dd hh:mm:ss"
		sheet.cell(row, 4).number_format = "yyyy-mm-dd"
		sheet.cell(row, 6).number_format = "@"
	for row in range(1, 4):
		sheet.row_dimensions[row].height = 27
	sheet.freeze_panes = "B4"
	sheet.auto_filter.ref = "B3:N203"
	sheet.sheet_view.showGridLines = False
	return workbook


def _history_preview_data(file_url, company):
	content = _history_file_content(file_url)
	checksum = hashlib.sha256(content).hexdigest()
	sheet_name, header_row, source_rows = _history_sheet_rows(content)
	issues = []
	accepted = []
	months = set()
	employee_cache = {}
	for row in source_rows:
		source_row = row["__source_row"]
		employee_name = str(_history_row_value(row, "受奖/惩人") or "").strip()
		employee_code = _history_employee_code(_history_row_value(row, "受奖/惩人工号", "工号"))
		reward_date = _history_date(_history_row_value(row, "奖/惩日期"))
		green = _history_number(_history_row_value(row, "绿苹果"))
		red = _history_number(_history_row_value(row, "红苹果"))
		row_errors = []
		if not employee_name:
			row_errors.append("受奖/惩人为空")
		if not reward_date:
			row_errors.append("奖/惩日期无效")
		if green is None or red is None:
			row_errors.append("红苹果或绿苹果不是数字")
		elif green < 0 or red < 0:
			row_errors.append("红苹果和绿苹果不能为负数")
		employee = None
		if employee_name or employee_code:
			lookup_key = (employee_code, employee_name)
			if lookup_key not in employee_cache:
				employee_cache[lookup_key] = _history_employee(company, employee_code, employee_name)
			employee, match_error = employee_cache[lookup_key]
			if match_error:
				row_errors.append(match_error)
		if row_errors:
			issues.append({"row": source_row, "employee_name": employee_name, "message": "；".join(row_errors)})
			continue
		month = reward_date.strftime("%Y-%m")
		months.add(month)
		accepted.append({
			"source_row": source_row,
			"sequence": _history_row_value(row, "序号") or source_row,
			"created_at": _history_row_value(row, "创建时间"),
			"reward_date": reward_date.isoformat(),
			"employee": employee.get("name"),
			"employee_code": str(employee.get("custom_employee_code") or "").strip(),
			"employee_name": employee.get("employee_name") or employee_name,
			"department": employee.get("department") or "",
			"source_department": _history_row_value(row, "受奖/惩人部门", "部门"),
			"green_apples": green,
			"red_apples": red,
			"reward_item": _history_row_value(row, "奖/惩项目"),
			"note": _history_row_value(row, "备注"),
			"created_by_name": _history_row_value(row, "创建人"),
			"signature": _history_row_value(row, "签名"),
			"note_2": _history_row_value(row, "备注_2", "备注2"),
		})
	if len(months) > 1:
		issues.append({"row": 0, "employee_name": "", "message": f"单个文件只能导入一个月份，当前包含：{'、'.join(sorted(months))}"})
	if not accepted and not issues:
		issues.append({"row": 0, "employee_name": "", "message": "工作表中没有可导入的数据行"})
	attendance_month = next(iter(months)) if len(months) == 1 else ""
	aggregates = {}
	for row in accepted:
		key = row["employee_code"]
		item = aggregates.setdefault(key, {
			"employee": row["employee"], "employee_code": key,
			"employee_name": row["employee_name"], "department": row["department"],
			"source_department": row["source_department"],
			"green_apples": 0.0, "red_apples": 0.0, "source_rows": [],
		})
		item["green_apples"] += row["green_apples"]
		item["red_apples"] += row["red_apples"]
		item["source_rows"].append(row)
	active_batches = frappe.get_all(
		ATTENDANCE_BATCH_DOCTYPE,
		filters={"company": company, "attendance_month": attendance_month, "source_type": HISTORY_SOURCE_TYPE, "status": ["!=", "已撤销"]},
		fields=["name", "source_checksum"],
		limit_page_length=20,
	) if attendance_month else []
	fingerprint = hashlib.sha256(f"{checksum}|{company}|{attendance_month}|{len(source_rows)}|{len(accepted)}".encode()).hexdigest()
	return {
		"company": company,
		"file_url": file_url,
		"source_checksum": checksum,
		"fingerprint": fingerprint,
		"sheet_name": sheet_name,
		"header_row": header_row,
		"attendance_month": attendance_month,
		"source_row_count": len(source_rows),
		"accepted_row_count": len(accepted),
		"employee_count": len(aggregates),
		"green_apples": _display_number(sum(row["green_apples"] for row in accepted)),
		"red_apples": _display_number(sum(row["red_apples"] for row in accepted)),
		"issues": issues[:100],
		"issue_count": len(issues),
		"can_import": not issues and bool(accepted) and bool(attendance_month),
		"duplicate": any(row.get("source_checksum") == checksum for row in active_batches),
		"replaces_batches": [row.get("name") for row in active_batches if row.get("source_checksum") != checksum],
		"aggregates": list(aggregates.values()),
	}


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


def _parse_custom_date_range(start_date, end_date):
	start_text = str(start_date or "").strip()
	end_text = str(end_date or "").strip()
	if not start_text and not end_text:
		return None, None
	if not start_text or not end_text:
		frappe.throw("开始日期和结束日期需要同时填写。")
	try:
		start = date.fromisoformat(start_text)
		end = date.fromisoformat(end_text)
	except ValueError:
		frappe.throw("自定义日期范围应为 YYYY-MM-DD。")
	if start > end:
		frappe.throw("开始日期不能晚于结束日期。")
	return start, end


def _month_bounds(attendance_month):
	year, month = (int(value) for value in attendance_month.split("-"))
	start = date(year, month, 1)
	end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
	return start, end


def _record_key(row):
	# Company employee code is the stable business identity for Apple-tree rows.
	return str(row.get("employee_code") or row.get("employee") or row.get("employee_name") or "未匹配员工").strip()


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


def _active_history_batch(company, attendance_month):
	rows = frappe.get_all(
		ATTENDANCE_BATCH_DOCTYPE,
		filters={
			"company": company,
			"attendance_month": attendance_month,
			"source_type": HISTORY_SOURCE_TYPE,
			"status": ["!=", "已撤销"],
		},
		fields=["name", "source_file", "source_checksum", "modified"],
		order_by="modified desc",
		limit_page_length=1,
	)
	return rows[0] if rows else None


def _record_value(row, field, default=""):
	if isinstance(row, dict):
		return row.get(field, default)
	return getattr(row, field, default)


def _source_value(row, *keys):
	for key in keys:
		value = row.get(key) if isinstance(row, dict) else None
		if value not in (None, ""):
			return value
	return ""


def _apple_detail_from_source(raw, record=None, sequence=1):
	record = record or {}
	return {
		"sequence": _source_value(raw, "序号", "sequence") or sequence,
		"created_at": _source_value(raw, "创建时间", "created_at") or _record_value(record, "creation", ""),
		"reward_date": _source_value(raw, "奖/惩日期", "reward_date") or _record_value(record, "reward_date", "") or _record_value(record, "attendance_month", ""),
		"department": _source_value(raw, "受奖/惩人部门", "部门", "source_department", "department") or _record_value(record, "department", ""),
		"employee_code": _source_value(raw, "受奖/惩人工号", "工号", "employee_code") or _record_value(record, "employee_code", ""),
		"employee_name": _source_value(raw, "受奖/惩人", "employee_name") or _record_value(record, "employee_name", ""),
		"green_apples": _display_number(_source_value(raw, "绿苹果", "green_apples") or _record_value(record, "green_apples", 0)),
		"red_apples": _display_number(_source_value(raw, "红苹果", "red_apples") or _record_value(record, "red_apples", 0)),
		"reward_item": _source_value(raw, "奖/惩项目", "reward_item") or _record_value(record, "reward_item", ""),
		"note": _source_value(raw, "备注", "note"),
		"created_by_name": _source_value(raw, "创建人", "created_by_name") or _record_value(record, "created_by_name", ""),
		"signature": _source_value(raw, "签名", "signature"),
		"note_2": _source_value(raw, "备注_2", "备注2", "note_2"),
	}


def _apple_detail_from_record(row, sequence=1):
	"""Project a stored Apple reward record onto the workbook detail columns."""
	raw = _record_value(row, "raw_row_json", "")
	try:
		raw = json.loads(raw or "{}") if isinstance(raw, str) else (raw or {})
	except (TypeError, ValueError):
		raw = {}
	return _apple_detail_from_source(raw, row, sequence)


def _active_apple_detail_rows(company, attendance_month, employee_code, start_date=None, end_date=None):
	"""Read valid current-version Apple rows for one employee and month."""
	batches = frappe.get_all(ATTENDANCE_BATCH_DOCTYPE, filters={"company": company}, pluck="name")
	if not batches:
		return []
	rows = frappe.get_all(
		APPLE_RECORD_DOCTYPE,
		filters={"import_batch": ["in", batches], "reward_date": ["between", list(_month_bounds(attendance_month))]},
		fields=["name", "creation", "import_batch", "reward_date", "employee_code", "employee_name", "department", "reward_item", "green_apples", "red_apples", "is_valid_approval", "created_by_name", "raw_row_json"],
		order_by="reward_date asc, creation asc", limit_page_length=MAX_VISIBLE_RECORDS,
	)
	result = []
	for index, row in enumerate(rows, start=1):
		if not _record_value(row, "is_valid_approval", 0):
			continue
		detail = _apple_detail_from_record(row, index)
		if _history_employee_code(detail.get("employee_code", "")) != employee_code:
			continue
		if not _apple_detail_matches(detail, start_date, end_date):
			continue
		result.append(detail)
	return result


def _list_history_month_records(company, attendance_month, start_date=None, end_date=None, include_detail=False):
	batch = _active_history_batch(company, attendance_month)
	if not batch:
		return []
	rows = frappe.get_all(
		HISTORY_SUMMARY_DOCTYPE,
		filters={"import_batch": batch.get("name"), "company": company, "attendance_month": attendance_month},
		fields=["name", "employee", "employee_code", "employee_name", "department", "source_department", "green_apples", "red_apples", "reward_amount", "source_row_count", "source_rows_json"],
		order_by="department asc, employee_code asc",
		limit_page_length=MAX_VISIBLE_RECORDS,
	)
	result = []
	for row in rows:
		green_apples = row.get("green_apples")
		red_apples = row.get("red_apples")
		reward_amount = row.get("reward_amount")
		source_row_count = row.get("source_row_count") or 0
		try:
			source_rows = json.loads(row.get("source_rows_json") or "[]")
		except (TypeError, ValueError):
			source_rows = []
		detail_source_rows = source_rows
		if start_date and end_date:
			matching_rows = []
			for source_row in source_rows:
				try:
					reward_date = date.fromisoformat(str(source_row.get("reward_date") or ""))
				except ValueError:
					continue
				if start_date <= reward_date <= end_date:
					matching_rows.append(source_row)
			if not matching_rows:
				continue
			green_apples = sum(_number(item.get("green_apples")) for item in matching_rows)
			red_apples = sum(_number(item.get("red_apples")) for item in matching_rows)
			reward_amount = (green_apples - red_apples) * APPLE_UNIT_AMOUNT
			source_row_count = len(matching_rows)
			detail_source_rows = matching_rows
		result.append({
		"name": row.get("name") or "",
		"reward_date": f"{attendance_month}-01",
		"attendance_month": attendance_month,
		"employee": row.get("employee") or "",
		"employee_code": row.get("employee_code") or "",
		"employee_name": row.get("employee_name") or "未匹配员工",
		"department": row.get("source_department") or row.get("department") or "",
		"reward_item": "历史数据导入",
		"green_apples": _display_number(green_apples),
		"red_apples": _display_number(red_apples),
		"reward_amount": _display_number(reward_amount),
		"approval_no": f"历史批次:{batch.get('name')}",
		"approval_result": "历史导入",
		"approval_status": "已确认",
		"is_valid_approval": 1,
		"created_by_name": "",
		"source_row_count": source_row_count,
		"detail_rows": [_apple_detail_from_source(item, sequence=index + 1) for index, item in enumerate(detail_source_rows)] if include_detail else [],
		})
	return result


def _available_history_months(company):
	rows = frappe.get_all(
		ATTENDANCE_BATCH_DOCTYPE,
		filters={"company": company, "source_type": HISTORY_SOURCE_TYPE, "status": ["!=", "已撤销"]},
		pluck="attendance_month",
		limit_page_length=MAX_VISIBLE_RECORDS,
	)
	return {str(month or "").strip() for month in rows if re.match(r"^\d{4}-\d{2}$", str(month or "").strip())}


def _require_history_import_access(company):
	frappe.only_for(("System Manager", "HR Manager"))
	company = str(company or "").strip()
	if not company or not frappe.db.exists("Company", company):
		frappe.throw("请选择有效的目标公司。")
	return company


@frappe.whitelist()
def preview_history_import(file_url: str, company: str = ""):
	"""Read the supplied monthly Apple-tree workbook without writing records."""
	company = _require_history_import_access(company)
	preview = _history_preview_data(str(file_url or "").strip(), company)
	preview.pop("aggregates", None)
	return preview


@frappe.whitelist()
def download_history_import_template():
	"""Download the maintained Apple-tree workbook layout without creating File rows."""
	frappe.only_for(("System Manager", "HR Manager"))
	output = BytesIO()
	_build_history_import_template().save(output)
	frappe.local.response.filename = "苹果树合计填写模板.xlsx"
	frappe.local.response.filecontent = output.getvalue()
	frappe.local.response.type = "binary"


EXPORT_VIEWS = {"annual-summary", "monthly-detail", "person"}


def _export_rows(view, data):
	if view == "person":
		columns = [(field, label) for field, label, _numeric in APPLE_DETAIL_COLUMNS]
		rows = [dict(row) for row in data.get("rows", [])]
		person = data.get("person", {})
		total = {
			"sequence": "合计", "department": person.get("department"),
			"employee_name": person.get("employee_name"), "employee_code": person.get("employee_code"), "__total": True,
		}
		total.update(data.get("totals", {}))
		return columns, [*rows, total]
	if view == "monthly-detail":
		columns = [
			("attendance_month", "月份"), ("department", "部门"), ("employee_name", "姓名"),
			("employee_code", "工号"), ("green_apples", "绿苹果"), ("red_apples", "红苹果"),
			("net_apples", "净苹果"), ("reward_amount", "苹果金额"), ("reward_item", "来源"),
			("final_status", "终稿状态"),
		]
		rows = []
		for source in data.get("records", []):
			row = dict(source)
			row["attendance_month"] = row.get("attendance_month") or str(row.get("reward_date") or "")[:7]
			row["net_apples"] = _display_number(_number(row.get("green_apples")) - _number(row.get("red_apples")))
			row["final_status"] = (
				f"{row.get('approval_result') or '-'} / {row.get('approval_status') or '-'}"
				if row.get("approval_result") or row.get("approval_status") else "未提供"
			)
			rows.append(row)
		return columns, rows
	columns = [
		("department", "部门"), ("employee_name", "姓名"), ("employee_code", "工号"),
		("green_apples", "绿苹果"), ("red_apples", "红苹果"), ("net_apples", "净苹果"),
		("reward_amount", "苹果金额"), ("record_count", "记录数"),
	]
	return columns, data.get("people", [])


def _filtered_export_rows(columns, rows, column_filters="", sort_key="", sort_order="desc"):
	try:
		filters = json.loads(column_filters) if isinstance(column_filters, str) and column_filters else (column_filters or {})
	except (TypeError, ValueError):
		filters = {}
	allowed = {field for field, _label in columns}
	filters = {field: str(value or "").strip().lower() for field, value in filters.items() if field in allowed and str(value or "").strip()}
	total_rows = [row for row in rows if row.get("__total")]
	result = [row for row in rows if not row.get("__total") and all(query in str(row.get(field) or "").lower() for field, query in filters.items())]
	if sort_key not in allowed:
		return result + total_rows
	numeric_fields = {"green_apples", "red_apples", "net_apples", "reward_amount", "record_count"} | {field for field, _label, numeric in PERSON_COLUMNS if numeric}
	reverse = str(sort_order or "desc").lower() != "asc"
	def key(row):
		value = row.get(sort_key)
		return _number(value) if sort_key in numeric_fields else str(value or "")
	present = [row for row in result if row.get(sort_key) not in (None, "")]
	empty = [row for row in result if row.get(sort_key) in (None, "")]
	return sorted(present, key=key, reverse=reverse) + empty + total_rows


def _build_export_workbook(view, data, title, column_filters="", sort_key="", sort_order="desc"):
	from openpyxl import Workbook
	from openpyxl.styles import Alignment, Font, PatternFill
	from openpyxl.utils import get_column_letter

	columns, rows = _export_rows(view, data)
	rows = _filtered_export_rows(columns, rows, column_filters, sort_key, sort_order)
	workbook = Workbook()
	sheet = workbook.active
	sheet.title = "苹果树统计"
	sheet.append([title])
	sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(columns))
	sheet["A1"].font = Font(size=16, bold=True)
	sheet["A1"].alignment = Alignment(horizontal="center")
	sheet.append([label for _field, label in columns])
	for cell in sheet[2]:
		cell.font = Font(bold=True, color="FFFFFF")
		cell.fill = PatternFill("solid", fgColor="4472C4")
		cell.alignment = Alignment(horizontal="center")
	for row in rows:
		sheet.append([_excel_value(row.get(field)) for field, _label in columns])
	sheet.freeze_panes = "A3"
	sheet.auto_filter.ref = f"A2:{get_column_letter(len(columns))}{max(2, sheet.max_row)}"
	for index, (field, label) in enumerate(columns, start=1):
		values = [label, *[str(row.get(field) or "") for row in rows[:500]]]
		sheet.column_dimensions[get_column_letter(index)].width = min(40, max(10, max(map(len, values)) + 2))
	return workbook


@frappe.whitelist()
def download_export(view: str = "annual-summary", year: str = "", month: str = "", search: str = "", company: str = "", start_date: str = "", end_date: str = "", person: str = "", column_filters: str = "", sort_key: str = "", sort_order: str = "desc", detail_start_date: str = "", detail_end_date: str = "", detail_search: str = ""):
	"""Download the currently selected Apple-tree statistics view as Excel."""
	view = str(view or "annual-summary").strip()
	if view not in EXPORT_VIEWS:
		frappe.throw("不支持的苹果树导出视图。")
	if view == "person":
		if not str(person or "").strip():
			frappe.throw("请先选择要导出的员工。")
		data = get_person_detail(person=str(person).strip(), year=year, company=company, month=month, search=search, start_date=start_date, end_date=end_date, detail_start_date=detail_start_date, detail_end_date=detail_end_date, detail_search=detail_search)
		if not data.get("available"):
			frappe.throw(data.get("reason") or "当前员工没有可导出的苹果树记录。")
		person_name = data.get("person", {}).get("employee_name") or str(person).strip()
		title = f"{data.get('year')}年 {person_name} 苹果树明细"
		filename = f"苹果树统计_{data.get('year')}_{person_name}.xlsx"
	else:
		data = get_data(year=year, month=month, search=search, company=company, start_date=start_date, end_date=end_date)
		period = data["filters"].get("month") or (
			f"{data['filters'].get('start_date')}_{data['filters'].get('end_date')}" if data["filters"].get("start_date") else f"{data['filters'].get('year')}年"
		)
		view_label = "每月明细" if view == "monthly-detail" else "个人汇总"
		title = f"{period} 苹果树{view_label}"
		filename = f"苹果树统计_{period}_{view_label}.xlsx"
	output = BytesIO()
	_build_export_workbook(view, data, title, column_filters, sort_key, sort_order).save(output)
	frappe.local.response.filename = re.sub(r'[\\/:*?"<>|]', "_", filename)
	frappe.local.response.filecontent = output.getvalue()
	frappe.local.response.type = "binary"


@frappe.whitelist()
def import_history(file_url: str, company: str = "", fingerprint: str = ""):
	"""Create one isolated statistics-only monthly history version after preview."""
	company = _require_history_import_access(company)
	preview = _history_preview_data(str(file_url or "").strip(), company)
	if not preview["can_import"]:
		frappe.throw("当前文件未通过预览校验，不能导入。")
	if not fingerprint or fingerprint != preview["fingerprint"]:
		frappe.throw("文件或公司已变更，请重新预览后再确认。")
	if preview["duplicate"]:
		return {
			"duplicate": 1,
			"attendance_month": preview["attendance_month"],
			"source_row_count": preview["source_row_count"],
			"employee_count": preview["employee_count"],
		}
	for batch_name in preview["replaces_batches"]:
		frappe.db.set_value(ATTENDANCE_BATCH_DOCTYPE, batch_name, "status", "已撤销")
	batch = frappe.get_doc({
		"doctype": ATTENDANCE_BATCH_DOCTYPE,
		"company": company,
		"attendance_month": preview["attendance_month"],
		"source_file": file_url,
		"source_type": HISTORY_SOURCE_TYPE,
		"source_checksum": preview["source_checksum"],
		"status": "已导入",
		"apple_sheet_rows": preview["source_row_count"],
		"imported_by": frappe.session.user,
		"imported_on": now_datetime(),
		"notes": json.dumps({
			"purpose": "apple_tree_statistics_only",
			"sheet_name": preview["sheet_name"],
			"header_row": preview["header_row"],
			"accepted_rows": preview["accepted_row_count"],
			"employee_count": preview["employee_count"],
			"replaces_batches": preview["replaces_batches"],
		}, ensure_ascii=False),
	})
	batch.insert(ignore_permissions=True)
	for item in preview["aggregates"]:
		frappe.get_doc({
			"doctype": HISTORY_SUMMARY_DOCTYPE,
			"import_batch": batch.name,
			"company": company,
			"attendance_month": preview["attendance_month"],
			"employee": item["employee"],
			"employee_code": item["employee_code"],
			"employee_name": item["employee_name"],
			"department": item["department"],
			"source_department": item["source_department"],
			"green_apples": item["green_apples"],
			"red_apples": item["red_apples"],
			"reward_amount": (item["green_apples"] - item["red_apples"]) * APPLE_UNIT_AMOUNT,
			"source_row_count": len(item["source_rows"]),
			"source_rows_json": json.dumps(item["source_rows"], ensure_ascii=False, default=str),
		}).insert(ignore_permissions=True)
	frappe.db.commit()
	return {
		"batch": batch.name,
		"attendance_month": preview["attendance_month"],
		"source_row_count": preview["source_row_count"],
		"employee_count": preview["employee_count"],
		"green_apples": preview["green_apples"],
		"red_apples": preview["red_apples"],
		"replaced_batch_count": len(preview["replaces_batches"]),
	}


def _person_totals(rows):
	# Unknown data must not be presented as a zero or a complete annual total.
	return {
		field: _display_number(sum(_number(row[field]) for row in rows))
		if rows and all(row.get(field) not in (None, "") for row in rows) else None
		for field, _label, numeric in PERSON_COLUMNS if numeric
	}


def _apple_detail_totals(rows):
	return {
		"green_apples": _display_number(sum(_number(row.get("green_apples")) for row in rows)),
		"red_apples": _display_number(sum(_number(row.get("red_apples")) for row in rows)),
	}


def _apple_detail_matches(row, start_date=None, end_date=None, search=""):
	date_text = str(row.get("reward_date") or "")[:10]
	if start_date and (not date_text or date_text < start_date.isoformat()):
		return False
	if end_date and (not date_text or date_text > end_date.isoformat()):
		return False
	if search:
		haystack = " ".join(str(row.get(field) or "") for field, _label, _numeric in APPLE_DETAIL_COLUMNS).casefold()
		if search.casefold() not in haystack:
			return False
	return True


def _filter_apple_detail_rows(rows, start_date=None, end_date=None, search=""):
	return [row for row in rows if _apple_detail_matches(row, start_date, end_date, str(search or "").strip())]


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
def get_person_detail(person: str, year: str = "", company: str = "", month: str = "", search: str = "", start_date: str = "", end_date: str = "", detail_start_date: str = "", detail_end_date: str = "", detail_search: str = ""):
	"""Return the employee's raw Apple-tree reward/penalty ledger."""
	data = get_data(year=year, month=month, search=search, company=company, start_date=start_date, end_date=end_date)
	outer_start = _history_date(data["filters"].get("start_date")) if data["filters"].get("start_date") else None
	outer_end = _history_date(data["filters"].get("end_date")) if data["filters"].get("end_date") else None
	detail_start, detail_end = _parse_custom_date_range(detail_start_date, detail_end_date)
	key = str(person or "").strip()
	employee = next(
		(row for row in data["people"] if str(row.get("employee_code") or "") == key or _record_key(row) == key),
		None,
	)
	if not employee:
		return {"available": False, "reason": "所选年度内没有该员工可查看的苹果树记录。"}
	person_code = str(employee.get("employee_code") or "")
	summary_rows = [dict(row) for row in data["records"] if str(row.get("employee_code") or "") == person_code]
	year_text = str(data["filters"]["year"])
	history_months = _available_history_months(data["filters"]["company"])
	months = sorted({str(row.get("attendance_month") or row.get("reward_date") or "")[:7] for row in summary_rows if str(row.get("attendance_month") or row.get("reward_date") or "")[:4] == year_text})
	rows = []
	for attendance_month in months:
		if attendance_month in history_months:
			history_rows = _list_history_month_records(data["filters"]["company"], attendance_month, outer_start, outer_end, include_detail=True)
			detail_rows = [detail for item in history_rows if str(item.get("employee_code") or "") == person_code for detail in item.get("detail_rows", [])]
		else:
			detail_rows = _active_apple_detail_rows(data["filters"]["company"], attendance_month, person_code, outer_start, outer_end)
		if detail_rows:
			rows.extend(detail_rows)
			continue
		# A monthly final can contain a manually entered aggregate without a raw
		# Apple record. Keep that value visible and label it as an aggregate.
		for summary in summary_rows:
			if str(summary.get("attendance_month") or summary.get("reward_date") or "")[:7] != attendance_month:
				continue
			if _number(summary.get("green_apples")) or _number(summary.get("red_apples")):
				fallback = _apple_detail_from_record({**summary, "reward_item": summary.get("reward_item") or "月度考勤终稿"}, len(rows) + 1)
				rows.append(fallback)
	rows = _filter_apple_detail_rows(rows, detail_start, detail_end, detail_search)
	rows.sort(key=lambda row: (str(row.get("reward_date") or ""), _number(row.get("sequence"))))
	return {
		"available": True, "person": employee, "year": data["filters"]["year"],
		"available_years": data.get("available_years", [data["filters"]["year"]]),
		"company": data["filters"]["company"], "rows": rows, "totals": _apple_detail_totals(rows),
		"filters": {"month": data["filters"].get("month", ""), "search": data["filters"].get("search", ""), "start_date": data["filters"].get("start_date", ""), "end_date": data["filters"].get("end_date", ""), "detail_start_date": detail_start.isoformat() if detail_start else "", "detail_end_date": detail_end.isoformat() if detail_end else "", "detail_search": str(detail_search or "").strip()},
		"columns": [{"field": field, "label": label, "numeric": numeric} for field, label, numeric in APPLE_DETAIL_COLUMNS],
	}


@frappe.whitelist()
def get_data(year: str = "", month: str = "", search: str = "", company: str = "", start_date: str = "", end_date: str = ""):
	"""Return a permission-aware Apple-tree statistical view.

	The active monthly attendance final is the canonical source for the annual
	and monthly Apple-tree tables.  It never changes attendance finals or
	payroll results.
	"""
	year = _parse_year(year)
	month = _parse_month(month, year)
	custom_start, custom_end = _parse_custom_date_range(start_date, end_date)
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
	history_months = _available_history_months(company)
	available_months = sorted(set(available_months) | history_months, reverse=True)
	available_years = _available_years([{"reward_date": f"{item}-01"} for item in available_months], year)
	if custom_start and custom_end:
		target_months = [
			item for item in available_months
			if _month_bounds(item)[0] <= custom_end and _month_bounds(item)[1] > custom_start
		]
	else:
		target_months = [month] if month else [item for item in available_months if item.startswith(f"{year}-")]
	if not custom_start and "-Q" in month:
		quarter_start = (int(month[-1]) - 1) * 3 + 1
		target_months = [f"{year}-{number:02d}" for number in range(quarter_start, quarter_start + 3) if f"{year}-{number:02d}" in available_months]
	records = []
	for attendance_month in target_months:
		# A history import is an explicit statistics-only version for that month.
		# It takes precedence on this page but never mutates or feeds attendance/payroll.
		history_records = (
			_list_history_month_records(company, attendance_month, custom_start, custom_end)
			if attendance_month in history_months and custom_start
			else _list_history_month_records(company, attendance_month)
			if attendance_month in history_months
			else []
		)
		if attendance_month in history_months:
			records.extend(history_records)
		elif not custom_start or (custom_start <= _month_bounds(attendance_month)[0] and custom_end >= _month_bounds(attendance_month)[1] - date.resolution):
			records.extend(_summary_record(row) for row in _list_active_month_records(company, attendance_month))
	records = [row for row in records if _matches_search(row, str(search or "").strip())]
	summary, people, months = _summarize_records(records)
	return {
		"filters": {"year": str(year), "month": month, "search": str(search or "").strip(), "company": company, "start_date": custom_start.isoformat() if custom_start else "", "end_date": custom_end.isoformat() if custom_end else ""},
		"available_years": available_years,
		"summary": summary,
		"people": people,
		"months": months,
		"records": records,
		"notice": "统计范围为当前公司。已单独导入历史数据的月份使用历史导入版本，其他月份使用月度考勤终稿当前生效版本；历史导入不修改考勤终稿或薪资。" + (" 自定义日期范围内，历史导入按奖/惩日期精确统计；月度考勤终稿仅在范围完整覆盖该月时纳入。" if custom_start else "") + (" 当前筛选结果超过 10000 条，请缩小年份、月份或日期范围。" if len(records) >= MAX_VISIBLE_RECORDS else ""),
	}
