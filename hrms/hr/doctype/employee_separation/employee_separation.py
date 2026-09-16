# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


from datetime import datetime
from zoneinfo import ZoneInfo

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import (
	get_datetime,
	get_datetime_in_timezone,
	get_system_timezone,
	getdate,
	now_datetime,
)


SEPARATION_REASONS_BY_TYPE = {
	"主动离职": {"家庭原因", "个人原因", "发展原因", "合同到期不续签", "其他"},
	"被动离职": {"协议解除", "无法胜任工作", "经济性裁员", "严重违法违纪", "其他"},
}


class EmployeeSeparation(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		from hrms.hr.doctype.employee_boarding_activity.employee_boarding_activity import (
			EmployeeBoardingActivity,
		)

		activities: DF.Table[EmployeeBoardingActivity]
		approved_by: DF.Link | None
		approved_on: DF.Datetime | None
		applied_on: DF.Datetime | None
		applied_by: DF.Link | None
		approver_custom_reason: DF.SmallText | None
		approver_reason: DF.Data | None
		approver_reason_detail: DF.SmallText | None
		approver_reason_type: DF.Literal["主动离职", "被动离职", "自定义"] | None
		amended_from: DF.Link | None
		boarding_begins_on: DF.Date
		boarding_status: DF.Literal["Pending", "In Process", "Completed"]
		company: DF.Link
		department: DF.Link | None
		departed_on: DF.Datetime | None
		departed_by: DF.Link | None
		designation: DF.Link | None
		employee: DF.Link
		employee_code_display: DF.Data | None
		employee_grade: DF.Link | None
		employee_name: DF.Data | None
		employee_separation_template: DF.Link | None
		exit_interview: DF.TextEditor | None
		notify_users_by_email: DF.Check
		project: DF.Link | None
		resignation_letter_date: DF.Date | None
		separation_reason: (
			DF.Literal[
				"家庭原因",
				"个人原因",
				"发展原因",
				"合同到期不续签",
				"其他",
				"协议解除",
				"无法胜任工作",
				"经济性裁员",
				"严重违法违纪",
			]
			| None
		)
		separation_reason_type: DF.Literal["主动离职", "被动离职", "自定义"]
		custom_separation_reason: DF.SmallText | None
		separation_reason_detail: DF.SmallText | None
	# end: auto-generated types

	def validate(self):
		self._sync_employee_business_identity()
		self._validate_separation_reason()

	def _validate_separation_reason(self):
		self.separation_reason_detail = (self.separation_reason_detail or "").strip() or None
		if self.separation_reason_type == "自定义":
			self.separation_reason = None
			self.custom_separation_reason = (self.custom_separation_reason or "").strip()
			if not self.custom_separation_reason:
				frappe.throw(_("选择“自定义”时，请填写自定义离职原因。"))
			return

		valid_reasons = SEPARATION_REASONS_BY_TYPE.get(self.separation_reason_type)
		if not valid_reasons:
			frappe.throw(_("请选择离职原因分类：主动离职、被动离职或自定义。"))

		self.custom_separation_reason = None
		if self.separation_reason not in valid_reasons:
			frappe.throw(_("请选择与“{0}”对应的离职原因。").format(self.separation_reason_type))

	def on_submit(self):
		# Submission sends the application to the approval queue. It is not the
		# approval action and must not change the employee's work nature.
		if not self.applied_on:
			self.applied_on = now_datetime()
		values = {"boarding_status": "Pending", "applied_on": self.applied_on}
		if self.meta.has_field("applied_by"):
			self.applied_by = frappe.session.user
			values["applied_by"] = self.applied_by
		self.db_set(values)

	def on_update_after_submit(self):
		pass

	def on_cancel(self):
		# 自定义离职流程不创建或清理 HRMS 原生项目、任务和活动。
		self.db_set("boarding_status", "Pending")

	def _sync_employee_business_identity(self):
		if not self.employee:
			return

		employee = frappe.get_cached_doc("Employee", self.employee)
		self.employee_code_display = (
			getattr(employee, "custom_employee_code", None)
			or self.employee_code_display
		)
		self.employee_name = employee.employee_name
		self.company = employee.company
		self.department = employee.department
		self.designation = employee.designation
		self.employee_grade = getattr(employee, "grade", None)

	def _set_employee_departure_state(self):
		if not self.employee or not frappe.db.exists("Employee", self.employee):
			return False

		employee = frappe.get_doc("Employee", self.employee)
		actual_departure_time = get_datetime(self.departed_on) if self.departed_on else None
		is_departed = bool(actual_departure_time and actual_departure_time <= _current_system_datetime())
		work_nature = "离职" if is_departed else "待离职"
		if employee.meta.has_field("custom_work_nature"):
			employee.custom_work_nature = work_nature

		# Keep the standard fields correct even on sites that have not installed
		# the public work-nature field yet. EmployeeMaster.validate() will apply
		# the same mapping when that field is present.
		employee.status = "Left" if is_departed else "Inactive"
		employee.relieving_date = getdate(actual_departure_time) if actual_departure_time else None

		employee.flags.ignore_permissions = True
		employee.save()
		return True

	def _set_employee_pending_state(self):
		"""Keep an approved separation pending until actual time is entered."""
		if not self.employee or not frappe.db.exists("Employee", self.employee):
			return False

		employee = frappe.get_doc("Employee", self.employee)
		if employee.meta.has_field("custom_work_nature"):
			employee.custom_work_nature = "待离职"
		employee.status = "Inactive"
		employee.relieving_date = None
		employee.flags.ignore_permissions = True
		employee.save()
		return True


def _normalise_approver_reason(reason_type, reason, custom_reason, reason_detail):
	reason_type = str(reason_type or "").strip()
	reason = str(reason or "").strip()
	custom_reason = str(custom_reason or "").strip()
	reason_detail = str(reason_detail or "").strip() or None
	if reason_type == "自定义":
		if not custom_reason:
			frappe.throw(_("选择“自定义”时，请填写审批员确认的自定义离职原因。"))
		return {
			"approver_reason_type": reason_type,
			"approver_reason": None,
			"approver_custom_reason": custom_reason,
			"approver_reason_detail": reason_detail,
		}

	valid_reasons = SEPARATION_REASONS_BY_TYPE.get(reason_type)
	if not valid_reasons:
		frappe.throw(_("请填写审批员确认的离职原因分类。"))
	if reason not in valid_reasons:
		frappe.throw(_("请选择审批员确认的有效离职原因。"))
	return {
		"approver_reason_type": reason_type,
		"approver_reason": reason,
		"approver_custom_reason": None,
		"approver_reason_detail": reason_detail,
	}


@frappe.whitelist()
def record_employee_separation_actual_time(
	separation_name: str, actual_departure_time: str | None = None
):
	"""Record the one business-effective departure time and apply its state."""
	from hrms.access_control import require_hrms_capability

	require_hrms_capability("separation_effective", legacy_roles=("HR Manager",))
	frappe.db.sql(
		"SELECT name FROM `tabEmployee Separation` WHERE name=%s FOR UPDATE",
		(separation_name,),
	)
	separation = frappe.get_doc("Employee Separation", separation_name)
	if separation.docstatus != 1 or separation.boarding_status != "Completed":
		frappe.throw(_("只有审批通过的离职申请才能办理实际离职。"))

	actual_time = _parse_actual_departure_time(actual_departure_time)
	if not actual_time:
		frappe.throw(_("请填写实际离职时间。"))

	employee_status = frappe.db.get_value("Employee", separation.employee, "status")
	if employee_status == "Left":
		if separation.departed_on and get_datetime(separation.departed_on) == actual_time:
			return {"name": separation.name, "actual_departure_time": actual_time, "status": "离职"}
		frappe.throw(_("员工已正式离职，实际离职时间不可再次修改。"))

	separation.departed_on = actual_time
	values = {"departed_on": actual_time}
	if separation.meta.has_field("departed_by"):
		separation.departed_by = frappe.session.user
		values["departed_by"] = separation.departed_by
	separation.db_set(values, update_modified=False)
	separation._set_employee_departure_state()
	return {
		"name": separation.name,
		"actual_departure_time": actual_time,
		"status": "离职" if actual_time <= _current_system_datetime() else "待离职",
	}


@frappe.whitelist()
def approve_employee_separation(
	separation_name: str,
	approver_reason_type: str | None = None,
	approver_reason: str | None = None,
	approver_custom_reason: str | None = None,
	approver_reason_detail: str | None = None,
):
	"""Approve a submitted separation and move the employee into pending departure."""
	from hrms.access_control import require_hrms_capability

	require_hrms_capability("separation_approve", legacy_roles=("HR Manager",))
	frappe.db.sql(
		"SELECT name FROM `tabEmployee Separation` WHERE name=%s FOR UPDATE",
		(separation_name,),
	)
	separation = frappe.get_doc("Employee Separation", separation_name)
	if separation.docstatus != 1:
		frappe.throw(_("只有已提交的离职申请才能审批。"))
	if separation.boarding_status == "Completed":
		return {"name": separation.name, "status": "Completed", "already_approved": 1}
	if separation.boarding_status != "Pending":
		frappe.throw(_("当前离职申请不在待审批状态。"))

	approver_reason_values = _normalise_approver_reason(
		approver_reason_type,
		approver_reason,
		approver_custom_reason,
		approver_reason_detail,
	)
	separation._set_employee_pending_state()
	approved_on = now_datetime()
	values = {"boarding_status": "Completed", **approver_reason_values}
	if separation.meta.has_field("approved_by"):
		values["approved_by"] = frappe.session.user
	if separation.meta.has_field("approved_on"):
		values["approved_on"] = approved_on
	frappe.db.set_value("Employee Separation", separation.name, values)
	return {
		"name": separation.name,
		"status": "Completed",
		"approved_by": frappe.session.user,
		"approved_on": approved_on,
	}


def process_due_employee_separations():
	"""Move approved records to departed after their actual time arrives."""
	separations = frappe.get_all(
		"Employee Separation",
		filters={
			"docstatus": 1,
			"boarding_status": "Completed",
			"departed_on": ["is", "set"],
		},
		fields=["name", "employee"],
		limit_page_length=0,
	)
	updated = 0
	employee_fields = ["status"]
	if frappe.get_meta("Employee").has_field("custom_work_nature"):
		employee_fields.append("custom_work_nature")
	for row in separations:
		if not row.employee or not frappe.db.exists("Employee", row.employee):
			continue
		employee_state = frappe.db.get_value(
			"Employee", row.employee, employee_fields, as_dict=True
		)
		separation = frappe.get_doc("Employee Separation", row.name)
		if employee_state.get("status") == "Left" and separation.departed_on and (
			"custom_work_nature" not in employee_fields
			or employee_state.get("custom_work_nature") == "离职"
		):
			continue
		if separation.departed_on and get_datetime(separation.departed_on) <= _current_system_datetime() and separation._set_employee_departure_state():
			updated += 1

	return {"updated": updated}


def sync_employee_separation_business_identities():
	"""Backfill display-only employee identity fields on existing separation records."""
	updated = 0
	skipped = 0

	for row in frappe.get_all(
		"Employee Separation",
		fields=[
			"name",
			"employee",
			"employee_code_display",
			"employee_name",
			"company",
			"department",
			"designation",
			"employee_grade",
		],
	):
		if not row.employee or not frappe.db.exists("Employee", row.employee):
			skipped += 1
			continue

		employee = frappe.get_cached_doc("Employee", row.employee)
		values = {
			"employee_code_display": getattr(employee, "custom_employee_code", None),
			"employee_name": employee.employee_name,
			"company": employee.company,
			"department": employee.department,
			"designation": employee.designation,
			"employee_grade": getattr(employee, "grade", None),
		}
		changes = {fieldname: value for fieldname, value in values.items() if row.get(fieldname) != value}
		if not changes:
			continue

		frappe.db.set_value("Employee Separation", row.name, changes, update_modified=False)
		updated += 1

	frappe.db.commit()
	return {"updated": updated, "skipped": skipped}


def _operator_timezone():
	timezone = None
	try:
		timezone = frappe.db.get_value("User", frappe.session.user, "time_zone")
	except Exception:
		pass
	return timezone or get_system_timezone()


def _parse_actual_departure_time(value):
	"""Convert a browser-local time to Frappe's system-timezone storage value."""
	if not value:
		return None
	actual_time = get_datetime(value)
	system_timezone = ZoneInfo(get_system_timezone())
	if isinstance(value, datetime):
		if actual_time.tzinfo:
			return actual_time.astimezone(system_timezone).replace(tzinfo=None)
		# Internal callers already pass Frappe/system-timezone datetimes.
		return actual_time
	user_timezone = ZoneInfo(_operator_timezone())
	return (
		actual_time.replace(tzinfo=user_timezone)
		.astimezone(system_timezone)
		.replace(tzinfo=None)
	)


def _current_system_datetime():
	return get_datetime_in_timezone(get_system_timezone()).replace(tzinfo=None)
