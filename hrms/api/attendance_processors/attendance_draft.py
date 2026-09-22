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
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any



REVIEW_NOT_REQUIRED = "无需审核"
REVIEW_PENDING = "待审核"
REVIEW_APPROVED = "已通过"
REVIEW_REJECTED = "已驳回"

NUMERIC_FIELDS = {
	"standard_hours": ("标准工时", "标准工时（小时）"),
	"actual_attendance_hours": ("实际出勤（小时）", "实际出勤(小时)", "实际出勤"),
	"workday_overtime_hours": ("工作日加班（小时）", "工作日加班(小时)", "工作日加班"),
	"restday_overtime_hours": ("休息日加班（小时）",),
	"holiday_overtime_hours": ("节假日加班（小时）",),
	"deep_night_shifts": ("深夜班",),
	"large_night_shifts": ("大夜班",),
	"small_night_shifts": ("小夜班",),
	"personal_leave_hours": ("请假/事假(小时)", "事假(小时)"),
	"sick_leave_hours": ("请假/病假(小时)", "病假(小时)"),
	"annual_leave_hours": ("请假/特休(小时)", "特休(小时)"),
	"work_injury_hours": ("请假/工伤(小时)", "工伤(小时)"),
	# DingTalk exports reunion leave in days.  Normalize it to hours at import so
	# the monthly-final calculation can treat it as a paid, attendance-preserving
	# leave without special cases in later payroll stages.
	"reunion_leave_hours": ("请假/团圆假(小时)", "团圆假(小时)", "请假/团圆假(天)", "团圆假(天)"),
	"rest_arrangement_hours": ("请假/排休(小时)", "排休(小时)"),
	"bereavement_leave_hours": ("请假/丧假(小时)", "丧假(小时)", "请假/丧假(天)", "丧假(天)"),
	"marriage_leave_hours": ("请假/婚假(小时)", "婚假(小时)", "请假/婚假(天)", "婚假(天)"),
	"public_leave_hours": ("请假/公假(小时)", "公假(小时)", "请假/公假(天)", "公假(天)"),
	"maternity_leave_hours": ("请假/产假(小时)", "产假(小时)", "请假/产假(天)", "产假(天)"),
	"absence_hours": ("请假/旷工(小时)", "旷工(小时)"),
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
	"approval": ("关联审批单", "关联的审批单", "审批单", "approval"),
}

ATTENDANCE_POLICY_VERSION = 12
OUTSIDE_SHIFT_EXCEPTION_TOLERANCE_MINUTES = 30

# 永新班别排配表 V3.0 的固定加班规则。每条规则分别保存：班次关键词、平日
# 自动生成时数、应打卡至的平日加班结束时间，以及周末是否免加班单。规则顺序
# 从具体到通用，避免 CCD 白班被“生产白班”等较宽泛规则覆盖。
#
# 中班是特殊边界：平日自动生成 2.5 小时，但周末栏明确写“加班单”。
# 间接人员、药水分析组和生管仓库没有列在这里，因为平日/周末均须加班单。
SCHEDULE_OVERTIME_RULES = (
	{"name": "CCD人员夜班", "tokens": ("CCD人员", "夜班"), "workday_hours": Decimal("3.5"), "workday_end_minutes": 8 * 60, "restday_auto": True},
	{"name": "CCD人员白班", "tokens": ("CCD人员",), "workday_hours": Decimal("2.5"), "workday_end_minutes": 20 * 60, "restday_auto": True},
	{"name": "品保10点生产白班", "tokens": ("品保10点生产",), "workday_hours": Decimal("3"), "workday_end_minutes": 22 * 60, "restday_auto": True},
	{"name": "生产夜班", "tokens": ("生产", "夜班"), "workday_hours": Decimal("3.5"), "workday_end_minutes": 8 * 60, "restday_auto": True},
	{"name": "生产白班", "tokens": ("生产", "白班"), "workday_hours": Decimal("3"), "workday_end_minutes": 20 * 60, "restday_auto": True},
	{"name": "警卫夜班", "tokens": ("警卫", "夜班"), "workday_hours": Decimal("3.5"), "workday_end_minutes": 7 * 60 + 30, "restday_auto": True},
	{"name": "警卫白班", "tokens": ("警卫", "白班"), "workday_hours": Decimal("2.5"), "workday_end_minutes": 19 * 60 + 30, "restday_auto": True},
	{"name": "烧饭阿姨夜班", "tokens": ("烧饭阿姨", "夜班"), "workday_hours": Decimal("3"), "workday_end_minutes": 0, "restday_auto": True},
	{"name": "烧饭阿姨白班", "tokens": ("烧饭阿姨",), "workday_hours": Decimal("2.5"), "workday_end_minutes": 18 * 60, "restday_auto": True},
	{"name": "清洁阿姨", "tokens": ("清洁阿姨",), "workday_hours": Decimal("2.5"), "workday_end_minutes": 17 * 60, "restday_auto": True},
	{"name": "IQC白班", "tokens": ("IQC",), "workday_hours": Decimal("3"), "workday_end_minutes": 19 * 60, "restday_auto": True},
	{"name": "中班", "tokens": ("中班",), "workday_hours": Decimal("2.5"), "workday_end_minutes": 60, "restday_auto": False},
)
LEAVE_FIELDS = tuple(field for field in NUMERIC_FIELDS if field.endswith("leave_hours")) + ("work_injury_hours", "rest_arrangement_hours")
LEAVE_LABELS = dict(zip(
	("personal_leave_hours", "sick_leave_hours", "annual_leave_hours", "work_injury_hours", "reunion_leave_hours", "rest_arrangement_hours", "bereavement_leave_hours", "marriage_leave_hours", "public_leave_hours", "maternity_leave_hours"),
	("事假", "病假", "特休", "工伤", "团圆假", "排休", "丧假", "婚假", "公假", "产假"),
))


def is_calendar_weekend(attendance_date: Any) -> bool:
	try:
		return date.fromisoformat(str(attendance_date)[:10]).weekday() >= 5
	except (TypeError, ValueError):
		return False


def daily_hours_balance(numbers: Mapping[str, Any]) -> dict[str, Any]:
	"""Exact user-defined reconciliation, using exported actual attendance as-is."""
	def hours(field):
		return _decimal(numbers.get(field, 0)) or Decimal("0")
	accounted = (
		hours("actual_attendance_hours") + hours("personal_leave_hours")
		+ hours("sick_leave_hours") / 2 + hours("reunion_leave_hours")
		+ hours("rest_arrangement_hours") + hours("absence_hours")
	)
	difference = accounted - hours("standard_hours")
	return {"accounted_hours": accounted, "hours_difference": difference, "hours_mismatch": difference != 0}


def daily_hours_policy(numbers: Mapping[str, Any], attendance_date: Any) -> dict[str, Any]:
	"""Apply weekend exclusions and full-day leave exemption before reconciliation."""
	values = {key: _decimal(value) or Decimal("0") for key, value in numbers.items()}
	weekend = is_calendar_weekend(attendance_date)
	excluded = {}
	if weekend:
		for field in ("sick_leave_hours", "rest_arrangement_hours"):
			excluded[field] = values.get(field, Decimal("0"))
			values[field] = Decimal("0")
		values["late_count"] = values["early_count"] = Decimal("0")
	leave = sum((values.get(field, Decimal("0")) for field in LEAVE_FIELDS), Decimal("0"))
	standard = values.get("standard_hours", Decimal("0"))
	full_day_leave = standard > 0 and leave >= standard
	if full_day_leave:
		values["clock_in_missing_count"] = values["clock_out_missing_count"] = Decimal("0")
	return {
		"numbers": values, "is_weekend": weekend, "leave_hours": leave,
		"excluded_leave_hours": excluded, **daily_hours_balance(values),
		"full_day_leave": full_day_leave,
	}

