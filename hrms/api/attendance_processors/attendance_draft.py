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
	# DingTalk exports reunion leave in days.  Normalize it to hours at import so
	# the monthly-final calculation can treat it as a paid, attendance-preserving
	# leave without special cases in later payroll stages.
	"reunion_leave_hours": ("请假/团圆假(天)", "团圆假(天)"),
	"rest_arrangement_hours": ("排休(小时)",),
	"absence_hours": ("旷工(小时)",),
	# DingTalk's unitless marker becomes payroll absence hours only when the
	# source row is a scheduled workday and the employee has unworked hours.
	# Weekend/rest-day markers remain source evidence and never create a salary
	# absence on their own.
	"absence_marker_count": ("旷工", "旷工_2"),
	# Different DingTalk reports express the same fact either as a count or as
	# a per-day "缺卡" marker.  Both are source facts; neither is inferred from
	# a blank clock-time cell.
	"clock_in_missing_count": ("上班未打卡次数", "上班缺卡"),
	"clock_out_missing_count": ("下班未打卡次数", "下班缺卡"),
	"late_count": ("迟到次数",),
	"early_count": ("早退次数",),
}

IDENTITY_FIELDS = {
	"employee_code": ("工号", "员工工号", "employee_code"),
	"employee_name": ("姓名", "员工姓名", "employee_name"),
	"department": ("实际部门", "部门", "department"),
	"attendance_date": ("日期", "考勤日期", "attendance_date"),
	"shift": ("班次", "shift"),
	"approval": ("关联审批单", "审批单", "approval"),
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
	"CLOCK_IN_MISSING": "钉钉明确存在上班未打卡记录；人员照常进入终稿，红苹果由忘打卡来源核算。",
	"CLOCK_OUT_MISSING": "钉钉明确存在下班未打卡记录；人员照常进入终稿，红苹果由忘打卡来源核算。",
	"LATE_MARKED": "上班打卡晚于应上班时间且无请假证据；无迟到宽限，待人工核验后再处理。",
	"EARLY_MARKED": "钉钉明确标记早退；工作日无请假证据时按实际早退时长计旷工工时。",
	"ABSENCE_MARKED": "工作日无出勤且无可抵扣请假，已按未出勤工时计入旷工并进入薪资三倍扣款。",
	"RESTDAY_CLOCKED_WITHOUT_OVERTIME": "休息日存在打卡时间，但未匹配加班申请且休息日加班工时为 0；请人工确认是否补录休息日加班工时。",
	"SOURCE_FILE_MISSING": "来源文件定位为空。",
	"SOURCE_SHEET_MISSING": "来源工作表定位为空。",
	"SOURCE_ROW_MISSING": "来源行号为空。",
	"STRUCTURE_MISSING_REQUIRED_FIELD": "源表缺少必要字段。",
}

REQUIRED_FIELDS = ("employee_code", "employee_name", "attendance_date")
_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_DATE_RE = re.compile(r"^(?:(\d{4})|(?:\d{2}))(?:-|/)(\d{1,2})(?:-|/)(\d{1,2})")

# These switches are intentionally limited to reviewed, built-in detectors.
# Human-readable custom rules can enable or disable one of these detectors, but
# no user-entered formula is executed against attendance or payroll data.
DEFAULT_EXCEPTION_POLICY = {
	"missing_punch": True,
	"late": True,
	"early": True,
	"absence_marker": True,
	"restday_clock_without_overtime": True,
}

# These are attendance facts, rather than conditions that remove an employee
# from the monthly population.  Their monetary effect is calculated through
# the locked attendance final and the payroll rules.  Only identity, source
# structure, date, or other data-integrity failures keep a person out of the
# downstream final.
NON_BLOCKING_ATTENDANCE_EVENT_CODES = frozenset({
	"CLOCK_IN_MISSING",
	"CLOCK_OUT_MISSING",
	"LATE_MARKED",
	"EARLY_MARKED",
	"ABSENCE_MARKED",
})

