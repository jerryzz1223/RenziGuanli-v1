# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# License: GNU General Public License v3. See license.txt

"""Turn eligible trial employees into confirmed employees on their due date."""

from __future__ import annotations

import frappe
from frappe.utils import getdate, nowdate


AUTO_CONFIRMATION_NOTE = "系统根据转正日期自动办理转正。"
REQUIRED_EMPLOYEE_FIELDS = ("custom_is_confirmed", "final_confirmation_date")
REQUIRED_PROMOTION_FIELDS = (
	"custom_is_confirmation_interview",
	"custom_confirmation_interview_date",
	"custom_confirmation_interviewer",
	"custom_confirmation_interview_notes",
	"custom_confirmation_result",
)


def process_due_employee_confirmations():
	"""Submit one auditable Employee Promotion for every due trial employee.

	Creating the standard promotion document (rather than directly updating
	Employee) keeps the employee change history and the detail-page timeline in
	the same format as a manually completed confirmation.
	"""
	if not _has_required_fields("Employee", REQUIRED_EMPLOYEE_FIELDS):
		return {"updated": 0, "skipped": "confirmation_fields_unavailable"}
	if not _has_required_fields("Employee Promotion", REQUIRED_PROMOTION_FIELDS):
		return {"updated": 0, "skipped": "promotion_confirmation_fields_unavailable"}

	today = getdate(nowdate())
	employees = frappe.get_all(
		"Employee",
		filters={
			"status": "Active",
			"custom_is_confirmed": "否",
			"final_confirmation_date": ["<=", today],
		},
		fields=["name", "company", "department", "final_confirmation_date"],
		limit_page_length=0,
	)
	updated = 0
	for employee in employees:
		if _has_submitted_confirmation(employee.name, employee.final_confirmation_date):
			continue
		promotion = frappe.get_doc(
			{
				"doctype": "Employee Promotion",
				"employee": employee.name,
				"company": employee.company,
				"department": employee.department,
				"promotion_date": employee.final_confirmation_date,
				"custom_is_confirmation_interview": 1,
				"custom_confirmation_interview_date": employee.final_confirmation_date,
				"custom_confirmation_interviewer": "系统自动",
				"custom_confirmation_interview_notes": AUTO_CONFIRMATION_NOTE,
				"custom_confirmation_result": "转正通过",
				"promotion_details": [
					{
						"property": "是否转正",
						"fieldname": "custom_is_confirmed",
						"current": "否",
						"new": "是",
					},
					{
						"property": "转正日期",
						"fieldname": "final_confirmation_date",
						"current": employee.final_confirmation_date,
						"new": employee.final_confirmation_date,
					},
				],
			}
		)
		promotion.flags.ignore_permissions = True
		promotion.insert(ignore_permissions=True)
		promotion.submit()
		updated += 1

	return {"updated": updated}


def _has_required_fields(doctype, fieldnames):
	meta = frappe.get_meta(doctype)
	return all(meta.get_field(fieldname) for fieldname in fieldnames)


def _has_submitted_confirmation(employee, confirmation_date):
	return bool(
		frappe.db.exists(
			"Employee Promotion",
			{
				"employee": employee,
				"docstatus": 1,
				"promotion_date": confirmation_date,
				"custom_confirmation_result": "转正通过",
			},
		)
	)
