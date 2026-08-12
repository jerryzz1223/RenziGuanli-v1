"""Pure processor for the DingTalk daily attendance-detail export.

The public result is one ``processed_rows`` dataset: one employee per row.  It
does not infer special hours or copy the manually adjusted sample summary.  Raw
rows remain in ``original_value`` / ``source_rows`` so a shared review queue can
audit every exception without silently losing source data.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from copy import deepcopy
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any



REVIEW_NOT_REQUIRED = "无需审核"
REVIEW_PENDING = "待审核"
REVIEW_APPROVED = "已通过"
REVIEW_REJECTED = "已驳回"

NUMERIC_FIELDS = {
	"standard_hours": ("标准工时", "标准工时（小时）"),
	"actual_attendance_hours": ("实际出勤（小时）", "实际出勤"),
	"workday_overtime_hours": ("工作日加班（小时）",),
	"restday_overtime_hours": ("休息日加班（小时）",),
	"holiday_overtime_hours": ("节假日加班（小时）",),
	"large_night_shifts": ("大夜班",),
	"small_night_shifts": ("小夜班",),
	"personal_leave_hours": ("请假/事假(小时)", "事假(小时)"),
	"sick_leave_hours": ("病假(小时)",),
	"annual_leave_hours": ("特休(小时)",),
	"work_injury_hours": ("工伤(小时)",),
	"rest_arrangement_hours": ("排休(小时)",),
	"absence_hours": ("旷工(小时)",),
	"clock_in_missing_count": ("上班未打卡次数",),
	"clock_out_missing_count": ("下班未打卡次数",),
}

IDENTITY_FIELDS = {
	"employee_code": ("工号", "员工工号", "employee_code"),
	"employee_name": ("姓名", "员工姓名", "employee_name"),
	"department": ("实际部门", "部门", "department"),
	"attendance_date": ("日期", "考勤日期", "attendance_date"),
	"shift": ("班次", "shift"),
}

EXCEPTION_MESSAGES = {
	"ATTENDANCE_DATE_MISSING": "考勤日期为空。",
	"ATTENDANCE_DATE_DUPLICATE": "同一工号存在重复考勤日期。",
	"ATTENDANCE_DATE_INVALID": "考勤日期无法解析。",
	"ATTENDANCE_MONTH_MISMATCH": "考勤日期不属于当前处理月份。",
	"EMPLOYEE_CODE_MISSING": "员工工号为空，不能作为主键。",
	"EMPLOYEE_CODE_NAME_CONFLICT": "同一工号出现多个姓名。",
	"EMPLOYEE_DEPARTMENT_CONFLICT": "同一工号出现多个部门。",
	"EMPLOYEE_NAME_MISMATCH": "工号对应姓名与员工目录不一致。",
	"EMPLOYEE_DEPARTMENT_MISMATCH": "工号对应部门与员工目录不一致。",
	"EMPLOYEE_NOT_FOUND": "员工工号未匹配到员工目录。",
	"EMPLOYEE_NAME_AMBIGUOUS": "姓名匹配到多个员工工号。",
	"INVALID_NUMERIC_VALUE": "工时或次数字段不是有效数字。",
	"SHIFT_MISSING": "班次为空，需要确认是否为入职前、离职后或人工补录记录。",
	"CLOCK_IN_MISSING": "钉钉明确存在上班未打卡记录。",
	"CLOCK_OUT_MISSING": "钉钉明确存在下班未打卡记录。",
	"SOURCE_FILE_MISSING": "来源文件定位为空。",
	"SOURCE_SHEET_MISSING": "来源工作表定位为空。",
	"SOURCE_ROW_MISSING": "来源行号为空。",
	"STRUCTURE_MISSING_REQUIRED_FIELD": "源表缺少必要字段。",
}

REQUIRED_FIELDS = ("employee_code", "employee_name", "attendance_date")
_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_DATE_RE = re.compile(r"^(?:(\d{4})|(?:\d{2}))(?:-|/)(\d{1,2})(?:-|/)(\d{1,2})")


def precheck_attendance_draft_structure(headers: Sequence[Any]) -> dict[str, Any]:
	"""Validate only the minimum DingTalk daily-detail contract."""
	available = {_text(header): header for header in headers if _text(header)}
	mapping: dict[str, str] = {}
	missing: list[str] = []
	for fieldname in REQUIRED_FIELDS:
		matched = next((alias for alias in IDENTITY_FIELDS[fieldname] if alias in available), "")
		mapping[fieldname] = matched
		if not matched:
			missing.append(fieldname)
	for fieldname, aliases in NUMERIC_FIELDS.items():
		mapping[fieldname] = next((alias for alias in aliases if alias in available), "")
	return {
		"is_valid": not missing,
		"status": "结构通过" if not missing else "结构异常",
		"field_mapping": mapping,
		"missing_required_fields": missing,
		"headers": list(available),
	}


def flatten_dingtalk_headers(top_row: Sequence[Any], second_row: Sequence[Any]) -> list[str]:
	"""Flatten the two header rows used by ``每日明细（钉钉导出）``."""
	headers = []
	for top, second in zip(top_row, second_row):
		parent, child = _text(top), _text(second)
		if parent == "请假" and child:
			headers.append(f"请假/{child}")
		elif parent and child and parent != child:
			headers.append(f"{parent}/{child}")
		else:
			headers.append(parent or child)
	return headers


def rows_from_dingtalk_daily_sheet(sheet: Any, *, source_file: str = "") -> list[dict[str, Any]]:
	"""Read an openpyxl worksheet without depending on Frappe."""
	values = sheet.iter_rows(values_only=True)
	try:
		top_row = next(values)
		second_row = next(values)
	except StopIteration:
		return []
	headers = flatten_dingtalk_headers(top_row, second_row)
	rows = []
	for source_row, values_row in enumerate(values, start=3):
		if not any(value not in (None, "") for value in values_row):
			continue
		row = {header: values_row[index] if index < len(values_row) else None for index, header in enumerate(headers) if header}
		row.update({"source_file": source_file, "source_sheet": sheet.title, "source_row": source_row})
		rows.append(row)
	return rows


def process_attendance_draft_rows(
	raw_rows: Iterable[Mapping[str, Any]],
	*,
	attendance_month: str,
	source_file: str = "",
	source_sheet: str = "每日明细（钉钉导出）",
	employee_directory: Iterable[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
	"""Aggregate a DingTalk daily-detail export into one employee dataset."""
	if not _MONTH_RE.fullmatch(_text(attendance_month)):
		raise ValueError("attendance_month must use YYYY-MM")
	input_rows = [dict(row) for row in raw_rows]
	structure = precheck_attendance_draft_structure(_ordered_headers(input_rows))
	employee_index = _build_employee_index(employee_directory)
	date_counts = Counter()
	for row in input_rows:
		code = _value(row, IDENTITY_FIELDS["employee_code"])
		date_key = _parse_date(_value(row, IDENTITY_FIELDS["attendance_date"]), attendance_month)
		if code and date_key:
			date_counts[(code, date_key)] += 1
	groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
	missing_code_rows: list[dict[str, Any]] = []
	for row in input_rows:
		code = _value(row, IDENTITY_FIELDS["employee_code"])
		if code:
			groups[code].append(row)
		else:
			missing_code_rows.append(row)
	for index, row in enumerate(missing_code_rows, start=1):
		groups[f"__missing__{index}"].append(row)

	processed_rows = [
		_aggregate_employee_rows(
			rows,
			attendance_month=attendance_month,
			source_file=source_file,
			source_sheet=source_sheet,
			structure=structure,
			employee_index=employee_index,
			date_counts=date_counts,
		)
		for _key, rows in sorted(groups.items(), key=lambda item: _group_sort_key(item[1]))
	]
	exception_rows = sum(1 for row in processed_rows if row["review_status"] == REVIEW_PENDING)
	return {
		"status": "待处理异常" if exception_rows else "待确认",
		"structure_precheck": structure,
		"processed_rows": processed_rows,
		"metrics": {
			"source_rows": len(input_rows),
			"processed_rows": len(processed_rows),
			"exception_rows": exception_rows,
			"eligible_rows": sum(1 for row in processed_rows if row["eligible_for_downstream"]),
		},
	}


def _aggregate_employee_rows(rows, *, attendance_month, source_file, source_sheet, structure, employee_index, date_counts):
	first = rows[0]
	raw_code = _value(first, IDENTITY_FIELDS["employee_code"])
	names = {_value(row, IDENTITY_FIELDS["employee_name"]) for row in rows if _value(row, IDENTITY_FIELDS["employee_name"])}
	departments = {normalize_department_name(_value(row, IDENTITY_FIELDS["department"])) for row in rows if _value(row, IDENTITY_FIELDS["department"])}
	codes: list[str] = []
	if structure["missing_required_fields"]:
		_add_code(codes, "STRUCTURE_MISSING_REQUIRED_FIELD")
	if not raw_code:
		_add_code(codes, "EMPLOYEE_CODE_MISSING")
	if len(names) > 1:
		_add_code(codes, "EMPLOYEE_CODE_NAME_CONFLICT")
	if len({_department_key(value) for value in departments}) > 1:
		_add_code(codes, "EMPLOYEE_DEPARTMENT_CONFLICT")
	name = next(iter(names), "")
	department = next(iter(departments), "")
	resolved_code, resolved_name, resolved_department = _resolve_employee(raw_code, name, department, employee_index, codes)
	totals = {field: Decimal("0") for field in NUMERIC_FIELDS}
	source_rows = []
	for row in rows:
		row_number = _source_row(row)
		date_value = _value(row, IDENTITY_FIELDS["attendance_date"])
		parsed_date = _parse_date(date_value, attendance_month)
		if not date_value:
			_add_code(codes, "ATTENDANCE_DATE_MISSING")
		elif not parsed_date:
			_add_code(codes, "ATTENDANCE_DATE_INVALID")
		elif parsed_date[:7] != attendance_month:
			_add_code(codes, "ATTENDANCE_MONTH_MISMATCH")
		elif raw_code and date_counts[(raw_code, parsed_date)] > 1:
			_add_code(codes, "ATTENDANCE_DATE_DUPLICATE")
		if not _value(row, IDENTITY_FIELDS["shift"]):
			_add_code(codes, "SHIFT_MISSING")
		if not _text(row.get("source_file") or source_file):
			_add_code(codes, "SOURCE_FILE_MISSING")
		if not _text(row.get("source_sheet") or source_sheet):
			_add_code(codes, "SOURCE_SHEET_MISSING")
		if row_number is None:
			_add_code(codes, "SOURCE_ROW_MISSING")
		for fieldname, aliases in NUMERIC_FIELDS.items():
			value, exists = _field_value(row, aliases)
			if not exists or _is_blank(value):
				continue
			number = _decimal(value)
			if number is None:
				_add_code(codes, "INVALID_NUMERIC_VALUE")
				continue
			totals[fieldname] += number
		source_rows.append({
			"source_file": _text(row.get("source_file") or source_file),
			"source_sheet": _text(row.get("source_sheet") or source_sheet),
			"source_row": row_number,
			"attendance_date": _text(date_value),
		})
	if totals["clock_in_missing_count"] > 0:
		_add_code(codes, "CLOCK_IN_MISSING")
	if totals["clock_out_missing_count"] > 0:
		_add_code(codes, "CLOCK_OUT_MISSING")
	proposed = {
		"employee_code": resolved_code or raw_code,
		"employee_name": resolved_name or name,
		"department": resolved_department or department,
		**{field: _display_number(value) for field, value in totals.items()},
		"source_row_count": len(rows),
	}
	review_status = REVIEW_PENDING if codes else REVIEW_NOT_REQUIRED
	return {
		"source_type": "attendance_draft",
		"employee_code": proposed["employee_code"],
		"employee_name": proposed["employee_name"],
		"department": proposed["department"],
		"processed_value": deepcopy(proposed),
		"proposed_value": proposed,
		"confirmed_value": None,
		"original_value": {"rows": deepcopy(rows), "source_rows": source_rows},
		"exception_codes": codes,
		"exception_message": "；".join(EXCEPTION_MESSAGES[code] for code in codes),
		"review_status": review_status,
		"reviewer": "",
		"reviewed_on": "",
		"review_note": "",
		"review_history": [],
		"eligible_for_downstream": review_status == REVIEW_NOT_REQUIRED,
		"source_file": source_rows[0]["source_file"] if source_rows else _text(source_file),
		"source_sheet": source_rows[0]["source_sheet"] if source_rows else _text(source_sheet),
		"source_row": source_rows[0]["source_row"] if source_rows else None,
		"source_id": f"{proposed['employee_code']}:{attendance_month}" if proposed["employee_code"] else "",
		"approval_no": "",
	}


def _build_employee_index(employee_directory):
	if employee_directory is None:
		return None
	by_code: dict[str, dict[str, str]] = {}
	by_name: dict[str, list[dict[str, str]]] = defaultdict(list)
	for raw in employee_directory:
		code = _value(raw, ("employee_code", "工号", "name"))
		name = _value(raw, ("employee_name", "姓名", "employee_full_name"))
		department = normalize_department_name(_value(raw, ("department", "部门")))
		if not code:
			continue
		employee = {"employee_code": code, "employee_name": name, "department": department}
		by_code[code] = employee
		if name:
			by_name[_name_key(name)].append(employee)
	return by_code, by_name


def _resolve_employee(code, name, department, employee_index, codes):
	if employee_index is None:
		return code, name, department
	by_code, by_name = employee_index
	if code:
		employee = by_code.get(code)
		if not employee:
			_add_code(codes, "EMPLOYEE_NOT_FOUND")
			return code, name, department
		if name and employee["employee_name"] and _name_key(name) != _name_key(employee["employee_name"]):
			_add_code(codes, "EMPLOYEE_NAME_MISMATCH")
		if department and employee["department"] and _department_key(department) != _department_key(employee["department"]):
			_add_code(codes, "EMPLOYEE_DEPARTMENT_MISMATCH")
		return employee["employee_code"], employee["employee_name"] or name, employee["department"] or department
	if name:
		matches = by_name.get(_name_key(name), [])
		if len(matches) == 1:
			return matches[0]["employee_code"], matches[0]["employee_name"], matches[0]["department"] or department
		_add_code(codes, "EMPLOYEE_NAME_AMBIGUOUS" if len(matches) > 1 else "EMPLOYEE_NOT_FOUND")
	return code, name, department


def _ordered_headers(rows):
	seen, headers = set(), []
	for row in rows:
		for key in row:
			if key not in seen:
				seen.add(key)
				headers.append(key)
	return headers


def _group_sort_key(rows):
	row = rows[0]
	return (_value(row, IDENTITY_FIELDS["department"]), _value(row, IDENTITY_FIELDS["employee_code"]), _value(row, IDENTITY_FIELDS["employee_name"]))


def _field_value(row, aliases):
	for alias in aliases:
		if alias in row:
			return row[alias], True
	return None, False


def _value(row, aliases):
	for alias in aliases:
		if alias in row and not _is_blank(row[alias]):
			return _text(row[alias])
	return ""


def _source_row(row):
	value = row.get("source_row") or row.get("_source_row")
	try:
		return int(value)
	except (TypeError, ValueError):
		return None


def _parse_date(value, attendance_month):
	if isinstance(value, datetime):
		return value.date().isoformat()
	if isinstance(value, date):
		return value.isoformat()
	text = _text(value)
	match = _DATE_RE.match(text)
	if not match:
		return ""
	year_text, month_text, day_text = match.groups()
	year = int(year_text) if year_text else 2000 + int(text[:2])
	try:
		return date(year, int(month_text), int(day_text)).isoformat()
	except ValueError:
		return ""


def _decimal(value):
	if isinstance(value, bool):
		return None
	try:
		number = Decimal(_text(value).replace(",", ""))
	except (InvalidOperation, ValueError):
		return None
	return number if number.is_finite() else None


def _display_number(value):
	return int(value) if value == value.to_integral_value() else float(value)


def _is_blank(value):
	return value is None or _text(value) == ""


def _text(value):
	return "" if value is None else str(value).strip()


def _name_key(value):
	return re.sub(r"\s+", "", _text(value)).casefold()


_DINGTALK_DEPARTMENT_IDENTIFIER_RE = re.compile(r"\s*[-－—–]\s*\d+\s*$")


def normalize_department_name(value):
	"""Remove DingTalk's trailing department identifier (for example `` - 11``)."""
	return _DINGTALK_DEPARTMENT_IDENTIFIER_RE.sub("", _text(value)).strip()


def _department_key(value):
	"""Treat a shared department name with 组/课/科 suffixes as one unit.

	DingTalk exports and the roster use both naming conventions (for example
	设备组 and 设备课) for the same operational department.  Only normalize the
	final organizational suffix; all other differences remain reviewable.
	"""
	key = re.sub(r"\s+", "", normalize_department_name(value)).casefold()
	return key[:-1] if len(key) > 1 and key[-1:] in {"组", "课", "科"} else key


def _add_code(codes, code):
	if code not in codes:
		codes.append(code)


__all__ = [
	"EXCEPTION_MESSAGES",
	"NUMERIC_FIELDS",
	"flatten_dingtalk_headers",
	"precheck_attendance_draft_structure",
	"process_attendance_draft_rows",
	"rows_from_dingtalk_daily_sheet",
]