# These fields are persisted for every daily source row.  Keeping the mapping
# here lets current and historic batches use the same date-level explanation,
# even when an older batch was created before ``exception_lines`` was stored.
ATTENDANCE_DETAIL_EXCEPTION_FIELDS = (
	("CLOCK_IN_MISSING", "clock_in_missing"),
	("CLOCK_OUT_MISSING", "clock_out_missing"),
	("LATE_MARKED", "late_count"),
	("EARLY_MARKED", "early_count"),
	("ABSENCE_MARKED", "absence_marker_count"),
	("RESTDAY_CLOCKED_WITHOUT_OVERTIME", "restday_clocked_without_overtime"),
)


def _is_positive_exception_marker(value: Any) -> bool:
	if value in (None, "", False):
		return False
	if value is True:
		return True
	try:
		return Decimal(str(value)) > 0
	except (InvalidOperation, TypeError, ValueError):
		return str(value).strip().lower() not in {"0", "否", "false", "no"}


def _is_scheduled_workday(standard_hours: Decimal) -> bool:
	"""A source row can affect absence pay only when it has scheduled hours."""
	return standard_hours > 0


def _has_leave_evidence(row: Mapping[str, Any], leave_hours: Decimal) -> bool:
	if leave_hours > 0:
		return True
	approval = _text(_value(row, IDENTITY_FIELDS["approval"]))
	return "假" in approval


def _is_rest_day(row: Mapping[str, Any]) -> bool:
	"""Use DingTalk's date type only; do not guess rest days from weekdays."""
	date_type = _text(_value(row, ("日期类型", "date_type")))
	if "节假日" in date_type:
		return False
	return any(token in date_type for token in ("休息日", "周末", "周休"))


def _has_clock_punch(row: Mapping[str, Any]) -> bool:
	return bool(
		_text(_value(row, ("上班时间", "上班打卡", "上班打卡时间", "clock_in")))
		or _text(_value(row, ("下班时间", "下班打卡", "下班打卡时间", "clock_out")))
	)


def _single_punch_missing_field(row: Mapping[str, Any]) -> str:
	"""Return the missing side when exactly one clock time is present.

	A source may omit the explicit DingTalk missing-card marker.  The business
	rule still requires a review item when the row itself proves there is exactly
	one punch.  A row with neither time remains outside this detector because it
	is a no-show/leave question, not a one-punch event.
	"""
	has_in = bool(_text(_value(row, ("上班时间", "上班打卡", "上班打卡时间", "clock_in"))))
	has_out = bool(_text(_value(row, ("下班时间", "下班打卡", "下班打卡时间", "clock_out"))))
	if has_in and not has_out:
		return "clock_out_missing"
	if has_out and not has_in:
		return "clock_in_missing"
	return ""


def _has_overtime_approval(row: Mapping[str, Any]) -> bool:
	approval = _text(_value(row, IDENTITY_FIELDS["approval"]))
	return "加班" in approval or "overtime" in approval.casefold()


def _clock_minutes(value: Any) -> int | None:
	"""Read the final HH:MM value from a DingTalk clock or shift label."""
	matches = re.findall(r"(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)", _text(value))
	if not matches:
		return None
	hour, minute = matches[-1]
	return int(hour) * 60 + int(minute)


def _shift_start_minutes(row: Mapping[str, Any]) -> int | None:
	"""Read the scheduled start, preferring the explicit source field.

	A shift label commonly contains both start and end times, whereas
	``_clock_minutes`` intentionally returns the final time for clock-out
	comparisons.  Lateness must use the first time in the shift label instead.
	"""
	scheduled_start = _text(_value(row, ("应上班时间", "应打卡时间", "scheduled_in_time")))
	if scheduled_start:
		return _clock_minutes(scheduled_start)
	shift = _text(_value(row, IDENTITY_FIELDS["shift"]))
	matches = re.findall(r"(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)", shift)
	if not matches:
		return None
	hour, minute = matches[0]
	return int(hour) * 60 + int(minute)


