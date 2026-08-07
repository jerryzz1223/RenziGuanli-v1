# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


import frappe

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
		self.db_set("boarding_status", "Completed")

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
			or getattr(employee, "employee_number", None)
			or self.employee_code_display
		)
		self.employee_name = employee.employee_name
		self.company = employee.company
		self.department = employee.department
		self.designation = employee.designation
		self.employee_grade = getattr(employee, "grade", None)


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
			"employee_code_display": getattr(employee, "custom_employee_code", None)
			or getattr(employee, "employee_number", None),
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
