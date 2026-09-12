# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.utils import add_days, getdate

from hrms.hr.doctype.employee_separation.employee_separation import (
	approve_employee_separation,
	process_due_employee_separations,
)

from hrms.tests.utils import HRMSTestSuite


class TestEmployeeSeparation(HRMSTestSuite):
	def test_employee_separation(self):
		employee = frappe.db.get_value("Employee", {"status": "Active", "company": "_Test Company"})
		separation = create_employee_separation(employee, submit=False)

		draft_employee = frappe.get_doc("Employee", employee)
		self.assertEqual(draft_employee.status, "Active")

		# Submission only enters the approval queue.
		separation.submit()

		self.assertEqual(separation.docstatus, 1)
		self.assertEqual(separation.boarding_status, "Pending")
		self.assertFalse(separation.project)
		pending_employee = frappe.get_doc("Employee", employee)
		self.assertEqual(pending_employee.status, "Active")

		# Approval is a separate System Manager action and may be performed by the
		# same highest-level account that submitted the application.
		approve_employee_separation(separation.name)
		separation.reload()
		self.assertEqual(separation.boarding_status, "Completed")
		if separation.meta.has_field("approved_by"):
			self.assertEqual(separation.approved_by, frappe.session.user)

		pending_departure = frappe.get_doc("Employee", employee)
		self.assertEqual(pending_departure.status, "Inactive")
		self.assertEqual(pending_departure.relieving_date, separation.boarding_begins_on)
		if pending_departure.meta.has_field("custom_work_nature"):
			self.assertEqual(pending_departure.custom_work_nature, "待离职")

		# Once the approved departure date arrives, the scheduled transition makes
		# the same employee a departed employee.
		frappe.db.set_value("Employee Separation", separation.name, "boarding_begins_on", getdate())
		process_due_employee_separations()
		departed_employee = frappe.get_doc("Employee", employee)
		self.assertEqual(departed_employee.status, "Left")
		self.assertEqual(departed_employee.relieving_date, getdate())
		if departed_employee.meta.has_field("custom_work_nature"):
			self.assertEqual(departed_employee.custom_work_nature, "离职")


def create_employee_separation(employee=None, submit=True):
	employee = employee or frappe.db.get_value("Employee", {"status": "Active", "company": "_Test Company"})
	separation = frappe.new_doc("Employee Separation")
	separation.employee = employee
	separation.boarding_begins_on = add_days(getdate(), 1)
	separation.company = "_Test Company"
	separation.separation_reason_type = "主动离职"
	separation.separation_reason = "个人原因"
	separation.append("activities", {"activity_name": "Deactivate Employee", "role": "HR User"})
	separation.boarding_status = "Pending"
	separation.insert()
	if submit:
		separation.submit()
	return separation