def _is_late_without_leave(row: Mapping[str, Any], *, standard_hours: Decimal, leave_hours: Decimal) -> bool:
	"""Identify any positive lateness on a scheduled workday without leave.

	There is deliberately no grace period: 08:01 against an 08:00 shift is a
	late-review event.  The result remains an attendance fact only; deductions
	are decided through the existing review and payroll workflow.
	"""
	if not _is_scheduled_workday(standard_hours) or _has_leave_evidence(row, leave_hours):
		return False
	expected_minutes = _shift_start_minutes(row)
	actual_minutes = _clock_minutes(_value(row, ("上班时间", "上班打卡", "上班打卡时间", "clock_in")))
	return expected_minutes is not None and actual_minutes is not None and actual_minutes > expected_minutes


def _early_departure_hours(row: Mapping[str, Any], *, standard_hours: Decimal, actual_hours: Decimal, leave_hours: Decimal, early_count: Decimal) -> Decimal:
	"""Return payroll-relevant early-leave time, capped by unworked hours.

	The rule applies only to scheduled workdays without leave evidence.  DingTalk
	uses ``次日`` for overnight shifts, so both the scheduled end and actual
	clock-out are normalised to the following day before comparing them.
	"""
	if early_count <= 0 or not _is_scheduled_workday(standard_hours) or _has_leave_evidence(row, leave_hours):
		return Decimal("0")
	shift = _text(_value(row, IDENTITY_FIELDS["shift"]))
	actual_out = _text(_value(row, ("下班时间", "下班打卡", "下班打卡时间", "clock_out")))
	expected_minutes = _clock_minutes(shift)
	actual_minutes = _clock_minutes(actual_out)
	if expected_minutes is None or actual_minutes is None:
		return Decimal("0")
	shift_times = re.findall(r"(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)", shift)
	if len(shift_times) >= 2:
		start_hour, start_minute = shift_times[0]
		start_minutes = int(start_hour) * 60 + int(start_minute)
		if "次日" in shift and expected_minutes <= start_minutes:
			expected_minutes += 24 * 60
			if "次日" in actual_out or actual_minutes <= start_minutes:
				actual_minutes += 24 * 60
	if actual_minutes >= expected_minutes:
		return Decimal("0")
	missing_hours = max(standard_hours - actual_hours - leave_hours, Decimal("0"))
	return min(Decimal(expected_minutes - actual_minutes) / Decimal("60"), missing_hours).quantize(Decimal("0.01"))


def exception_lines_from_attendance_details(attendance_details: Iterable[Mapping[str, Any]], exception_codes: Iterable[str]) -> list[dict[str, Any]]:
	"""Return only the daily rows that actually triggered an attendance alert.

	``attendance_details`` intentionally retains a whole month for audit and
	processing results.  It must never be used as the exception-date list: a
	person with one early leave would otherwise appear to have an issue on every
	day of the month.  This helper also repairs the display payload for historic
	batches that predate the persisted ``exception_lines`` field.
	"""
	active_codes = set(exception_codes or ())
	if not active_codes:
		return []
	lines = []
	for detail in attendance_details or ():
		if not isinstance(detail, Mapping):
			continue
		line_codes = [
			code
			for code, fieldname in ATTENDANCE_DETAIL_EXCEPTION_FIELDS
			if code in active_codes and _is_positive_exception_marker(detail.get(fieldname))
		]
		if line_codes:
			lines.append({**dict(detail), "exception_codes": line_codes})
	return lines


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
	seen: Counter[str] = Counter()
	for top, second in zip(top_row, second_row):
		parent, child = _text(top), _text(second)
		if parent == "请假" and child:
			header = f"请假/{child}"
		elif parent and child and parent != child:
			header = f"{parent}/{child}"
		else:
			header = parent or child
		if header:
			seen[header] += 1
			headers.append(header if seen[header] == 1 else f"{header}_{seen[header]}")
		else:
			headers.append("")
	return headers


