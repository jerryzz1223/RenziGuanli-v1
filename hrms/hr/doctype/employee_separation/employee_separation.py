# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


import frappe
from frappe import _
from frappe.utils import getdate, now_datetime, nowdate

from hrms.controllers.employee_boarding_controller import EmployeeBoardingController


class EmployeeSeparation(EmployeeBoardingController):
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
		amended_from: DF.Link | None
		boarding_begins_on: DF.Date
		boarding_status: DF.Literal["Pending", "In Process", "Completed"]
		company: DF.Link
		department: DF.Link | None
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
	# end: auto-generated types

	def validate(self):
		self._sync_employee_business_identity()

	def on_submit(self):
		# Submission sends the application to the approval queue. It is not the
		# approval action and must not change the employee's work nature.
		self.db_set("boarding_status", "Pending")

	def on_update_after_submit(self):
		pass

	def on_cancel(self):
		# 兼容历史离职单：旧流程创建过项目/任务时仍负责清理。
		if self.project and frappe.db.exists("Project", self.project):
			super().on_cancel()
		else:
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
		departure_date = getdate(self.boarding_begins_on)
		is_departed = departure_date <= getdate(nowdate())
		work_nature = "离职" if is_departed else "待离职"
		if employee.meta.has_field("custom_work_nature"):
			employee.custom_work_nature = work_nature

		# Keep the standard fields correct even on sites that have not installed
		# the public work-nature field yet. EmployeeMaster.validate() will apply
		# the same mapping when that field is present.
		employee.status = "Left" if is_departed else "Inactive"
		employee.relieving_date = departure_date

		employee.flags.ignore_permissions = True
		employee.save()
		return True


@frappe.whitelist()
def approve_employee_separation(separation_name: str):
	"""Approve a submitted separation and only then make departure effective."""
	frappe.only_for("System Manager")
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

	separation._set_employee_departure_state()
	approved_on = now_datetime()
	values = {"boarding_status": "Completed"}
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
	"""Move approved pending departures to departed on their departure date."""
	today = getdate(nowdate())
	separations = frappe.get_all(
		"Employee Separation",
		filters={
			"docstatus": 1,
			"boarding_status": "Completed",
			"boarding_begins_on": ["<=", today],
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
		if employee_state.get("status") == "Left" and (
			"custom_work_nature" not in employee_fields
			or employee_state.get("custom_work_nature") == "离职"
		):
			continue
		if frappe.get_doc("Employee Separation", row.name)._set_employee_departure_state():
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