# 深夜班是排班口径，不以实际打卡早到、迟到或跨夜来反推。只有生产夜班
# 明确排为 20:00 至次日 08:00 的每日记录才计一次，避免把其他跨夜班次
# 或白天的加长工时误发为深夜班。
_PRODUCTION_DEEP_NIGHT_SHIFT = "生产夜班"
_PRODUCTION_DEEP_NIGHT_START_MINUTES = 20 * 60
_PRODUCTION_DEEP_NIGHT_END_MINUTES = 8 * 60
_SHIFT_CLOCK_RE = re.compile(r"(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)")
_PUNCH_RANGE_CLOCK_RE = re.compile(r"(?<!\d)([01]?\d|2[0-4])[:：]([0-5]\d)(?!\d)")
_LEAVE_APPROVAL_RE = re.compile(
	r"(?P<leave_type>事假|病假|特休|年假|工伤|团圆假|排休|丧假|婚假|公假|产假)"
	r"\s*(?P<start_date>(?:\d{4}-)?\d{1,2}-\d{1,2})\s*(?P<start_time>\d{1,2}[:：]\d{2})"
	r"\s*到\s*(?P<end_date>(?:\d{4}-)?\d{1,2}-\d{1,2})\s*(?P<end_time>\d{1,2}[:：]\d{2})"
	r"\s*(?P<hours>\d+(?:\.\d+)?)\s*小时"
)

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
	"ATTENDANCE_HOURS_MISMATCH": "实际出勤＋事假＋病假÷2＋团圆假＋排休＋旷工不等于标准工时；请按本日明细核对差额。",
	"CLOCK_IN_MISSING": "钉钉明确存在上班未打卡记录；人员照常进入终稿，红苹果由忘打卡来源核算。",
	"CLOCK_OUT_MISSING": "钉钉明确存在下班未打卡记录；人员照常进入终稿，红苹果由忘打卡来源核算。",
	"CLOCK_IN_OUTSIDE_PICK_RANGE": "上班打卡不在该班次允许的可取卡时段内，请人工核对班次或打卡。",
	"CLOCK_OUT_OUTSIDE_PICK_RANGE": "下班打卡不在该班次允许的可取卡时段内，请人工核对班次或打卡。",
	"LATE_MARKED": "上班打卡晚于计划上班时间；30分钟以内只标记迟到，超过30分钟时整段迟到时长计入事假，原始打卡和迟到次数仍保留审计。",
	"EARLY_MARKED": "钉钉明确标记早退；工作日无请假证据时按实际早退时长计旷工工时。",
	"ABSENCE_MARKED": "工作日无出勤且无可抵扣请假，已按未出勤工时计入旷工并进入薪资三倍扣款。",
	"RESTDAY_CLOCKED_WITHOUT_OVERTIME": "休息日存在打卡时间，但未匹配加班申请且休息日加班工时为 0；请人工确认是否补录休息日加班工时。",
	"WORKDAY_OUTSIDE_SHIFT_UNAPPROVED": "工作日打卡超出钉钉自动识别时段，或所属班次要求提交加班申请，但无有效审批单；原始时长仅供展示审计，未自动计入后续。",
	"SHIFT_SCHEDULE_REVIEW_REQUIRED": "有打卡或迟到标记，但无法取得完整班次计划起止；已标为待复核，未凭空推算。",
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
	"CLOCK_IN_OUTSIDE_PICK_RANGE",
	"CLOCK_OUT_OUTSIDE_PICK_RANGE",
	"LATE_MARKED",
	"EARLY_MARKED",
	"ABSENCE_MARKED",
	"WORKDAY_OUTSIDE_SHIFT_UNAPPROVED",
})

