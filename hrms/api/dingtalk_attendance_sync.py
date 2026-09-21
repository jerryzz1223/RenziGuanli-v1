"""Convert DingTalk attendance payloads into isolated HRMS draft day checks.

The converter is deliberately one-way: DingTalk responses are immutable raw
evidence, while the resulting day checks are replaceable drafts until HR locks
the month.  No salary, Employee master, or approved monthly record is written.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import frappe
from frappe import _
from frappe.utils import flt, getdate, now_datetime

from hrms.api import attendance_import as attendance


RAW_DOCTYPE = "HRMS DingTalk Raw Record"
USER_MAP_DOCTYPE = "HRMS DingTalk User Map"
BATCH_DOCTYPE = "HRMS Attendance Import Batch"
DAY_CHECK_DOCTYPE = "HRMS Attendance Day Check"
EXCEPTION_DOCTYPE = "HRMS Attendance Exception"
MONTH_LOCK_DOCTYPE = "HRMS Attendance Month Lock"
DAILY_CLOSURE_DOCTYPE = "HRMS Attendance Daily Closure"
API_SOURCE_TYPE = "dingtalk_api"
API_SOURCE_KIND = "钉钉API同步"

DAILY_RESYNC_COMPARE_FIELDS = (
	"employee",
	"employee_code",
	"user_id",
	"date_type",
	"shift_name",
	"scheduled_in_time",
	"scheduled_out_time",
	"actual_in_time",
	"actual_out_time",
	"missing_in",
	"missing_out",
	"attendance_result",
	"standard_hours",
	"actual_attendance_hours",
	"workday_overtime_hours",
	"restday_overtime_hours",
	"holiday_overtime_hours",
	"leave_summary",
	"leave_hours",
	"late_count",
	"late_minutes",
	"outside_shift_punch_status",
	"approval_summary",
)

EXCEPTION_REVIEW_FIELDS = (
	"handling_method",
	"deduct_absence_hours",
	"full_attendance_deduction",
	"red_apple_penalty",
	"confirmation_status",
	"confirmed_by",
	"confirmed_on",
	"remarks",
)


def _require_manager(enforce_role: bool) -> None:
	if enforce_role:
		frappe.only_for(("System Manager", "HR Manager"))


def _first(payload: dict[str, Any], *keys: str) -> Any:
	for key in keys:
		value = payload.get(key)
		if value not in (None, ""):
			return value
	return ""


def _payload(value: str | dict | list | None) -> dict | list:
	if not value:
		return {}
	if isinstance(value, (dict, list)):
		return value
	try:
		return json.loads(value)
	except (TypeError, ValueError):
		return {}


def _nested_items(payload: Any) -> list[dict[str, Any]]:
	"""Extract attendance event dictionaries from variant DingTalk response shapes."""
	items: list[dict[str, Any]] = []
	seen: set[str] = set()

	def visit(value: Any, depth: int = 0) -> None:
		if depth > 5:
			return
		if isinstance(value, list):
			for child in value:
				visit(child, depth + 1)
			return
		if not isinstance(value, dict):
			return
		identity = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
		looks_like_event = any(
			key in value
			for key in (
				"userId", "userid", "user_id", "checkType", "check_type", "userCheckTime", "user_check_time", "workDate", "work_date"
			)
		)
		if looks_like_event and identity not in seen:
			seen.add(identity)
			items.append(value)
		for key in (
			"result",
			"data",
			"records",
			"record",
			"items",
			"list",
			"attendance",
			"attendance_result_list",
			"attendanceResultList",
			"attendanceRecords",
			"check_record_list",
			"checkRecordList",
			"checkRecords",
			"check_record",
		):
			if key in value:
				visit(value[key], depth + 1)

	visit(payload)
	return items


def _event_datetime(value: Any) -> datetime | None:
	if value in (None, ""):
		return None
	if isinstance(value, datetime):
		return value
	if isinstance(value, date):
		return datetime.combine(value, datetime.min.time())
	if isinstance(value, (int, float)) or str(value).isdigit():
		number = int(value)
		if number > 10_000_000_000:
			number //= 1000
		try:
			# DingTalk timestamps are UTC instants; attendance dates/times in this
			# installation are evaluated in China Standard Time, not the container's
			# default timezone.
			return datetime.fromtimestamp(number, tz=ZoneInfo("Asia/Shanghai")).replace(tzinfo=None)
		except (OverflowError, OSError, ValueError):
			return None
	text = str(value).replace("T", " ").replace("Z", "")
	for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M"):
		try:
			return datetime.strptime(text, pattern)
		except ValueError:
			continue
	return None


def _event_day(event: dict[str, Any], fallback: date) -> date:
	value = _first(event, "workDate", "work_date", "attendanceDate", "attendance_date", "baseCheckTime", "userCheckTime", "user_check_time")
	if isinstance(value, str) and len(value) >= 10:
		try:
			return getdate(value[:10])
		except Exception:
			pass
	dt = _event_datetime(value)
	return dt.date() if dt else fallback


def _event_time(event: dict[str, Any]) -> datetime | None:
	return _event_datetime(
		_first(event, "userCheckTime", "user_check_time", "checkTime", "check_time", "baseCheckTime", "base_check_time")
	)


def _scheduled_event_time(event: dict[str, Any]) -> datetime | None:
	return _event_datetime(
		_first(event, "baseCheckTime", "base_check_time", "planCheckTime", "plan_check_time", "scheduledTime", "scheduled_time")
	)


def _time_text(value: datetime | None) -> str:
	return value.strftime("%H:%M") if value else ""


def _is_on_duty(event: dict[str, Any]) -> bool:
	value = str(_first(event, "checkType", "check_type", "check_type_text", "type")).lower()
	return value in {"onduty", "on_duty", "on-duty", "上班", "上班打卡"}


def _is_off_duty(event: dict[str, Any]) -> bool:
	value = str(_first(event, "checkType", "check_type", "check_type_text", "type")).lower()
	return value in {"offduty", "off_duty", "off-duty", "下班", "下班打卡"}


def _is_missing_event(event: dict[str, Any]) -> bool:
	value = str(_first(event, "timeResult", "time_result", "attendanceResult", "attendance_result", "result")).lower()
	return any(flag in value for flag in ("notsigned", "not_signed", "missing", "缺卡", "未打卡"))


def _is_usable_attendance_event(event: dict[str, Any]) -> bool:
	"""Ignore a successful-but-empty API envelope.

	The legacy updatedata endpoint returns a result envelope for every user even
	when the requested day has no accessible clock detail.  Treating that
	envelope as a missed punch creates false absence and red-apple deductions.
	"""
	return any(
		event.get(key) not in (None, "", [], {})
		for key in (
			"userCheckTime", "user_check_time", "checkTime", "check_time", "baseCheckTime",
			"checkType", "check_type", "timeResult", "time_result", "attendanceResult",
			"actualAttendanceHours", "actual_attendance_hours", "workHours", "work_hours",
		)
	)


def _mapping(company: str, user_id: str) -> Any:
	name = frappe.db.exists(USER_MAP_DOCTYPE, {"company": company, "dingtalk_userid": user_id})
	return frappe.get_doc(USER_MAP_DOCTYPE, name) if name else None


def _approval_evidence(company: str, user_id: str, business_date: date) -> list[dict[str, str]]:
	rows = frappe.get_all(
		RAW_DOCTYPE,
		filters={
			"company": company,
			"source_type": "approval",
			"dingtalk_userid": user_id,
			"business_date": business_date,
			"sync_status": ["!=", "已失效"],
		},
		fields=["external_id", "payload_json"],
		limit_page_length=0,
	)
	evidence = []
	for row in rows:
		payload = _payload(row.payload_json)
		body = payload.get("result") if isinstance(payload, dict) and isinstance(payload.get("result"), dict) else payload
		if not isinstance(body, dict):
			body = {}
		evidence.append(
			{
				"approval_no": str(row.external_id or ""),
				"approval_type": str(
					_first(payload, "hrms_approval_type")
					or _first(body, "process_name", "processName", "title", "name")
					or "未分类审批"
				),
				"approval_status": str(_first(body, "status", "approval_status", "approvalStatus")),
				"approval_result": str(_first(body, "result", "approval_result", "approvalResult")),
			}
		)
	return evidence


def _approval_is_passed(item: dict[str, str]) -> bool:
	value = f"{item.get('approval_status', '')} {item.get('approval_result', '')}".strip().lower()
	return any(marker in value for marker in ("agree", "approved", "pass", "同意", "通过")) and not any(
		marker in value for marker in ("disagree", "reject", "refuse", "驳回", "拒绝", "不同意")
	)


def _approval_state(item: dict[str, str]) -> str:
	value = f"{item.get('approval_status', '')} {item.get('approval_result', '')}".strip().lower()
	if _approval_is_passed(item):
		return "passed"
	if any(marker in value for marker in ("disagree", "reject", "refuse", "terminate", "驳回", "拒绝", "不同意", "撤销")):
		return "rejected"
	return "pending"


def _late_minutes(event: dict[str, Any], actual_time: datetime | None, scheduled_time: datetime | None) -> int:
	explicit = _first(event, "lateMinutes", "late_minutes", "lateMinute", "late_minute")
	if explicit not in (None, ""):
		try:
			return max(int(float(explicit)), 0)
		except (TypeError, ValueError):
			pass
	if actual_time and scheduled_time:
		return max(int((actual_time - scheduled_time).total_seconds() // 60), 0)
	return 0


def _outside_shift_status(early_minutes: int, late_out_minutes: int, approvals: list[dict[str, str]]) -> str:
	if not (early_minutes or late_out_minutes):
		return ""
	overtime_approvals = [item for item in approvals if "加班" in item.get("approval_type", "")]
	if any(_approval_is_passed(item) for item in overtime_approvals):
		return "有已通过加班审批的班次外打卡（待HRMS核定）"
	if any(_approval_state(item) == "pending" for item in overtime_approvals):
		return "加班审批待审的班次外打卡/候选加班"
	if overtime_approvals:
		return "加班审批已驳回的班次外打卡/候选加班"
	return "无申请的班次外打卡/候选加班"


def _draft_row(company: str, business_date: date, user_id: str, events: list[dict[str, Any]]) -> dict[str, Any]:
	mapping = _mapping(company, user_id)
	in_events = [event for event in events if _is_on_duty(event)]
	out_events = [event for event in events if _is_off_duty(event)]
	all_times = [item for item in (_event_time(event) for event in events) if item]
	in_time = min((_event_time(event) for event in in_events if _event_time(event)), default=None)
	out_time = max((_event_time(event) for event in out_events if _event_time(event)), default=None)
	scheduled_in = min((_scheduled_event_time(event) for event in in_events if _scheduled_event_time(event)), default=None)
	scheduled_out = max((_scheduled_event_time(event) for event in out_events if _scheduled_event_time(event)), default=None)
	if not in_time and all_times:
		in_time = min(all_times)
	if not out_time and len(all_times) > 1:
		out_time = max(all_times)
	missing_in = int(not in_events or any(_is_missing_event(event) for event in in_events))
	missing_out = int(not out_events or any(_is_missing_event(event) for event in out_events))
	first_event = events[0] if events else {}
	actual_hours = flt(_first(first_event, "actualAttendanceHours", "actual_attendance_hours", "workHours", "work_hours"))
	if not actual_hours and in_time and out_time:
		actual_hours = round(max((out_time - in_time).total_seconds() / 3600, 0), 2)
	standard_hours = flt(_first(first_event, "standardHours", "standard_hours", "planWorkHours", "plan_work_hours")) or 8
	approvals = _approval_evidence(company, user_id, business_date)
	late_minutes = max((_late_minutes(event, _event_time(event), _scheduled_event_time(event)) for event in in_events), default=0)
	late_count = int(late_minutes > 0 or any("late" in str(_first(event, "timeResult", "time_result")).lower() or "迟到" in str(_first(event, "timeResult", "time_result")) for event in in_events))
	early_minutes = max(int((scheduled_in - in_time).total_seconds() // 60), 0) if scheduled_in and in_time else 0
	late_out_minutes = max(int((out_time - scheduled_out).total_seconds() // 60), 0) if scheduled_out and out_time else 0
	outside_shift_status = _outside_shift_status(early_minutes, late_out_minutes, approvals)
	approval_summary = "、".join(
		"{approval_type}[{approval_no}]:{approval_status}/{approval_result}".format(**item).rstrip("/") for item in approvals
	)
	return {
		"工号": mapping.employee_code if mapping else _first(first_event, "jobNumber", "job_number", "employeeNo", "employee_code"),
		"姓名": mapping.employee_name if mapping else _first(first_event, "name", "employeeName", "employee_name") or f"钉钉用户-{user_id}",
		"UserId": user_id,
		"日期": str(business_date),
		"考勤组": _first(first_event, "groupName", "group_name", "attendanceGroup", "attendance_group"),
		"部门": mapping.department_name if mapping else _first(first_event, "departmentName", "department_name", "deptName"),
		"班次": _first(first_event, "className", "class_name", "shiftName", "shift_name"),
		"应上班时间": _time_text(scheduled_in),
		"应下班时间": _time_text(scheduled_out),
		"上班时间": _time_text(in_time),
		"下班时间": _time_text(out_time),
		"上班缺卡": missing_in,
		"下班缺卡": missing_out,
		"标准工时": standard_hours,
		"实际出勤(小时)": actual_hours,
		"迟到次数": late_count,
		"迟到分钟": late_minutes,
		"早到分钟": early_minutes,
		"晚走分钟": late_out_minutes,
		"关联审批单": approval_summary,
		"关联审批明细": approvals,
		"班次外打卡状态": outside_shift_status,
		"无申请的班次外打卡": int(outside_shift_status.startswith("无申请")),
		# DingTalk supplies facts and approval evidence only.  It never writes
		# payroll-eligible overtime hours; HRMS decides that downstream.
		"工作日加班(小时)": 0,
		"休息日加班(小时)": 0,
		"节假日加班(小时)": 0,
		"_source_row": 0,
		"_raw_events": events,
	}


def _batch_for_day(company: str, business_date: date, sync_log: str) -> Any:
	checksum = hashlib.sha256(f"dingtalk-api:{company}:{business_date}".encode()).hexdigest()
	name = frappe.db.get_value(BATCH_DOCTYPE, {"company": company, "source_checksum": checksum}, "name")
	if name:
		batch = frappe.get_doc(BATCH_DOCTYPE, name)
		batch.dingtalk_sync_log = sync_log or batch.get("dingtalk_sync_log")
		batch.save(ignore_permissions=True)
		return batch
	return frappe.get_doc(
		{
			"doctype": BATCH_DOCTYPE,
			"company": company,
			"attendance_month": business_date.strftime("%Y-%m"),
			"source_type": API_SOURCE_TYPE,
			"dingtalk_sync_log": sync_log,
			"source_checksum": checksum,
			"status": "已导入",
			"imported_by": frappe.session.user,
			"imported_on": now_datetime(),
			"notes": json.dumps({"business_date": str(business_date), "source": "DingTalk API"}, ensure_ascii=False),
		}
	).insert(ignore_permissions=True)


def _assert_month_open(company: str, business_date: date) -> None:
	status = frappe.db.get_value(MONTH_LOCK_DOCTYPE, {"company": company, "attendance_month": business_date.strftime("%Y-%m")}, "status")
	if status == "已锁定":
		frappe.throw(_("{0} 的 {1} 考勤已锁定，钉钉同步不能覆盖历史草稿。").format(company, business_date.strftime("%Y-%m")))


def _row_value(row: Any, fieldname: str) -> Any:
	if isinstance(row, dict):
		return row.get(fieldname)
	return getattr(row, fieldname, None)


def _daily_check_identity(row: Any) -> str:
	return str(
		_row_value(row, "employee")
		or _row_value(row, "employee_code")
		or _row_value(row, "user_id")
		or _row_value(row, "name")
		or ""
	)


def _daily_check_signature(row: Any) -> tuple[str, ...]:
	return tuple(str(_row_value(row, fieldname) or "") for fieldname in DAILY_RESYNC_COMPARE_FIELDS)


def _compare_daily_check_versions(previous_rows: list[Any], current_rows: list[Any]) -> dict[str, Any]:
	"""Compare effective DingTalk drafts without relying on document names."""
	previous = {_daily_check_identity(row): _daily_check_signature(row) for row in previous_rows if _daily_check_identity(row)}
	current = {_daily_check_identity(row): _daily_check_signature(row) for row in current_rows if _daily_check_identity(row)}
	created = sorted(set(current) - set(previous))
	removed = sorted(set(previous) - set(current))
	changed = sorted(key for key in set(previous) & set(current) if previous[key] != current[key])
	unchanged = sorted(key for key in set(previous) & set(current) if previous[key] == current[key])
	return {
		"created": created,
		"removed": removed,
		"changed": changed,
		"unchanged": unchanged,
		"affected": sorted(set(created + removed + changed)),
	}


def _restore_unchanged_exception_reviews(batch_name: str, previous_rows: list[Any], unchanged_identities: list[str]) -> int:
	unchanged = set(unchanged_identities)
	if not previous_rows or not unchanged:
		return 0
	previous_by_key = {
		(_daily_check_identity(row), str(_row_value(row, "exception_type") or "")): row
		for row in previous_rows
		if _daily_check_identity(row) in unchanged
	}
	if not previous_by_key:
		return 0
	current_rows = frappe.get_all(
		EXCEPTION_DOCTYPE,
		filters={"import_batch": batch_name},
		fields=["name", "employee", "employee_code", "exception_type"],
		limit_page_length=0,
	)
	restored = 0
	for row in current_rows:
		previous = previous_by_key.get((_daily_check_identity(row), str(_row_value(row, "exception_type") or "")))
		if not previous:
			continue
		frappe.db.set_value(
			EXCEPTION_DOCTYPE,
			_row_value(row, "name"),
			{fieldname: _row_value(previous, fieldname) for fieldname in EXCEPTION_REVIEW_FIELDS},
			update_modified=False,
		)
		restored += 1
	return restored


def _daily_closure(company: str, business_date: date) -> Any:
	if not frappe.db.exists("DocType", DAILY_CLOSURE_DOCTYPE):
		return None
	name = frappe.db.get_value(
		DAILY_CLOSURE_DOCTYPE,
		{"company": company, "attendance_date": business_date},
		"name",
	)
	return frappe.get_doc(DAILY_CLOSURE_DOCTYPE, name) if name else None


def _invalidate_daily_closure_after_resync(
	company: str,
	business_date: date,
	resync_reason: str,
	allow_locked_day_resync: bool,
) -> dict[str, Any]:
	closure = _daily_closure(company, business_date)
	if not closure:
		return {"invalidated": False, "previous_status": ""}
	previous_status = str(closure.get("status") or "")
	if previous_status == "已锁定" and not allow_locked_day_resync:
		frappe.throw(_("{0} 的日考勤已经锁定；请由有审批权限的人员填写原因后重开当天。").format(business_date))
	closure.status = "已重开" if previous_status == "已锁定" else "待校验"
	closure.validation_status = "未校验"
	closure.correction_version = int(closure.get("correction_version") or 1) + 1
	closure.validation_message = _("钉钉数据重新同步后发生变化，请重新处理异常并校验当天数据。")
	closure.validated_by = None
	closure.validated_on = None
	closure.locked_by = None
	closure.locked_on = None
	reason_text = (resync_reason or "钉钉来源数据发生变化").strip()
	previous_remarks = str(closure.get("remarks") or "").strip()
	closure.remarks = "\n".join(filter(None, (previous_remarks, _("重新同步：{0}").format(reason_text))))
	closure.save(ignore_permissions=True)
	return {"invalidated": True, "previous_status": previous_status, "status": closure.status}


@frappe.whitelist()
def convert_dingtalk_raw_attendance_to_daily_checks(
	company: str,
	business_date: str,
	sync_log: str = "",
	enforce_role: bool = True,
	resync_reason: str = "",
	allow_locked_day_resync: bool = False,
) -> dict[str, Any]:
	"""Build replaceable daily-check drafts from raw API payloads for one company/date."""
	# This function is whitelisted, so permission checks must never depend on a
	# caller-controlled flag. Background jobs run as the user who queued them.
	_require_manager(True)
	if not company or not frappe.db.exists("Company", company):
		frappe.throw(_("请选择有效同步公司。"))
	day = getdate(business_date)
	_assert_month_open(company, day)
	raw_records = frappe.get_all(
		RAW_DOCTYPE,
		filters={"company": company, "source_type": "attendance", "business_date": day},
		fields=["name", "dingtalk_userid", "payload_json"],
		limit_page_length=0,
	)
	batch = _batch_for_day(company, day, sync_log)

	# API rows are drafts. Rebuild just this isolated API batch; manual rows stay intact.
	old_checks = frappe.get_all(
		DAY_CHECK_DOCTYPE,
		filters={"import_batch": batch.name, "source_kind": API_SOURCE_KIND},
		fields=["name", *DAILY_RESYNC_COMPARE_FIELDS],
		limit_page_length=0,
	)
	if old_checks and not (resync_reason or "").strip():
		frappe.throw(_("重新生成已有钉钉日考勤草稿必须填写原因。"))
	closure = _daily_closure(company, day)
	if closure and closure.get("status") == "已锁定" and not allow_locked_day_resync:
		frappe.throw(_("{0} 的日考勤已经锁定；普通同步不能覆盖已审核版本。").format(day))
	if closure and closure.get("status") == "已锁定" and allow_locked_day_resync:
		from hrms.access_control import require_hrms_capability

		require_hrms_capability("attendance_approve", legacy_roles=("HR Manager",))
	old_exceptions = frappe.get_all(
		EXCEPTION_DOCTYPE,
		filters={"import_batch": batch.name},
		fields=["name", "employee", "employee_code", "exception_type", *EXCEPTION_REVIEW_FIELDS],
		limit_page_length=0,
	)
	for exception in old_exceptions:
		frappe.delete_doc(EXCEPTION_DOCTYPE, exception.name, ignore_permissions=True, force=True)
	for name in [row.name for row in old_checks]:
		frappe.delete_doc(DAY_CHECK_DOCTYPE, name, ignore_permissions=True, force=True)

	grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
	empty_raw_records = 0
	for raw in raw_records:
		items = [event for event in _nested_items(_payload(raw.payload_json)) if _is_usable_attendance_event(event)]
		if not items:
			empty_raw_records += 1
		for event in items:
			user_id = str(_first(event, "userId", "userid", "user_id") or raw.dingtalk_userid or "")
			# The raw record's business_date is authoritative.  DingTalk can return
			# an off-duty punch after midnight for the previous day's night shift.
			if user_id:
				grouped[user_id].append(event)

	drafts = rejected = 0
	for user_id, events in grouped.items():
		row = _draft_row(company, day, user_id, events)
		row["_raw_events"] = events
		created_name = attendance._insert_day_check(
			batch.name,
			row,
			company,
			API_SOURCE_KIND,
			"钉钉 API / 每日考勤",
			attendance._correction_version_for_import(company, day.strftime("%Y-%m")),
			allow_unmatched=True,
		)
		if created_name:
			drafts += 1
		else:
			rejected += 1

	new_checks = frappe.get_all(
		DAY_CHECK_DOCTYPE,
		filters={"import_batch": batch.name, "source_kind": API_SOURCE_KIND},
		fields=["name", *DAILY_RESYNC_COMPARE_FIELDS],
		limit_page_length=0,
	)
	diff = _compare_daily_check_versions(old_checks, new_checks)
	manual_rows = frappe.get_all(
		DAY_CHECK_DOCTYPE,
		filters={"company": company, "attendance_date": day, "source_kind": "人工调整"},
		fields=["name", "employee", "employee_code", "user_id"],
		limit_page_length=0,
	)
	manual_identities = {_daily_check_identity(row) for row in manual_rows if _daily_check_identity(row)}
	manual_conflicts = sorted(manual_identities & set(diff["affected"]))
	change_detected = bool(diff["affected"])
	closure_result = (
		_invalidate_daily_closure_after_resync(company, day, resync_reason, allow_locked_day_resync)
		if change_detected and old_checks
		else {"invalidated": False, "previous_status": ""}
	)

	batch.daily_sheet_rows = drafts
	batch.status = "已导入"
	batch.notes = json.dumps(
		{
			"business_date": str(day),
			"source": "DingTalk API",
			"raw_records": len(raw_records),
			"usable_clock_records": len(raw_records) - empty_raw_records,
			"empty_clock_detail_records": empty_raw_records,
			"drafts": drafts,
			"rejected": rejected,
			"new_drafts": len(diff["created"]),
			"changed_drafts": len(diff["changed"]),
			"removed_drafts": len(diff["removed"]),
			"unchanged_drafts": len(diff["unchanged"]),
			"manual_conflicts": len(manual_conflicts),
			"resync_reason": (resync_reason or "").strip(),
		},
		ensure_ascii=False,
	)
	batch.save(ignore_permissions=True)
	exceptions = attendance.generate_attendance_exceptions(batch.name) if drafts else {"created": 0}
	restored_exception_reviews = _restore_unchanged_exception_reviews(batch.name, old_exceptions, diff["unchanged"])
	frappe.db.commit()
	return {
		"batch": batch.name,
		"raw_records": len(raw_records),
		"usable_clock_records": len(raw_records) - empty_raw_records,
		"empty_clock_detail_records": empty_raw_records,
		"created": len(diff["created"]),
		"updated": len(diff["changed"]) + len(diff["removed"]),
		"unchanged": len(diff["unchanged"]),
		"drafts": drafts,
		"rejected": rejected,
		"exceptions": exceptions.get("created", 0),
		"restored_exception_reviews": restored_exception_reviews,
		"manual_conflicts": len(manual_conflicts),
		"change_detected": change_detected,
		"closure": closure_result,
	}
