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
API_SOURCE_TYPE = "dingtalk_api"
API_SOURCE_KIND = "钉钉API同步"


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


def _approval_references(company: str, user_id: str, business_date: date) -> list[str]:
	rows = frappe.get_all(
		RAW_DOCTYPE,
		filters={"company": company, "source_type": "approval", "dingtalk_userid": user_id, "business_date": business_date},
		fields=["external_id"],
		limit_page_length=0,
	)
	return [str(row.external_id) for row in rows if row.external_id]


def _draft_row(company: str, business_date: date, user_id: str, events: list[dict[str, Any]]) -> dict[str, Any]:
	mapping = _mapping(company, user_id)
	in_events = [event for event in events if _is_on_duty(event)]
	out_events = [event for event in events if _is_off_duty(event)]
	all_times = [item for item in (_event_time(event) for event in events) if item]
	in_time = min((_event_time(event) for event in in_events if _event_time(event)), default=None)
	out_time = max((_event_time(event) for event in out_events if _event_time(event)), default=None)
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
	approval_references = _approval_references(company, user_id, business_date)
	return {
		"工号": mapping.employee_code if mapping else _first(first_event, "jobNumber", "job_number", "employeeNo", "employee_code"),
		"姓名": mapping.employee_name if mapping else _first(first_event, "name", "employeeName", "employee_name") or f"钉钉用户-{user_id}",
		"UserId": user_id,
		"日期": str(business_date),
		"考勤组": _first(first_event, "groupName", "group_name", "attendanceGroup", "attendance_group"),
		"部门": mapping.department_name if mapping else _first(first_event, "departmentName", "department_name", "deptName"),
		"班次": _first(first_event, "className", "class_name", "shiftName", "shift_name"),
		"上班时间": _time_text(in_time),
		"下班时间": _time_text(out_time),
		"上班缺卡": missing_in,
		"下班缺卡": missing_out,
		"标准工时": standard_hours,
		"实际出勤(小时)": actual_hours,
		"关联审批单": "、".join(approval_references),
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


@frappe.whitelist()
def convert_dingtalk_raw_attendance_to_daily_checks(
	company: str,
	business_date: str,
	sync_log: str = "",
	enforce_role: bool = True,
) -> dict[str, Any]:
	"""Build replaceable daily-check drafts from raw API payloads for one company/date."""
	_require_manager(enforce_role)
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
	old_exceptions = frappe.get_all(EXCEPTION_DOCTYPE, filters={"import_batch": batch.name}, pluck="name")
	for name in old_exceptions:
		frappe.delete_doc(EXCEPTION_DOCTYPE, name, ignore_permissions=True, force=True)
	old_checks = frappe.get_all(DAY_CHECK_DOCTYPE, filters={"import_batch": batch.name, "source_kind": API_SOURCE_KIND}, pluck="name")
	for name in old_checks:
		frappe.delete_doc(DAY_CHECK_DOCTYPE, name, ignore_permissions=True, force=True)

	grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
	empty_raw_records = 0
	for raw in raw_records:
		items = [event for event in _nested_items(_payload(raw.payload_json)) if _is_usable_attendance_event(event)]
		if not items:
			empty_raw_records += 1
		for event in items:
			user_id = str(_first(event, "userId", "userid", "user_id") or raw.dingtalk_userid or "")
			if user_id and _event_day(event, day) == day:
				grouped[user_id].append(event)

	created = rejected = 0
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
			created += 1
		else:
			rejected += 1

	batch.daily_sheet_rows = created
	batch.status = "已导入"
	batch.notes = json.dumps(
		{
			"business_date": str(day),
			"source": "DingTalk API",
			"raw_records": len(raw_records),
			"usable_clock_records": len(raw_records) - empty_raw_records,
			"empty_clock_detail_records": empty_raw_records,
			"drafts": created,
			"rejected": rejected,
		},
		ensure_ascii=False,
	)
	batch.save(ignore_permissions=True)
	exceptions = attendance.generate_attendance_exceptions(batch.name) if created else {"created": 0}
	frappe.db.commit()
	return {
		"batch": batch.name,
		"raw_records": len(raw_records),
		"usable_clock_records": len(raw_records) - empty_raw_records,
		"empty_clock_detail_records": empty_raw_records,
		"created": created,
		"updated": 0,
		"rejected": rejected,
		"exceptions": exceptions.get("created", 0),
	}