# These fields are persisted for every daily source row.  Keeping the mapping
# here lets current and historic batches use the same date-level explanation,
# even when an older batch was created before ``exception_lines`` was stored.
ATTENDANCE_DETAIL_EXCEPTION_FIELDS = (
	("CLOCK_IN_MISSING", "clock_in_missing"),
	("CLOCK_OUT_MISSING", "clock_out_missing"),
	("CLOCK_IN_OUTSIDE_PICK_RANGE", "clock_in_outside_pick_range"),
	("CLOCK_OUT_OUTSIDE_PICK_RANGE", "clock_out_outside_pick_range"),
	("LATE_MARKED", "late_count"),
	("EARLY_MARKED", "early_count"),
	("ABSENCE_MARKED", "absence_marker_count"),
	("RESTDAY_CLOCKED_WITHOUT_OVERTIME", "restday_clocked_without_overtime"),
	("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", "workday_outside_shift_unapproved"),
	("SHIFT_SCHEDULE_REVIEW_REQUIRED", "shift_schedule_review_required"),
	("ATTENDANCE_HOURS_MISMATCH", "hours_mismatch"),
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


def _approval_datetime(date_text: str, time_text: str, attendance_date: str) -> datetime | None:
	"""Parse DingTalk's approval timestamps, whose year is commonly omitted."""
	try:
		attendance_day = date.fromisoformat(attendance_date)
		parts = [int(part) for part in date_text.split("-")]
		if len(parts) == 3:
			year, month, day = parts
		else:
			month, day = parts
			year = attendance_day.year
			if attendance_day.month == 1 and month == 12:
				year -= 1
			elif attendance_day.month == 12 and month == 1:
				year += 1
		hour, minute = (int(part) for part in time_text.replace("：", ":").split(":"))
		return datetime(year, month, day, hour, minute)
	except (TypeError, ValueError):
		return None


def _morning_leave_approval_hours(
	row: Mapping[str, Any], attendance_date: str, scheduled_start: int, actual_in: int | None,
) -> Decimal:
	"""Return approved leave hours that move this day's expected clock-in.

	DingTalk serialises several approvals into one ``关联审批单`` cell, for example
	``事假07-29 08:00到07-29 08:30 0.5小时，加班...``.  Only a leave
	segment that covers the scheduled start may alter the lateness boundary;
	afternoon leave and overtime/card approvals must not excuse a morning punch.
	"""
	approval = _text(_value(row, IDENTITY_FIELDS["approval"]))
	if not approval or any(token in approval for token in ("未通过", "已驳回", "已拒绝", "已撤销", "已作废", "审批中")):
		return Decimal("0")
	try:
		attendance_day = date.fromisoformat(attendance_date)
	except (TypeError, ValueError):
		return Decimal("0")
	scheduled = datetime.combine(attendance_day, datetime.min.time()).replace(
		hour=(scheduled_start // 60) % 24, minute=scheduled_start % 60,
	)
	actual = datetime.combine(attendance_day, datetime.min.time()) + timedelta(minutes=actual_in) if actual_in is not None else None
	segments = []
	for match in _LEAVE_APPROVAL_RE.finditer(approval):
		start = _approval_datetime(match.group("start_date"), match.group("start_time"), attendance_date)
		end = _approval_datetime(match.group("end_date"), match.group("end_time"), attendance_date)
		if not start or not end:
			continue
		if end < start:
			continue
		segments.append((start, end, Decimal(match.group("hours"))))
	segments.sort(key=lambda item: item[0])
	if not any(start <= scheduled < end for start, end, _hours in segments):
		return Decimal("0")
	return sum(
		(hours for start, end, hours in segments if end > scheduled and (actual is None or start <= actual)),
		Decimal("0"),
	)


def _late_minutes_after_approval(
	raw_late_minutes: int,
	approved_leave_hours: Decimal,
	standard_hours: Decimal,
	actual_attendance_hours: Decimal,
) -> int:
	"""Keep only the late duration not already covered by a morning approval."""
	if raw_late_minutes <= 0 or approved_leave_hours <= 0:
		return raw_late_minutes
	if standard_hours > 0 and actual_attendance_hours > 0:
		unworked_minutes = max(standard_hours - actual_attendance_hours, Decimal("0")) * Decimal("60")
		uncovered = max(unworked_minutes - approved_leave_hours * Decimal("60"), Decimal("0"))
		return min(raw_late_minutes, int(uncovered.quantize(Decimal("1"))))
	return max(raw_late_minutes - int(approved_leave_hours * Decimal("60")), 0)


def _is_rest_day(row: Mapping[str, Any]) -> bool:
	"""Use DingTalk's date type only; do not guess rest days from weekdays."""
	date_type = _text(_value(row, ("日期类型", "工作类型", "date_type", "work_type")))
	if "节假日" in date_type:
		return False
	return any(token in date_type for token in ("休息日", "周末", "周休"))


def _is_scheduled_attendance_workday(row: Mapping[str, Any], standard_hours: Decimal, attendance_date: Any) -> bool:
	"""Recognise adjusted workdays without turning ordinary weekends into late days."""
	if not _is_scheduled_workday(standard_hours):
		return False
	date_type = _text(_value(row, ("日期类型", "工作类型", "date_type", "work_type")))
	if any(token in date_type for token in ("休息日", "周末", "周休")):
		return False
	if any(token in date_type for token in ("工作日", "调班", "补班")):
		return True
	return not is_calendar_weekend(attendance_date)


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
	if any(token in approval for token in ("未通过", "已驳回", "已拒绝", "已撤销", "已作废", "审批中")):
		return False
	return "加班" in approval or "overtime" in approval.casefold()


def _schedule_overtime_rule(row: Mapping[str, Any], shift_rules: Sequence[Mapping[str, Any]] | None = None) -> Mapping[str, Any] | None:
	"""Return the configured schedule row matched by the assigned shift."""
	shift = re.sub(r"\s+", "", _text(_value(row, IDENTITY_FIELDS["shift"]))).casefold()
	for raw_rule in shift_rules if shift_rules is not None else SCHEDULE_OVERTIME_RULES:
		rule = dict(raw_rule)
		effective_from = _parse_date(rule.get("effective_from"), "")
		attendance_date = _parse_date(_value(row, IDENTITY_FIELDS["attendance_date"]), "")
		if effective_from and attendance_date and attendance_date < effective_from:
			continue
		if rule.get("tokens") and all(token.casefold() in shift for token in rule["tokens"]):
			rule["workday_hours"] = _decimal(rule.get("workday_hours")) or Decimal("0")
			rule["workday_auto"] = bool(rule.get("workday_auto", True))
			return rule
	return None


def _schedule_overtime_mode(row: Mapping[str, Any], shift_rules: Sequence[Mapping[str, Any]] | None = None) -> str:
	"""Return the weekday overtime-source mode declared by the assigned shift."""
	rule = _schedule_overtime_rule(row, shift_rules)
	return "schedule_auto" if rule and rule.get("workday_auto") else "overtime_application"


def _schedule_restday_overtime_mode(row: Mapping[str, Any], shift_rules: Sequence[Mapping[str, Any]] | None = None) -> str:
	"""Return the weekend overtime-source mode from the schedule's weekend column."""
	rule = _schedule_overtime_rule(row, shift_rules)
	return "schedule_auto" if rule and rule["restday_auto"] else "overtime_application"


def _schedule_auto_overtime_hours(row: Mapping[str, Any], shift_rules: Sequence[Mapping[str, Any]] | None = None) -> Decimal | None:
	rule = _schedule_overtime_rule(row, shift_rules)
	return rule["workday_hours"] if rule and rule.get("workday_auto") else None


def _schedule_auto_overtime_reached(row: Mapping[str, Any], raw_hours: Decimal, shift_rules: Sequence[Mapping[str, Any]] | None = None) -> bool:
	"""Whether source hours or the actual clock-out reaches the fixed schedule row."""
	rule = _schedule_overtime_rule(row, shift_rules)
	if not rule or not rule.get("workday_auto") or rule["workday_hours"] <= 0:
		return False
	bounds = _shift_bounds_minutes(row, rule)
	if not bounds:
		return False
	start, _end = bounds
	_actual_in, actual_out = _actual_bounds_minutes(row, start, rule)
	# When a pick range is configured, a source-exported overtime number cannot
	# rescue an out-of-range or absent clock-out. Only a reviewed manual value or
	# an approved application may override that attendance evidence later.
	if _punch_range_bounds(rule.get("punch_out_range")) and actual_out is None:
		return False
	if raw_hours >= rule["workday_hours"]:
		return True
	if actual_out is None:
		return False
	if rule.get("workday_end_minutes") is None:
		return False
	target = int(rule["workday_end_minutes"])
	if target <= start:
		target += 24 * 60
	return actual_out >= target


def _schedule_auto_overtime_excess_minutes(row: Mapping[str, Any], shift_rules: Sequence[Mapping[str, Any]] | None = None) -> int:
	"""Return minutes after the fixed overtime end; a pre-shift punch is irrelevant."""
	rule = _schedule_overtime_rule(row, shift_rules)
	if not rule or not rule.get("workday_auto") or rule.get("workday_end_minutes") is None:
		return 0
	bounds = _shift_bounds_minutes(row, rule)
	if not bounds:
		return 0
	start, _end = bounds
	_actual_in, actual_out = _actual_bounds_minutes(row, start, rule)
	if actual_out is None:
		return 0
	target = int(rule["workday_end_minutes"])
	if target <= start:
		target += 24 * 60
	return max(actual_out - target, 0)


def _clock_minutes(value: Any) -> int | None:
	"""Read the final HH:MM value from a DingTalk clock or shift label."""
	matches = _SHIFT_CLOCK_RE.findall(_text(value))
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
	matches = _SHIFT_CLOCK_RE.findall(shift)
	if not matches:
		return None
	hour, minute = matches[0]
	return int(hour) * 60 + int(minute)


def _shift_bounds_minutes(row: Mapping[str, Any], shift_rule: Mapping[str, Any] | None = None) -> tuple[int, int] | None:
	"""Return a complete scheduled interval, preserving overnight shifts."""
	start_text = _text(_value(row, ("应上班时间", "应打卡时间", "scheduled_in_time")))
	end_text = _text(_value(row, ("应下班时间", "scheduled_out_time")))
	if start_text and end_text:
		start, end = _clock_minutes(start_text), _clock_minutes(end_text)
	else:
		shift = _text(_value(row, IDENTITY_FIELDS["shift"]))
		clocks = _SHIFT_CLOCK_RE.findall(shift)
		if len(clocks) < 2 and shift_rule:
			shift = _text(shift_rule.get("basic_time"))
			clocks = _SHIFT_CLOCK_RE.findall(shift)
		if len(clocks) < 2:
			return None
		start = int(clocks[0][0]) * 60 + int(clocks[0][1])
		end = int(clocks[1][0]) * 60 + int(clocks[1][1])
		end_text = shift
	if start is None or end is None:
		return None
	if "次日" in end_text or end <= start:
		end += 24 * 60
	return start, end


def _punch_range_bounds(value: Any) -> tuple[int, int] | None:
	"""Parse a configured inclusive range, accepting 24:00 and next-day text."""
	matches = _PUNCH_RANGE_CLOCK_RE.findall(_text(value))
	if len(matches) < 2:
		return None
	start = int(matches[0][0]) * 60 + int(matches[0][1])
	end = int(matches[1][0]) * 60 + int(matches[1][1])
	if start > 24 * 60 or end > 24 * 60:
		return None
	if "次日" in _text(value) or end <= start:
		end += 24 * 60
	return start, end


def _punch_in_configured_range(actual_minutes: int | None, configured_range: Any) -> bool | None:
	"""Return None when no range is configured, otherwise an inclusive match."""
	bounds = _punch_range_bounds(configured_range)
	if actual_minutes is None or not bounds:
		return None
	start, end = bounds
	candidate = actual_minutes
	if end > 24 * 60 and candidate < start:
		candidate += 24 * 60
	return start <= candidate <= end


def _actual_bounds_minutes(
	row: Mapping[str, Any], scheduled_start: int, shift_rule: Mapping[str, Any] | None = None,
) -> tuple[int | None, int | None]:
	in_text = _text(_value(row, ("上班时间", "上班打卡", "上班打卡时间", "clock_in")))
	out_text = _text(_value(row, ("下班时间", "下班打卡", "下班打卡时间", "clock_out")))
	actual_in, actual_out = _clock_minutes(in_text), _clock_minutes(out_text)
	if actual_in is not None and scheduled_start >= 12 * 60 and actual_in < 12 * 60:
		actual_in += 24 * 60
	if actual_out is not None and ("次日" in out_text or actual_out <= scheduled_start):
		actual_out += 24 * 60
	if shift_rule:
		if _punch_in_configured_range(actual_in, shift_rule.get("punch_in_range")) is False:
			actual_in = None
		if _punch_in_configured_range(actual_out, shift_rule.get("punch_out_range")) is False:
			actual_out = None
	return actual_in, actual_out


def _shift_time_facts(row: Mapping[str, Any], shift_rule: Mapping[str, Any] | None = None) -> dict[str, Any]:
	"""Calculate auditable late and outside-shift durations without guessing."""
	bounds = _shift_bounds_minutes(row, shift_rule)
	if not bounds:
		return {"schedule_available": False}
	start, end = bounds
	raw_actual_in, raw_actual_out = _actual_bounds_minutes(row, start)
	actual_in, actual_out = _actual_bounds_minutes(row, start, shift_rule)
	punch_in_range_valid = _punch_in_configured_range(raw_actual_in, (shift_rule or {}).get("punch_in_range"))
	punch_out_range_valid = _punch_in_configured_range(raw_actual_out, (shift_rule or {}).get("punch_out_range"))
	early_minutes = max(start - actual_in, 0) if actual_in is not None else 0
	late_out_minutes = max(actual_out - end, 0) if actual_out is not None else 0
	late_minutes = max(actual_in - start, 0) if actual_in is not None else 0
	return {
		"schedule_available": True,
		"scheduled_start_minutes": start,
		"scheduled_end_minutes": end,
		"actual_in_minutes": actual_in,
		"late_minutes": late_minutes,
		"pre_shift_minutes": early_minutes,
		"post_shift_minutes": late_out_minutes,
		"punch_in_range": (shift_rule or {}).get("punch_in_range") or "",
		"punch_out_range": (shift_rule or {}).get("punch_out_range") or "",
		"punch_in_range_valid": punch_in_range_valid,
		"punch_out_range_valid": punch_out_range_valid,
		# Early arrival is not working time or overtime.  Keep it separately for
		# audit, while the workday tolerance and raw overtime candidate use only
		# the time after the scheduled shift end.
		"outside_shift_minutes": late_out_minutes,
	}


def _night_condition_matches(condition: Mapping[str, Any] | None, *, duration_hours: Decimal, actual_out: int, scheduled_start: int) -> bool:
	if not condition or duration_hours < (_decimal(condition.get("minimum_hours")) or Decimal("0")):
		return False
	start = int(condition.get("start_minutes") or 0)
	if condition.get("mode") == "区间":
		end = int(condition.get("end_minutes") or 0)
		if start <= scheduled_start:
			start += 24 * 60
			end += 24 * 60
		elif end <= start:
			end += 24 * 60
		candidate = actual_out + (24 * 60 if end > 24 * 60 and actual_out < start else 0)
		return start <= candidate <= end
	if condition.get("mode") == "不早于":
		target = start
		if target <= scheduled_start:
			target += 24 * 60
		return actual_out >= target
	return False


def _configured_night_allowances(row: Mapping[str, Any], shift_rule: Mapping[str, Any] | None) -> tuple[bool, bool]:
	"""Return small/large night matches from structured workbook conditions."""
	if not shift_rule:
		return False, False
	bounds = _shift_bounds_minutes(row, shift_rule)
	if not bounds:
		return False, False
	start, _end = bounds
	actual_in, actual_out = _actual_bounds_minutes(row, start, shift_rule)
	if actual_in is None or actual_out is None or actual_out < actual_in:
		return False, False
	duration_hours = Decimal(actual_out - actual_in) / Decimal("60")
	large = _night_condition_matches(
		shift_rule.get("large_night_condition"), duration_hours=duration_hours,
		actual_out=actual_out, scheduled_start=start,
	)
	small = not large and _night_condition_matches(
		shift_rule.get("small_night_condition"), duration_hours=duration_hours,
		actual_out=actual_out, scheduled_start=start,
	)
	return small, large


def is_production_deep_night_shift(shift: Any) -> bool:
	"""Return whether a scheduled shift is the fixed production deep-night tier.

	The source's ``班次`` field is the authoritative scheduling fact. Actual
	punches remain evidence for attendance exceptions, but never decide whether
	the employee was assigned this allowance tier.
	"""
	shift_text = _text(shift)
	if _PRODUCTION_DEEP_NIGHT_SHIFT not in shift_text:
		return False
	clocks = _SHIFT_CLOCK_RE.findall(shift_text)
	if len(clocks) < 2:
		return False
	start_hour, start_minute = clocks[0]
	end_hour, end_minute = clocks[1]
	return (
		int(start_hour) * 60 + int(start_minute) == _PRODUCTION_DEEP_NIGHT_START_MINUTES
		and int(end_hour) * 60 + int(end_minute) == _PRODUCTION_DEEP_NIGHT_END_MINUTES
	)


def _late_hours(minutes: int) -> Decimal:
	"""Return personal-leave hours only after the 30-minute late boundary.

	A punch up to and including 30 minutes late remains a late-attendance event
	for review and reporting, but does not become personal leave. Once the
	boundary is exceeded, the complete late duration is charged as leave.
	"""
	return (Decimal(minutes) / Decimal("60")).quantize(Decimal("0.01")) if minutes > 30 else Decimal("0")


def _format_minutes(value: Any) -> str:
	if value is None:
		return ""
	minutes = int(value)
	return ("次日 " if minutes >= 24 * 60 else "") + f"{(minutes // 60) % 24:02d}:{minutes % 60:02d}"


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
	shift_times = _SHIFT_CLOCK_RE.findall(shift)
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
	shift_rules: Sequence[Mapping[str, Any]] | None = None,
	shift_rule_version: str = "",
) -> dict[str, Any]:
	"""Aggregate a DingTalk daily-detail export into one employee dataset."""
	if not _MONTH_RE.fullmatch(_text(attendance_month)):
		raise ValueError("attendance_month must use YYYY-MM")
	input_rows = [dict(row) for row in raw_rows]
	structure = precheck_attendance_draft_structure(_ordered_headers(input_rows))
	employee_index = _build_employee_index(employee_directory)
	policy = {**DEFAULT_EXCEPTION_POLICY, **{key: bool(value) for key, value in (exception_policy or {}).items() if key in DEFAULT_EXCEPTION_POLICY}}
	# DingTalk monthly exports can include the first day of the following month
	# so a cross-midnight shift on the last day remains understandable. Keep
	# those rows in the immutable source workbook as supplemental boundary
	# evidence, but do not aggregate them into this month or create exceptions.
	processing_rows: list[dict[str, Any]] = []
	supplemental_rows: list[dict[str, Any]] = []
	for row in input_rows:
		parsed_date = _parse_date(_value(row, IDENTITY_FIELDS["attendance_date"]), attendance_month)
		if parsed_date and _is_next_month_boundary_date(parsed_date, attendance_month):
			supplemental_rows.append(row)
		else:
			processing_rows.append(row)
	date_counts = Counter()
	for row in processing_rows:
		code = _value(row, IDENTITY_FIELDS["employee_code"])
		date_key = _parse_date(_value(row, IDENTITY_FIELDS["attendance_date"]), attendance_month)
		if code and date_key:
			date_counts[(code, date_key)] += 1
	groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
	missing_code_rows: list[dict[str, Any]] = []
	for row in processing_rows:
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
			shift_rules=shift_rules,
			shift_rule_version=shift_rule_version,
		)
		for _key, rows in sorted(groups.items(), key=lambda item: _group_sort_key(item[1]))
	]
	exception_rows = sum(1 for row in processed_rows if row["review_status"] == REVIEW_PENDING)
	exception_events = sum(len(row.get("exception_events") or []) for row in processed_rows)
	lifecycle_excluded_shift_rows = sum(len(row.get("data_quality_events") or []) for row in processed_rows)
	employment_scope_excluded_rows = sum(
		(row.get("processed_value") or {}).get("employment_scope_summary", {}).get("out_of_scope_rows", 0)
		for row in processed_rows
	)
	supplemental_dates = sorted({
		parsed_date
		for row in supplemental_rows
		if (parsed_date := _parse_date(_value(row, IDENTITY_FIELDS["attendance_date"]), attendance_month))
	})
	return {
		"status": "待处理异常" if exception_rows else "待确认",
		"structure_precheck": structure,
		"processed_rows": processed_rows,
		"data_quality": {
			"excluded_missing_employee_code_rows": len(missing_code_rows),
			"excluded_missing_employee_code_accounts": _source_account_summaries(missing_code_rows),
			"lifecycle_excluded_blank_shift_rows": lifecycle_excluded_shift_rows,
			"employment_scope_excluded_rows": employment_scope_excluded_rows,
			"supplemental_out_of_month_rows": len(supplemental_rows),
			"supplemental_out_of_month_dates": supplemental_dates,
			"notice": "工号为空的来源行不作为员工考勤处理；跨月边界行仅作补充证据，不参与当月汇总且不进入异常。",
		},
		"metrics": {
			"source_rows": len(input_rows),
			"eligible_employee_source_rows": len(processing_rows) - len(missing_code_rows),
			"supplemental_out_of_month_rows": len(supplemental_rows),
			"excluded_missing_employee_code_rows": len(missing_code_rows),
			"excluded_missing_employee_code_accounts": len(_source_account_summaries(missing_code_rows)),
			"processed_rows": len(processed_rows),
			"exception_rows": exception_rows,
			"exception_events": exception_events,
			"eligible_rows": sum(1 for row in processed_rows if row["eligible_for_downstream"]),
		},
	}