def dingtalk_daily_header_location(sheet: Any, *, max_header_row: int = 12) -> dict[str, Any] | None:
	"""Locate a DingTalk daily-attendance table by its headers, not its sheet name.

	DingTalk exports vary by tenant and report type.  Some put the two-row table
	header at rows 1--2 (``每日明细``), while the ``每日统计`` export places a
	report title and generation time above the same table at rows 3--4.  A
	workbook is accepted only when the required identity fields can be mapped.
	"""
	rows = sheet.iter_rows(min_row=1, max_row=max_header_row, values_only=True)
	preview = list(rows)
	for index in range(len(preview) - 1):
		headers = flatten_dingtalk_headers(preview[index], preview[index + 1])
		structure = precheck_attendance_draft_structure(headers)
		if structure["is_valid"]:
			return {
				"header_row": index + 1,
				"data_start_row": index + 3,
				"headers": headers,
				"structure": structure,
			}
	return None


def find_dingtalk_daily_sheet(workbook: Any) -> Any | None:
	"""Return the most likely daily-attendance sheet using its table structure.

	The name is only a tie-breaker.  This keeps exports such as ``每日统计``
	compatible without allowing an unrelated worksheet to pass the check.
	"""
	candidates = []
	for position, sheet in enumerate(workbook.worksheets):
		location = dingtalk_daily_header_location(sheet)
		if not location:
			continue
		title = _text(sheet.title)
		name_priority = 2 if title in {"每日明细（钉钉导出）", "每日明细"} else 1 if "每日" in title else 0
		candidates.append((name_priority, -position, sheet))
	return max(candidates, default=(0, 0, None))[2]


def rows_from_dingtalk_daily_sheet(sheet: Any, *, source_file: str = "") -> list[dict[str, Any]]:
	"""Read an openpyxl worksheet without depending on Frappe."""
	location = dingtalk_daily_header_location(sheet)
	if not location:
		return []
	headers = location["headers"]
	rows = []
	for source_row, values_row in enumerate(sheet.iter_rows(min_row=location["data_start_row"], values_only=True), start=location["data_start_row"]):
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
	exception_policy: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
	"""Aggregate a DingTalk daily-detail export into one employee dataset."""
	if not _MONTH_RE.fullmatch(_text(attendance_month)):
		raise ValueError("attendance_month must use YYYY-MM")
	input_rows = [dict(row) for row in raw_rows]
	structure = precheck_attendance_draft_structure(_ordered_headers(input_rows))
	employee_index = _build_employee_index(employee_directory)
	policy = {**DEFAULT_EXCEPTION_POLICY, **{key: bool(value) for key, value in (exception_policy or {}).items() if key in DEFAULT_EXCEPTION_POLICY}}
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
	# Employee code is the import contract's primary key. DingTalk can also
	# export shared location/device accounts in the 姓名 column. Those entries
	# have a UserId but no employee code and must never become a fake employee
	# exception once per calendar day. Keep their count for audit, but exclude
	# them from employee aggregation and the employee exception queue.

	processed_rows = [
		_aggregate_employee_rows(
			rows,
			attendance_month=attendance_month,
			source_file=source_file,
			source_sheet=source_sheet,
			structure=structure,
			employee_index=employee_index,
			date_counts=date_counts,
			exception_policy=policy,
		)
		for _key, rows in sorted(groups.items(), key=lambda item: _group_sort_key(item[1]))
	]
	exception_rows = sum(1 for row in processed_rows if row["review_status"] == REVIEW_PENDING)
	exception_events = sum(len(row.get("exception_events") or []) for row in processed_rows)
	lifecycle_excluded_shift_rows = sum(len(row.get("data_quality_events") or []) for row in processed_rows)
	return {
		"status": "待处理异常" if exception_rows else "待确认",
		"structure_precheck": structure,
		"processed_rows": processed_rows,
		"data_quality": {
			"excluded_missing_employee_code_rows": len(missing_code_rows),
			"excluded_missing_employee_code_accounts": _source_account_summaries(missing_code_rows),
			"lifecycle_excluded_blank_shift_rows": lifecycle_excluded_shift_rows,
			"notice": "工号为空的来源行不作为员工考勤处理；已保留为来源数据质量统计。",
		},
		"metrics": {
			"source_rows": len(input_rows),
			"eligible_employee_source_rows": len(input_rows) - len(missing_code_rows),
			"excluded_missing_employee_code_rows": len(missing_code_rows),
			"excluded_missing_employee_code_accounts": len(_source_account_summaries(missing_code_rows)),
			"processed_rows": len(processed_rows),
			"exception_rows": exception_rows,
			"exception_events": exception_events,
			"eligible_rows": sum(1 for row in processed_rows if row["eligible_for_downstream"]),
		},
	}


