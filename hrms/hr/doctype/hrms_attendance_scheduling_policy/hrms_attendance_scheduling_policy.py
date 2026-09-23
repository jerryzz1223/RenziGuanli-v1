from __future__ import annotations

from datetime import timedelta

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_months, cint, flt, getdate, nowdate


DOCTYPE = "HRMS Attendance Scheduling Policy"


def _scope_values(value) -> tuple[str, ...]:
	return tuple(part.strip() for part in str(value or "").replace("\n", "|").replace(",", "|").split("|") if part.strip())


def _scope_rank(scope_type: str) -> int:
	return {"全公司": 1, "部门": 2, "员工": 3}.get(scope_type or "", 0)


def _time_minutes(value) -> int:
	if isinstance(value, timedelta):
		return int(value.total_seconds() // 60)
	if hasattr(value, "hour"):
		return int(value.hour) * 60 + int(value.minute)
	parts = str(value or "0:0").split(":")
	return int(parts[0] or 0) * 60 + int(parts[1] or 0)


def shift_duration_hours(start_time, end_time) -> float:
	start = _time_minutes(start_time)
	end = _time_minutes(end_time)
	if end <= start:
		end += 24 * 60
	return (end - start) / 60


def linked_shift_hours(company: str, shift_type: str, start_time=None, end_time=None, day_type="workday") -> float:
	"""Prefer the workbook's governed hours over a Shift Type's outer clock span.

	This matters for split shifts (for example 08:00-13:00 and 15:30-18:00),
	which a native Shift Type can only represent as one outer interval.
	"""
	if frappe.db.exists("DocType", "HRMS Attendance Shift Rule"):
		rule = frappe.db.get_value(
			"HRMS Attendance Shift Rule",
			{"company": company, "shift_type": shift_type, "enabled": 1},
			["basic_hours", "weekday_overtime_hours", "weekday_overtime_mode"],
			as_dict=True,
		)
		if rule:
			hours = flt(rule.basic_hours)
			if day_type == "workday" and rule.weekday_overtime_mode == "不提交加班单":
				hours += flt(rule.weekday_overtime_hours)
			return hours
	if start_time is None or end_time is None:
		times = frappe.db.get_value("Shift Type", shift_type, ["start_time", "end_time"], as_dict=True)
		if not times:
			return 0
		start_time, end_time = times.start_time, times.end_time
	return shift_duration_hours(start_time, end_time)


class HRMSAttendanceSchedulingPolicy(Document):
	def validate(self):
		self.policy_name = (self.policy_name or "").strip()
		self.scope_values = "|".join(_scope_values(self.scope_values))
		self.calendar_weekend_mode = self.calendar_weekend_mode or "休息日加班口径"
		if self.calendar_weekend_mode not in {"休息日加班口径", "按工作日考勤"}:
			frappe.throw(_("普通周六日考勤口径不受支持。"))
		if self.scope_type not in {"全公司", "部门", "员工"}:
			frappe.throw(_("适用范围只能选择全公司、部门或员工。"))
		if self.scope_type == "全公司":
			self.scope_values = ""
		elif not self.scope_values:
			frappe.throw(_("部门或员工范围必须填写适用对象。"))
		if self.effective_to and getdate(self.effective_to) < getdate(self.effective_from):
			frappe.throw(_("生效结束日不能早于生效开始日。"))
		for fieldname in (
			"max_workday_hours", "max_restday_hours", "max_holiday_hours", "max_daily_hours",
			"consecutive_gap_minutes", "past_change_months", "future_change_days",
		):
			if flt(getattr(self, fieldname, 0)) < 0:
				frappe.throw(_("排班上限、间隔和可修改范围不能小于 0。"))
		if cint(self.merge_consecutive_shifts) and not cint(self.allow_multiple_shifts):
			frappe.throw(_("开启连班合并前，必须先允许一天多班次。"))
		if self.scope_type == "员工":
			for employee_code in _scope_values(self.scope_values):
				if not frappe.db.exists("Employee", {"company": self.company, "custom_employee_code": employee_code}):
					frappe.throw(_("适用员工必须使用公司工号：{0}").format(employee_code))
		if self.scope_type == "部门":
			for department in _scope_values(self.scope_values):
				if not frappe.db.exists("Department", {"company": self.company, "name": department}):
					frappe.throw(_("适用部门不属于当前公司或不存在：{0}").format(department))


def get_applicable_scheduling_policy(employee: str, company: str, on_date) -> dict | None:
	if not frappe.db.exists("DocType", DOCTYPE):
		return None
	on_date = getdate(on_date)
	employee_row = frappe.db.get_value(
		"Employee", employee, ["department", "custom_employee_code"], as_dict=True
	) or frappe._dict()
	rows = frappe.get_all(
		DOCTYPE,
		filters={"company": company, "enabled": 1, "effective_from": ["<=", on_date]},
		fields=["*"],
		order_by="priority desc, modified desc",
		limit_page_length=500,
	)
	matched = []
	for row in rows:
		if row.get("effective_to") and getdate(row.effective_to) < on_date:
			continue
		values = _scope_values(row.get("scope_values"))
		if row.scope_type == "部门" and str(employee_row.get("department") or "") not in values:
			continue
		if row.scope_type == "员工" and str(employee_row.get("custom_employee_code") or "") not in values:
			continue
		matched.append(dict(row))
	matched.sort(key=lambda row: (_scope_rank(row.get("scope_type")), cint(row.get("priority"))), reverse=True)
	return matched[0] if matched else None


def _day_type(employee: str, on_date) -> str:
	from hrms.utils.holiday_list import get_holiday_list_for_employee

	holiday_list = get_holiday_list_for_employee(employee, raise_exception=False, as_on=on_date)
	if not holiday_list:
		return "workday"
	weekly_off = frappe.db.get_value(
		"Holiday", {"parent": holiday_list, "holiday_date": getdate(on_date)}, "weekly_off"
	)
	if weekly_off is None:
		return "workday"
	return "restday" if cint(weekly_off) else "holiday"


def policy_allows_multiple_shifts(employee: str, company: str, on_date) -> bool | None:
	policy = get_applicable_scheduling_policy(employee, company, on_date)
	return None if not policy else bool(cint(policy.get("allow_multiple_shifts")))


def merged_consecutive_shift_for_checkin(employee: str, company: str, timestamp, shifts):
	"""Return one combined punch window for two adjacent assigned shifts."""
	from hrms.hr.doctype.shift_assignment.shift_assignment import get_exact_shift

	policy = get_applicable_scheduling_policy(employee, company, getdate(timestamp))
	if not policy or not cint(policy.get("merge_consecutive_shifts")):
		return get_exact_shift(shifts, timestamp)
	gap_limit = cint(policy.get("consecutive_gap_minutes"))
	previous, current, following = shifts
	if previous and current:
		gap = (current.start_datetime - previous.end_datetime).total_seconds() / 60
		if 0 <= gap <= gap_limit and previous.actual_start <= timestamp <= current.actual_end:
			previous.end_datetime = current.end_datetime
			previous.actual_end = current.actual_end
			return previous
	if current and following:
		gap = (following.start_datetime - current.end_datetime).total_seconds() / 60
		if 0 <= gap <= gap_limit and current.actual_start <= timestamp <= following.actual_end:
			current.end_datetime = following.end_datetime
			current.actual_end = following.actual_end
			return current
	return get_exact_shift(shifts, timestamp)


def unscheduled_punch_mode(employee: str, company: str, on_date) -> str:
	policy = get_applicable_scheduling_policy(employee, company, on_date)
	return str((policy or {}).get("unscheduled_punch_mode") or "选择班次打卡或直接打卡")


def validate_shift_assignment_policy(assignment) -> None:
	policy = get_applicable_scheduling_policy(assignment.employee, assignment.company, assignment.start_date)
	if not policy:
		return
	start_date = getdate(assignment.start_date)
	end_date = getdate(assignment.end_date or assignment.start_date)
	today = getdate(nowdate())
	existing_on_start_date = frappe.get_all(
		"Shift Assignment",
		filters={
			"employee": assignment.employee,
			"docstatus": 1,
			"status": "Active",
			"start_date": ["<=", start_date],
		},
		or_filters=[["end_date", ">=", start_date], ["end_date", "is", "not set"]],
		pluck="name",
		limit_page_length=1,
	)
	is_expired_unscheduled_fill = cint(policy.get("allow_expired_unscheduled_change")) and not existing_on_start_date
	if start_date < getdate(add_months(today, -cint(policy.get("past_change_months")))) and not is_expired_unscheduled_fill:
		frappe.throw(_("排班日期超出规则“{0}”允许修改的过去 {1} 个月。").format(policy["policy_name"], policy.get("past_change_months")))
	if start_date > today + timedelta(days=cint(policy.get("future_change_days"))):
		frappe.throw(_("排班日期超出规则“{0}”允许修改的未来 {1} 天。").format(policy["policy_name"], policy.get("future_change_days")))
	shift = frappe.db.get_value("Shift Type", assignment.shift_type, ["start_time", "end_time"], as_dict=True)
	if not shift:
		return
	if (end_date - start_date).days > 366:
		frappe.throw(_("单次排班周期不能超过 366 天，请按年度拆分。"))
	day = start_date
	while day <= end_date:
		day_type = _day_type(assignment.employee, day)
		shift_hours = linked_shift_hours(assignment.company, assignment.shift_type, shift.start_time, shift.end_time, day_type)
		allowed = cint(policy.get(f"allow_{day_type}"))
		limit = flt(policy.get(f"max_{day_type}_hours"))
		labels = {"workday": "工作日", "restday": "休息日", "holiday": "节假日"}
		if not allowed:
			frappe.throw(_("规则“{0}”不允许在 {1} 排班：{2}。").format(policy["policy_name"], labels[day_type], day))
		if limit and shift_hours > limit:
			frappe.throw(_("班次 {0} 小时超过规则“{1}”的{2}上限 {3} 小时。").format(shift_hours, policy["policy_name"], labels[day_type], limit))
		max_daily_hours = flt(policy.get("max_daily_hours"))
		if max_daily_hours:
			existing_hours = 0.0
			assignments = frappe.get_all(
				"Shift Assignment",
				filters={
					"employee": assignment.employee,
					"docstatus": 1,
					"status": "Active",
					"name": ["!=", assignment.name or ""],
					"start_date": ["<=", day],
				},
				or_filters=[["end_date", ">=", day], ["end_date", "is", "not set"]],
				fields=["shift_type"],
				limit_page_length=50,
			)
			for existing in assignments:
				times = frappe.db.get_value("Shift Type", existing.shift_type, ["start_time", "end_time"], as_dict=True)
				if times:
					existing_hours += linked_shift_hours(assignment.company, existing.shift_type, times.start_time, times.end_time, day_type)
			if existing_hours + shift_hours > max_daily_hours:
				frappe.throw(_("该员工在 {0} 的累计排班 {1} 小时超过规则“{2}”的每日上限 {3} 小时。").format(day, existing_hours + shift_hours, policy["policy_name"], max_daily_hours))
		day += timedelta(days=1)
	if not cint(policy.get("allow_change_after_checkin")) and not assignment.is_new():
		if frappe.db.exists("Employee Checkin", {"employee": assignment.employee, "time": ["between", [start_date, end_date + timedelta(days=2)]]}):
			frappe.throw(_("规则“{0}”不允许在已有打卡后修改班次。").format(policy["policy_name"]))