def _aggregate_employee_rows(rows, *, attendance_month, source_file, source_sheet, structure, employee_index, date_counts, exception_policy=None, shift_rules=None, shift_rule_version=""):
	first = rows[0]
	raw_code = _value(first, IDENTITY_FIELDS["employee_code"])
	names = {_value(row, IDENTITY_FIELDS["employee_name"]) for row in rows if _value(row, IDENTITY_FIELDS["employee_name"])}
	departments = {normalize_department_name(_value(row, IDENTITY_FIELDS["department"])) for row in rows if _value(row, IDENTITY_FIELDS["department"])}
	codes: list[str] = []
	if structure["missing_required_fields"]:
		_add_code(codes, "STRUCTURE_MISSING_REQUIRED_FIELD")
	if not raw_code:
		_add_code(codes, "EMPLOYEE_CODE_MISSING")
	if len({_name_key(value) for value in names}) > 1:
		_add_code(codes, "EMPLOYEE_CODE_NAME_CONFLICT")
	if len({_department_key(value) for value in departments}) > 1:
		_add_code(codes, "EMPLOYEE_DEPARTMENT_CONFLICT")
	name = next(iter(names), "")
	department = next(iter(departments), "")
	resolved_code, resolved_name, resolved_department, employee = _resolve_employee(raw_code, name, department, employee_index, codes)
	totals = {field: Decimal("0") for field in NUMERIC_FIELDS}
	scheduled_deep_night_shifts = 0
	source_deep_night_present = False
	configured_night_rule_used = False
	source_rows = []
	attendance_details = []
	exception_events = []
	data_quality_events = []
	attendance_notes = []
	employment_scope_counts = Counter()
	for row in rows:
		event_start = len(exception_events)
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
		employment_scope, employment_scope_reason = _employment_scope(parsed_date, employee)
		employment_scope_counts[employment_scope] += 1
		is_scheduled_deep_night_shift = is_production_deep_night_shift(shift)
		scheduled_deep_night_shifts += int(is_scheduled_deep_night_shift and employment_scope != "out_of_scope")
		if not shift:
			if employment_scope == "out_of_scope":
				data_quality_events.append(_data_quality_event("BLANK_SHIFT_OUTSIDE_EMPLOYMENT", parsed_date, row_number))
			else:
				# A blank class is retained as an import-quality note.  It is not
				# evidence of missing attendance or an instruction to recreate a
				# DingTalk schedule in HRMS.
				data_quality_events.append(_data_quality_event("BLANK_SHIFT_SOURCE", parsed_date, row_number))
		if employment_scope != "out_of_scope" and not _text(row.get("source_file") or source_file):
			_add_code(codes, "SOURCE_FILE_MISSING")
		if employment_scope != "out_of_scope" and not _text(row.get("source_sheet") or source_sheet):
			_add_code(codes, "SOURCE_SHEET_MISSING")
		if employment_scope != "out_of_scope" and row_number is None:
			_add_code(codes, "SOURCE_ROW_MISSING")
		row_numbers = {fieldname: Decimal("0") for fieldname in NUMERIC_FIELDS}
		for fieldname, aliases in NUMERIC_FIELDS.items():
			value, exists = _field_value(row, aliases)
			if fieldname == "deep_night_shifts" and exists:
				source_deep_night_present = True
			if not exists or _is_blank(value):
				continue
			number = _source_marker_number(value) if fieldname in {
				"clock_in_missing_count", "clock_out_missing_count", "late_count", "early_count", "absence_marker_count",
			} else _decimal(value)
			if number is None or number < 0:
				if employment_scope != "out_of_scope":
					_add_code(codes, "INVALID_NUMERIC_VALUE")
				continue
			selected_alias = next((alias for alias in aliases if alias in row and not _is_blank(row[alias])), "")
			if fieldname in LEAVE_FIELDS and "(天)" in selected_alias:
				number *= Decimal("8")
			row_numbers[fieldname] = number
		raw_numbers = dict(row_numbers)
		if employment_scope == "out_of_scope":
			if shift:
				data_quality_events.append(_data_quality_event(
					"OUTSIDE_EMPLOYMENT_PERIOD", parsed_date, row_number, employment_scope_reason,
				))
			source_rows.append({
				"source_file": _text(row.get("source_file") or source_file),
				"source_sheet": _text(row.get("source_sheet") or source_sheet),
				"source_row": row_number,
				"attendance_date": _text(date_value),
			})
			attendance_details.append(_out_of_scope_attendance_detail(
				row, parsed_date, row_number, raw_numbers, source_file, source_sheet, employment_scope_reason,
			))
			continue
		matched_shift_rule = _schedule_overtime_rule(row, shift_rules)
		shift_facts = _shift_time_facts(row, matched_shift_rule)
		if matched_shift_rule and (matched_shift_rule.get("small_night_condition") or matched_shift_rule.get("large_night_condition")):
			configured_night_rule_used = True
		configured_small_night, configured_large_night = _configured_night_allowances(row, matched_shift_rule)
		if configured_large_night and row_numbers["large_night_shifts"] <= 0:
			row_numbers["large_night_shifts"] = Decimal("1")
		if configured_small_night and row_numbers["small_night_shifts"] <= 0 and row_numbers["large_night_shifts"] <= 0:
			row_numbers["small_night_shifts"] = Decimal("1")
		for valid_key, exception_code in (
			("punch_in_range_valid", "CLOCK_IN_OUTSIDE_PICK_RANGE"),
			("punch_out_range_valid", "CLOCK_OUT_OUTSIDE_PICK_RANGE"),
		):
			if shift_facts.get(valid_key) is False:
				_add_code(codes, exception_code)
				exception_events.append(_exception_event(exception_code, parsed_date, row_number))
		schedule_overtime_mode = _schedule_overtime_mode(row, shift_rules)
		schedule_restday_overtime_mode = _schedule_restday_overtime_mode(row, shift_rules)
		schedule_auto_overtime_hours = _schedule_auto_overtime_hours(row, shift_rules)
		manual_overtime_value, manual_overtime_present = _field_value(
			row, ("确认计入的加班时长", "confirmed_overtime_hours")
		)
		manual_overtime_hours = _decimal(manual_overtime_value) if manual_overtime_present and not _is_blank(manual_overtime_value) else None
		if manual_overtime_hours is not None and manual_overtime_hours < 0:
			_add_code(codes, "INVALID_NUMERIC_VALUE")
			manual_overtime_hours = None
		raw_workday_overtime_hours = row_numbers["workday_overtime_hours"]
		has_overtime_approval = _has_overtime_approval(row)
		raw_outside_shift_hours = Decimal(shift_facts.get("outside_shift_minutes") or 0) / Decimal("60")
		schedule_fixed_hours_reached = _schedule_auto_overtime_reached(row, raw_workday_overtime_hours, shift_rules)
		schedule_auto_excess_minutes = _schedule_auto_overtime_excess_minutes(row, shift_rules)
		confirmed_workday_overtime_hours = (
			manual_overtime_hours
			if manual_overtime_hours is not None
			else raw_workday_overtime_hours if has_overtime_approval
			else Decimal("0") if shift_facts.get("punch_out_range_valid") is False
			else schedule_auto_overtime_hours
			if schedule_fixed_hours_reached
			else raw_workday_overtime_hours if schedule_overtime_mode == "schedule_auto"
			else Decimal("0")
		)
		row_numbers["workday_overtime_hours"] = confirmed_workday_overtime_hours
		is_deep_night_shift = (
			row_numbers["deep_night_shifts"] > 0
			if source_deep_night_present and _field_value(row, NUMERIC_FIELDS["deep_night_shifts"])[1]
			else is_scheduled_deep_night_shift
		)
		row_standard_hours = row_numbers["standard_hours"]
		row_actual_attendance_hours = row_numbers["actual_attendance_hours"]
		row_clock_in_missing = row_numbers["clock_in_missing_count"]
		row_clock_out_missing = row_numbers["clock_out_missing_count"]
		single_punch_missing_field = _single_punch_missing_field(row)
		if single_punch_missing_field == "clock_in_missing":
			row_clock_in_missing = max(row_clock_in_missing, Decimal("1"))
			row_numbers["clock_in_missing_count"] = row_clock_in_missing
		elif single_punch_missing_field == "clock_out_missing":
			row_clock_out_missing = max(row_clock_out_missing, Decimal("1"))
			row_numbers["clock_out_missing_count"] = row_clock_out_missing
		policy = daily_hours_policy(row_numbers, parsed_date)
		row_numbers = policy["numbers"]
		excluded_leave_hours = policy["excluded_leave_hours"]
		# Shift and actual clock decide the minutes.  Source work/date type decides
		# whether an adjusted weekend is a workday; ordinary rest days stay excluded.
		is_attendance_workday = _is_scheduled_attendance_workday(row, row_standard_hours, parsed_date)
		raw_late_minutes = int(shift_facts.get("late_minutes") or 0) if is_attendance_workday else 0
		approved_clock_in_leave_hours = _morning_leave_approval_hours(
			row,
			parsed_date,
			int(shift_facts.get("scheduled_start_minutes") or 0),
			shift_facts.get("actual_in_minutes"),
		) if raw_late_minutes and shift_facts.get("schedule_available") else Decimal("0")
		late_minutes = _late_minutes_after_approval(
			raw_late_minutes,
			approved_clock_in_leave_hours,
			row_standard_hours,
			row_actual_attendance_hours,
		)
		late_personal_leave_hours = _late_hours(late_minutes)
		if late_minutes:
			# Ordinary source rows add the derived late duration to their leave.  A
			# reviewed override is the displayed final total (already including late),
			# so retain it without adding the same late duration a second time.  The
			# late duration itself remains the minimum that can flow downstream once
			# the 30-minute boundary has been exceeded.
			if late_personal_leave_hours:
				if row.get("_personal_leave_includes_late"):
					row_numbers["personal_leave_hours"] = max(
						row_numbers["personal_leave_hours"], late_personal_leave_hours,
					)
				else:
					row_numbers["personal_leave_hours"] += late_personal_leave_hours
			attendance_notes.append(
				f"{parsed_date or _text(date_value)}迟到{late_minutes}分钟"
				+ ("（半小时以内）" if late_minutes <= 30 else "（超过半小时）")
			)
		policy = daily_hours_policy(row_numbers, parsed_date)
		policy["excluded_leave_hours"] = excluded_leave_hours
		row_numbers = policy["numbers"]
		row_leave_hours = policy["leave_hours"]
		row_clock_in_missing = row_numbers["clock_in_missing_count"]
		row_clock_out_missing = row_numbers["clock_out_missing_count"]
		row_late_count = row_numbers["late_count"]
		if raw_late_minutes > 0 and approved_clock_in_leave_hours > 0 and late_minutes <= 0:
			row_late_count = Decimal("0")
			row_numbers["late_count"] = row_late_count
		row_early_count = row_numbers["early_count"]
		row_absence_marker_count = row_numbers["absence_marker_count"]
		row_absence_hours = row_numbers["absence_hours"]
		# Only schedule rows whose weekend column says “不提交加班单” may generate
		# rest-day overtime from actual hours.  中班 is deliberately excluded: its
		# weekday amount is automatic, but its weekend column still says “加班单”.
		if (
			schedule_restday_overtime_mode == "schedule_auto"
			and _is_rest_day(row)
			and row_numbers["restday_overtime_hours"] <= 0
			and row_actual_attendance_hours > 0
		):
			row_numbers["restday_overtime_hours"] = row_actual_attendance_hours
		schedule_auto_restday_covered = bool(
			schedule_restday_overtime_mode == "schedule_auto"
			and (
				row_numbers["restday_overtime_hours"] > 0
				or row_actual_attendance_hours > 0
			)
		)
		row_restday_clock_without_overtime = (
			_is_rest_day(row)
			and _has_clock_punch(row)
			and row_numbers["restday_overtime_hours"] <= 0
			and not _has_overtime_approval(row)
			and not schedule_auto_restday_covered
		)
		if row_late_count <= 0 and late_minutes > 0:
			row_late_count = Decimal("1")
			row_numbers["late_count"] = row_late_count
		workday_outside_shift_unapproved = bool(
			_is_scheduled_workday(row_standard_hours)
			and not policy["is_weekend"]
			and (
				(
					schedule_overtime_mode == "schedule_auto"
					and schedule_auto_excess_minutes > OUTSIDE_SHIFT_EXCEPTION_TOLERANCE_MINUTES
				)
				or (
					schedule_overtime_mode != "schedule_auto"
					and (
						(shift_facts.get("outside_shift_minutes") or 0) > OUTSIDE_SHIFT_EXCEPTION_TOLERANCE_MINUTES
						or raw_workday_overtime_hours > 0
					)
				)
			)
			and not has_overtime_approval
			and manual_overtime_hours is None
		)
		shift_schedule_review_required = bool(
			_is_scheduled_workday(row_standard_hours)
			and (
				(_has_clock_punch(row) and not shift_facts.get("schedule_available"))
				or (row_late_count > 0 and (
					not shift_facts.get("schedule_available")
					or _clock_minutes(_value(row, ("上班时间", "上班打卡", "上班打卡时间", "clock_in"))) is None
				))
			)
		)
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
		policy.update(daily_hours_balance(row_numbers))
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
		if workday_outside_shift_unapproved:
			_add_code(codes, "WORKDAY_OUTSIDE_SHIFT_UNAPPROVED")
			exception_events.append(_exception_event("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", parsed_date, row_number))
		if shift_schedule_review_required:
			_add_code(codes, "SHIFT_SCHEDULE_REVIEW_REQUIRED")
			exception_events.append(_exception_event("SHIFT_SCHEDULE_REVIEW_REQUIRED", parsed_date, row_number))
		if policy["hours_mismatch"]:
			_add_code(codes, "ATTENDANCE_HOURS_MISMATCH")
			exception_events.append(_exception_event("ATTENDANCE_HOURS_MISMATCH", parsed_date, row_number))
		for event in exception_events[event_start:]:
			event.update({
				"source_file": _text(row.get("source_file") or source_file),
				"source_sheet": _text(row.get("source_sheet") or source_sheet),
			})
		source_rows.append({
			"source_file": _text(row.get("source_file") or source_file),
			"source_sheet": _text(row.get("source_sheet") or source_sheet),
			"source_row": row_number,
			"attendance_date": _text(date_value),
		})
		attendance_detail = {
			**{field: _display_number(value) for field, value in row_numbers.items()},
			"attendance_date": parsed_date or _text(date_value),
			"date_type": _text(_value(row, ("日期类型", "工作类型", "date_type", "work_type"))),
			"is_weekend": policy["is_weekend"],
			"leave_hours": _display_number(row_leave_hours),
			"leave_breakdown": {LEAVE_LABELS[field]: _display_number(row_numbers[field]) for field in LEAVE_FIELDS},
			"excluded_leave_hours": {LEAVE_LABELS[field]: _display_number(value) for field, value in policy["excluded_leave_hours"].items() if value},
			"accounted_hours": _display_number(policy["accounted_hours"]),
			"hours_difference": _display_number(policy["hours_difference"]),
			"hours_mismatch": policy["hours_mismatch"],
			"full_day_leave": policy["full_day_leave"],
			"source_numbers": {field: _display_number(value) for field, value in raw_numbers.items()},
			"approval": _text(_value(row, IDENTITY_FIELDS["approval"])),
			"overtime_approval_status": (
				"人工确认" if manual_overtime_hours is not None
				else "已匹配申请" if has_overtime_approval
				else "钉钉自动识别" if schedule_overtime_mode == "schedule_auto"
				else "无申请"
			),
			"overtime_source_mode": schedule_overtime_mode,
			"shift_rule_code": matched_shift_rule.get("rule_code", "builtin") if matched_shift_rule else "",
			"shift_rule_name": matched_shift_rule.get("name", "") if matched_shift_rule else "",
			"shift_rule_snapshot": {
				key: matched_shift_rule.get(key)
				for key in (
					"basic_time", "basic_hours", "weekday_overtime_time", "weekend_overtime_time",
					"overtime_begin_time", "weekday_overtime_mode", "weekend_overtime_mode",
					"holiday_overtime_mode", "extended_shift_rule", "overnight", "meal_deduction_rule",
					"meal_deduction_hours", "punch_in_range", "punch_out_range", "small_night_rule",
					"large_night_rule", "remarks", "suggested_positions",
				)
			} if matched_shift_rule else {},
			"restday_overtime_source_mode": schedule_restday_overtime_mode,
			"schedule_auto_overtime_hours": _display_number(schedule_auto_overtime_hours) if schedule_auto_overtime_hours is not None else 0,
			"raw_workday_overtime_hours": _display_number(raw_workday_overtime_hours),
			"raw_outside_shift_hours": _display_number(raw_outside_shift_hours),
			"schedule_auto_excess_minutes": schedule_auto_excess_minutes,
			"confirmed_overtime_hours": _display_number(confirmed_workday_overtime_hours),
			"late_minutes": late_minutes,
			"raw_late_minutes": raw_late_minutes,
			"approved_clock_in_leave_hours": _display_number(approved_clock_in_leave_hours),
			"late_approval_covered": bool(raw_late_minutes > 0 and approved_clock_in_leave_hours > 0 and late_minutes <= 0),
			"late_personal_leave_hours": _display_number(late_personal_leave_hours),
			"attendance_note": attendance_notes[-1] if late_minutes else "",
			"scheduled_start": _format_minutes(shift_facts.get("scheduled_start_minutes")),
			"scheduled_end": _format_minutes(shift_facts.get("scheduled_end_minutes")),
			"punch_in_range": shift_facts.get("punch_in_range") or "",
			"punch_out_range": shift_facts.get("punch_out_range") or "",
			"clock_in_outside_pick_range": shift_facts.get("punch_in_range_valid") is False,
			"clock_out_outside_pick_range": shift_facts.get("punch_out_range_valid") is False,
			"configured_small_night_shift": configured_small_night,
			"configured_large_night_shift": configured_large_night,
			"source_file": _text(row.get("source_file") or source_file),
			"source_sheet": _text(row.get("source_sheet") or source_sheet),
			"shift": _value(row, IDENTITY_FIELDS["shift"]),
			"clock_in": _text(_value(row, ("上班时间", "上班打卡", "上班打卡时间", "clock_in"))),
			"clock_out": _text(_value(row, ("下班时间", "下班打卡", "下班打卡时间", "clock_out"))),
			"clock_in_missing": _display_number(row_clock_in_missing),
			"clock_out_missing": _display_number(row_clock_out_missing),
			"late_count": _display_number(row_late_count),
			"early_count": _display_number(row_early_count),
			"absence_marker_count": _display_number(row_absence_marker_count),
			"absence_hours": _display_number(row_absence_hours),
			"workday_outside_shift_unapproved": workday_outside_shift_unapproved,
			"shift_schedule_review_required": shift_schedule_review_required,
			"source_row": row_number,
		}
		if is_deep_night_shift:
			attendance_detail["is_production_deep_night_shift"] = True
		if row_restday_clock_without_overtime:
			attendance_detail.update({
				"date_type": _text(_value(row, ("日期类型", "工作类型", "date_type", "work_type"))),
				"restday_overtime_hours": _display_number(row_numbers["restday_overtime_hours"]),
				"overtime_approval": _text(_value(row, IDENTITY_FIELDS["approval"])),
				"restday_clocked_without_overtime": True,
			})
		attendance_details.append(attendance_detail)
	# The review screen remains employee-centred, but a reviewer needs to see
	# precisely which original daily rows caused the review.  These lines are a
	# display/audit projection only; all their values come directly from DingTalk.
	exception_lines = exception_lines_from_attendance_details(attendance_details, codes)
	deep_night_shifts = totals["deep_night_shifts"] if source_deep_night_present else Decimal(scheduled_deep_night_shifts)
	proposed = {
		"attendance_policy_version": ATTENDANCE_POLICY_VERSION,
		"shift_rule_version": shift_rule_version or f"builtin-{ATTENDANCE_POLICY_VERSION}",
		"leave_hours": _display_number(sum((totals[field] for field in LEAVE_FIELDS), Decimal("0"))),
		"employee_code": resolved_code or raw_code,
		"employee_name": resolved_name or name,
		"department": resolved_department or department,
		**{field: _display_number(value) for field, value in totals.items()},
		"deep_night_shifts": deep_night_shifts,
		"night_shift_matching": {
			"mode": "source_or_configured_schedule" if configured_night_rule_used else "source_only",
			"matched_small_night_shifts": _display_number(totals["small_night_shifts"]),
			"matched_large_night_shifts": _display_number(totals["large_night_shifts"]),
			"deep_night_source": "深夜班" if source_deep_night_present else "生产夜班排班兜底",
			"deep_night_shift_rule": "生产夜班 20:00-次日08:00",
		},
		"attendance_details": attendance_details,
		"exception_lines": exception_lines,
		"exception_events": exception_events,
		"data_quality_events": data_quality_events,
		"employment_scope_summary": {
			"in_scope_rows": employment_scope_counts["in_scope"],
			"out_of_scope_rows": employment_scope_counts["out_of_scope"],
			"unknown_scope_rows": employment_scope_counts["unknown"],
		},
		"attendance_population_status": (
			"非本月在职"
			if employment_scope_counts["out_of_scope"] and not employment_scope_counts["in_scope"] and not employment_scope_counts["unknown"]
			else "本月在职"
		),
		"attendance_note": "；".join(attendance_notes),
		"review_note": "；".join(attendance_notes),
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
		"eligible_for_downstream": (
			review_status == REVIEW_NOT_REQUIRED
			and proposed["attendance_population_status"] != "非本月在职"
		),
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
	"""Return whether the roster proves the date is outside employment."""
	return _employment_scope(attendance_date, employee)[0] == "out_of_scope"


def _employment_scope(attendance_date: str, employee: Mapping[str, Any] | None) -> tuple[str, str]:
	"""Classify a daily row without guessing when roster dates are unavailable."""
	day = _date_only(attendance_date)
	if not day or not employee:
		return "unknown", ""
	joined_on = _date_only(employee.get("date_of_joining"))
	relieved_on = _date_only(employee.get("relieving_date"))
	if not joined_on and not relieved_on:
		return "unknown", ""
	if joined_on and day < joined_on:
		return "out_of_scope", f"入职前（入职日期 {joined_on.isoformat()}）"
	if relieved_on and day > relieved_on:
		return "out_of_scope", f"离职后（离职日期 {relieved_on.isoformat()}）"
	return "in_scope", ""


def _exception_event(code: str, attendance_date: str, source_row: int | None, count: Decimal | None = None) -> dict[str, Any]:
	event = {"code": code, "attendance_date": attendance_date or "", "source_row": source_row}
	if count is not None:
		event["count"] = _display_number(count)
	return event


def _data_quality_event(code: str, attendance_date: str, source_row: int | None, reason: str = "") -> dict[str, Any]:
	event = {"code": code, "attendance_date": attendance_date or "", "source_row": source_row}
	if reason:
		event["reason"] = reason
	return event


def _out_of_scope_attendance_detail(row, parsed_date, row_number, raw_numbers, source_file, source_sheet, reason):
	"""Keep a traceable daily row while removing it from attendance calculations."""
	source_path = _text(row.get("source_file") or source_file)
	source_tab = _text(row.get("source_sheet") or source_sheet)
	return {
		**{field: 0 for field in NUMERIC_FIELDS},
		"attendance_date": parsed_date or _text(_value(row, IDENTITY_FIELDS["attendance_date"])),
		"date_type": _text(_value(row, ("日期类型", "工作类型", "date_type", "work_type"))),
		"is_weekend": is_calendar_weekend(parsed_date),
		"leave_hours": 0,
		"leave_breakdown": {LEAVE_LABELS[field]: 0 for field in LEAVE_FIELDS},
		"excluded_leave_hours": {},
		"accounted_hours": 0,
		"hours_difference": 0,
		"hours_mismatch": False,
		"full_day_leave": False,
		"source_numbers": {field: _display_number(value) for field, value in raw_numbers.items()},
		"approval": _text(_value(row, IDENTITY_FIELDS["approval"])),
		"overtime_approval_status": "不在职期间，未计入",
		"raw_workday_overtime_hours": _display_number(raw_numbers["workday_overtime_hours"]),
		"raw_outside_shift_hours": 0,
		"confirmed_overtime_hours": 0,
		"late_minutes": 0,
		"late_personal_leave_hours": 0,
		"attendance_note": reason,
		"scheduled_start": "",
		"scheduled_end": "",
		"source_file": source_path,
		"source_sheet": source_tab,
		"shift": _value(row, IDENTITY_FIELDS["shift"]),
		"clock_in": _text(_value(row, ("上班时间", "上班打卡", "上班打卡时间", "clock_in"))),
		"clock_out": _text(_value(row, ("下班时间", "下班打卡", "下班打卡时间", "clock_out"))),
		"clock_in_missing": 0,
		"clock_out_missing": 0,
		"late_count": 0,
		"early_count": 0,
		"absence_marker_count": 0,
		"absence_hours": 0,
		"workday_outside_shift_unapproved": False,
		"shift_schedule_review_required": False,
		"employment_scope": "out_of_scope",
		"employment_scope_reason": reason,
		"source_row": row_number,
	}


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


def _is_next_month_boundary_date(parsed_date: str, attendance_month: str) -> bool:
	"""Accept only the immediate first day after the processing month as context."""
	try:
		year, month = (int(part) for part in attendance_month.split("-", 1))
		next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
		return parsed_date == date(next_year, next_month, 1).isoformat()
	except (TypeError, ValueError):
		return False


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
	# DingTalk may append a lifecycle label to the display name, for example
	# ``张三（离职）``.  The employee code remains the authoritative identity,
	# so this known presentation-only suffix must not create a name mismatch.
	# Keep every other name difference reviewable.
	text = re.sub(r"\s+", "", _text(value))
	text = re.sub(r"(?:[\(（](?:已)?离职[\)）])+$", "", text)
	return text.casefold()


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