def _aggregate_employee_rows(rows, *, attendance_month, source_file, source_sheet, structure, employee_index, date_counts, exception_policy=None):
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
	resolved_code, resolved_name, resolved_department, employee = _resolve_employee(raw_code, name, department, employee_index, codes)
	totals = {field: Decimal("0") for field in NUMERIC_FIELDS}
	source_rows = []
	attendance_details = []
	exception_events = []
	data_quality_events = []
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
		shift = _value(row, IDENTITY_FIELDS["shift"])
		if not shift:
			if _is_outside_employment_period(parsed_date, employee):
				data_quality_events.append(_data_quality_event("BLANK_SHIFT_OUTSIDE_EMPLOYMENT", parsed_date, row_number))
			else:
				# A blank class is retained as an import-quality note.  It is not
				# evidence of missing attendance or an instruction to recreate a
				# DingTalk schedule in HRMS.
				data_quality_events.append(_data_quality_event("BLANK_SHIFT_SOURCE", parsed_date, row_number))
		if not _text(row.get("source_file") or source_file):
			_add_code(codes, "SOURCE_FILE_MISSING")
		if not _text(row.get("source_sheet") or source_sheet):
			_add_code(codes, "SOURCE_SHEET_MISSING")
		if row_number is None:
			_add_code(codes, "SOURCE_ROW_MISSING")
		row_numbers = {fieldname: Decimal("0") for fieldname in NUMERIC_FIELDS}
		for fieldname, aliases in NUMERIC_FIELDS.items():
			value, exists = _field_value(row, aliases)
			if not exists or _is_blank(value):
				continue
			number = _source_marker_number(value) if fieldname in {
				"clock_in_missing_count", "clock_out_missing_count", "late_count", "early_count", "absence_marker_count",
			} else _decimal(value)
			if number is None:
				_add_code(codes, "INVALID_NUMERIC_VALUE")
				continue
			if fieldname == "reunion_leave_hours":
				number *= Decimal("8")
			row_numbers[fieldname] = number
		row_standard_hours = row_numbers["standard_hours"]
		row_actual_attendance_hours = row_numbers["actual_attendance_hours"]
		row_leave_hours = sum(
			(row_numbers[fieldname] for fieldname in ("personal_leave_hours", "sick_leave_hours", "annual_leave_hours", "work_injury_hours", "reunion_leave_hours", "rest_arrangement_hours")),
			Decimal("0"),
		)
		row_clock_in_missing = row_numbers["clock_in_missing_count"]
		row_clock_out_missing = row_numbers["clock_out_missing_count"]
		single_punch_missing_field = _single_punch_missing_field(row)
		if single_punch_missing_field == "clock_in_missing":
			row_clock_in_missing = max(row_clock_in_missing, Decimal("1"))
			row_numbers["clock_in_missing_count"] = row_clock_in_missing
		elif single_punch_missing_field == "clock_out_missing":
			row_clock_out_missing = max(row_clock_out_missing, Decimal("1"))
			row_numbers["clock_out_missing_count"] = row_clock_out_missing
		row_late_count = row_numbers["late_count"]
		row_early_count = row_numbers["early_count"]
		row_absence_marker_count = row_numbers["absence_marker_count"]
		row_absence_hours = row_numbers["absence_hours"]
		row_restday_clock_without_overtime = (
			_is_rest_day(row)
			and _has_clock_punch(row)
			and row_numbers["restday_overtime_hours"] <= 0
			and not _has_overtime_approval(row)
		)
		if _has_leave_evidence(row, row_leave_hours):
			# The alert rule is explicitly "late and no leave".  Preserve the raw
			# source row for audit, but do not turn either a source marker or a
			# time-only comparison into a late-review event when leave exists.
			row_late_count = Decimal("0")
			row_numbers["late_count"] = row_late_count
		elif row_late_count <= 0 and _is_late_without_leave(
			row,
			standard_hours=row_standard_hours,
			leave_hours=row_leave_hours,
		):
			row_late_count = Decimal("1")
			row_numbers["late_count"] = row_late_count
		row_unworked_hours = max(row_standard_hours - row_actual_attendance_hours - row_leave_hours, Decimal("0"))
		marker_absence_hours = (
			row_unworked_hours
			if row_absence_marker_count > 0 and _is_scheduled_workday(row_standard_hours) and not _has_leave_evidence(row, row_leave_hours)
			else Decimal("0")
		)
		early_absence_hours = _early_departure_hours(
			row,
			standard_hours=row_standard_hours,
			actual_hours=row_actual_attendance_hours,
			leave_hours=row_leave_hours,
			early_count=row_early_count,
		)
		if row_absence_hours <= 0:
			row_absence_hours = max(marker_absence_hours, early_absence_hours)
		row_numbers["absence_hours"] = row_absence_hours
		for fieldname, number in row_numbers.items():
			# Full-attendance late deductions apply to scheduled workdays.  Weekend
			# overtime rows still retain the raw mark in attendance_details below,
			# but do not become a monthly late count or a full-attendance deduction.
			if fieldname in {"late_count", "early_count"} and not _is_scheduled_workday(row_standard_hours):
				continue
			totals[fieldname] += number
		if exception_policy.get("missing_punch", True):
			if row_clock_in_missing > 0:
				_add_code(codes, "CLOCK_IN_MISSING")
				exception_events.append(_exception_event("CLOCK_IN_MISSING", parsed_date, row_number, row_clock_in_missing))
			if row_clock_out_missing > 0:
				_add_code(codes, "CLOCK_OUT_MISSING")
				exception_events.append(_exception_event("CLOCK_OUT_MISSING", parsed_date, row_number, row_clock_out_missing))
		if exception_policy.get("late", True) and row_late_count > 0:
			_add_code(codes, "LATE_MARKED")
			exception_events.append(_exception_event("LATE_MARKED", parsed_date, row_number, row_late_count))
		if exception_policy.get("early", True) and row_early_count > 0:
			_add_code(codes, "EARLY_MARKED")
			exception_events.append(_exception_event("EARLY_MARKED", parsed_date, row_number, row_early_count))
		if exception_policy.get("absence_marker", True) and marker_absence_hours > 0:
			_add_code(codes, "ABSENCE_MARKED")
			exception_events.append(_exception_event("ABSENCE_MARKED", parsed_date, row_number, marker_absence_hours))
		if exception_policy.get("restday_clock_without_overtime", True) and row_restday_clock_without_overtime:
			_add_code(codes, "RESTDAY_CLOCKED_WITHOUT_OVERTIME")
			exception_events.append(_exception_event("RESTDAY_CLOCKED_WITHOUT_OVERTIME", parsed_date, row_number))
		source_rows.append({
			"source_file": _text(row.get("source_file") or source_file),
			"source_sheet": _text(row.get("source_sheet") or source_sheet),
			"source_row": row_number,
			"attendance_date": _text(date_value),
		})
		attendance_detail = {
			"attendance_date": parsed_date or _text(date_value),
			"shift": _value(row, IDENTITY_FIELDS["shift"]),
			"clock_in": _text(_value(row, ("上班时间", "上班打卡", "上班打卡时间", "clock_in"))),
			"clock_out": _text(_value(row, ("下班时间", "下班打卡", "下班打卡时间", "clock_out"))),
			"clock_in_missing": _display_number(row_clock_in_missing),
			"clock_out_missing": _display_number(row_clock_out_missing),
			"late_count": _display_number(row_late_count),
			"early_count": _display_number(row_early_count),
			"absence_marker_count": _display_number(row_absence_marker_count),
			"absence_hours": _display_number(row_absence_hours),
			"source_row": row_number,
		}
		if row_restday_clock_without_overtime:
			attendance_detail.update({
				"date_type": _text(_value(row, ("日期类型", "date_type"))),
				"restday_overtime_hours": _display_number(row_numbers["restday_overtime_hours"]),
				"overtime_approval": _text(_value(row, IDENTITY_FIELDS["approval"])),
				"restday_clocked_without_overtime": True,
			})
		attendance_details.append(attendance_detail)
	# The review screen remains employee-centred, but a reviewer needs to see
	# precisely which original daily rows caused the review.  These lines are a
	# display/audit projection only; all their values come directly from DingTalk.
	exception_lines = exception_lines_from_attendance_details(attendance_details, codes)
	proposed = {
		"employee_code": resolved_code or raw_code,
		"employee_name": resolved_name or name,
		"department": resolved_department or department,
		**{field: _display_number(value) for field, value in totals.items()},
		"night_shift_matching": {
			"mode": "source_only",
			"matched_large_night_shifts": 0,
		},
		"attendance_details": attendance_details,
		"exception_lines": exception_lines,
		"exception_events": exception_events,
		"data_quality_events": data_quality_events,
		"source_row_count": len(rows),
	}
	blocking_codes = set(codes) - NON_BLOCKING_ATTENDANCE_EVENT_CODES
	review_status = REVIEW_PENDING if blocking_codes else REVIEW_NOT_REQUIRED
	return {
		"source_type": "attendance_draft",
		"employee_code": proposed["employee_code"],
		"employee_name": proposed["employee_name"],
		"department": proposed["department"],
		"processed_value": deepcopy(proposed),
		"proposed_value": proposed,
		"confirmed_value": None,
		"original_value": {"rows": deepcopy(rows), "source_rows": source_rows},
		"exception_events": exception_events,
		"data_quality_events": data_quality_events,
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
		employee = {
			"employee_code": code,
			"employee_name": name,
			"department": department,
			"date_of_joining": raw.get("date_of_joining"),
			"relieving_date": raw.get("relieving_date"),
		}
		by_code[code] = employee
		if name:
			by_name[_name_key(name)].append(employee)
	return by_code, by_name


def _resolve_employee(code, name, department, employee_index, codes):
	if employee_index is None:
		return code, name, department, None
	by_code, by_name = employee_index
	if code:
		employee = by_code.get(code)
		if not employee:
			_add_code(codes, "EMPLOYEE_NOT_FOUND")
			return code, name, department, None
		if name and employee["employee_name"] and _name_key(name) != _name_key(employee["employee_name"]):
			_add_code(codes, "EMPLOYEE_NAME_MISMATCH")
		if department and employee["department"] and _department_key(department) != _department_key(employee["department"]):
			_add_code(codes, "EMPLOYEE_DEPARTMENT_MISMATCH")
		return employee["employee_code"], employee["employee_name"] or name, employee["department"] or department, employee
	if name:
		matches = by_name.get(_name_key(name), [])
		if len(matches) == 1:
			return matches[0]["employee_code"], matches[0]["employee_name"], matches[0]["department"] or department, matches[0]
		_add_code(codes, "EMPLOYEE_NAME_AMBIGUOUS" if len(matches) > 1 else "EMPLOYEE_NOT_FOUND")
	return code, name, department, None


def _date_only(value: Any) -> date | None:
	if isinstance(value, datetime):
		return value.date()
	if isinstance(value, date):
		return value
	text = _text(value)
	if not text:
		return None
	try:
		return date.fromisoformat(text[:10])
	except ValueError:
		return None


def _is_outside_employment_period(attendance_date: str, employee: Mapping[str, Any] | None) -> bool:
	"""Suppress blank-shift reviews only when the roster proves the date is out of scope."""
	day = _date_only(attendance_date)
	if not day or not employee:
		return False
	joined_on = _date_only(employee.get("date_of_joining"))
	relieved_on = _date_only(employee.get("relieving_date"))
	return bool((joined_on and day < joined_on) or (relieved_on and day > relieved_on))


def _exception_event(code: str, attendance_date: str, source_row: int | None, count: Decimal | None = None) -> dict[str, Any]:
	event = {"code": code, "attendance_date": attendance_date or "", "source_row": source_row}
	if count is not None:
		event["count"] = _display_number(count)
	return event


def _data_quality_event(code: str, attendance_date: str, source_row: int | None) -> dict[str, Any]:
	return {"code": code, "attendance_date": attendance_date or "", "source_row": source_row}


def _ordered_headers(rows):
	seen, headers = set(), []
	for row in rows:
		for key in row:
			if key not in seen:
				seen.add(key)
				headers.append(key)
	return headers


def _source_account_summaries(rows):
	"""Summarise source-only accounts without promoting them to employees."""
	accounts: dict[tuple[str, str, str], dict[str, Any]] = {}
	for row in rows:
		name = _value(row, IDENTITY_FIELDS["employee_name"])
		user_id = _value(row, ("UserId", "user_id", "dingtalk_user_id"))
		department = _value(row, IDENTITY_FIELDS["department"])
		key = (user_id, name, department)
		account = accounts.setdefault(
			key,
			{
				"source_account_name": name or "未命名来源账号",
				"source_user_id": user_id,
				"source_department": department,
				"row_count": 0,
				"source_rows": [],
			},
		)
		account["row_count"] += 1
		if len(account["source_rows"]) < 3:
			account["source_rows"].append(_source_row(row))
	return sorted(accounts.values(), key=lambda item: (item["source_account_name"], item["source_user_id"]))


def _group_sort_key(rows):
	row = rows[0]
	return (_value(row, IDENTITY_FIELDS["department"]), _value(row, IDENTITY_FIELDS["employee_code"]), _value(row, IDENTITY_FIELDS["employee_name"]))


def _field_value(row, aliases):
	first_present = None
	for alias in aliases:
		if alias in row:
			if first_present is None:
				first_present = row[alias]
			if not _is_blank(row[alias]):
				return row[alias], True
	return first_present, first_present is not None


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


def _source_marker_number(value):
	"""Read DingTalk's count columns without treating a blank time as a marker."""
	number = _decimal(value)
	if number is not None:
		return number
	text = _text(value).strip().lower()
	if text in {"是", "yes", "true", "y", "√", "缺卡"}:
		return Decimal("1")
	if text in {"否", "no", "false", "n", "×", "-"}:
		return Decimal("0")
	return None


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
	"dingtalk_daily_header_location",
	"find_dingtalk_daily_sheet",
	"flatten_dingtalk_headers",
	"precheck_attendance_draft_structure",
	"process_attendance_draft_rows",
	"rows_from_dingtalk_daily_sheet",
]
