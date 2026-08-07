# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# License: GNU General Public License v3. See license.txt

from __future__ import annotations

import frappe
from frappe.utils import getdate, nowdate


PERSONNEL_STATUS_FIELD = "custom_personnel_status"
PERSONNEL_STATUS_OPTIONS = ("在职", "试用期", "退休返聘", "待离职", "已离职")


def derive_personnel_status(
	*,
	status=None,
	employment_type=None,
	custom_is_confirmed=None,
	final_confirmation_date=None,
	relieving_date=None,
	reference_date=None,
):
	"""Return the single business-facing personnel status for an Employee."""
	reference_date = getdate(reference_date or nowdate())
	relieving_date = getdate(relieving_date) if relieving_date else None
	final_confirmation_date = getdate(final_confirmation_date) if final_confirmation_date else None

	if status == "Left" or (relieving_date and relieving_date <= reference_date):
		return "已离职"
	if relieving_date and relieving_date > reference_date:
		return "待离职"
	if status == "Inactive":
		return "待离职"

	employment_type = str(employment_type or "").strip().casefold()
	if employment_type in {"retainer", "rehired", "退休返聘", "返聘"}:
		return "退休返聘"
	if str(custom_is_confirmed or "").strip() == "否":
		return "试用期"
	if final_confirmation_date and final_confirmation_date > reference_date:
		return "试用期"
	return "在职"


def sync_employee_personnel_status(doc, method=None):
	"""Keep the stored status in sync whenever Employee is validated."""
	if not doc.meta.get_field(PERSONNEL_STATUS_FIELD):
		return

	doc.set(
		PERSONNEL_STATUS_FIELD,
		derive_personnel_status(
			status=doc.get("status"),
			employment_type=doc.get("employment_type"),
			custom_is_confirmed=doc.get("custom_is_confirmed"),
			final_confirmation_date=doc.get("final_confirmation_date"),
			relieving_date=doc.get("relieving_date"),
		),
	)


def _publish_status_update(employee, personnel_status):
	frappe.publish_realtime(
		"hrms_employee_personnel_status_updated",
		{"employee": employee, "personnel_status": personnel_status},
		after_commit=True,
	)


def _save_employee_status(employee_name, relieving_date=None, clear_relieving_date=False):
	employee = frappe.get_doc("Employee", employee_name)
	if clear_relieving_date:
		employee.relieving_date = None
	elif relieving_date:
		employee.relieving_date = relieving_date

	reference_date = getdate(nowdate())
	effective_relieving_date = getdate(employee.relieving_date) if employee.relieving_date else None
	if effective_relieving_date and effective_relieving_date <= reference_date:
		employee.status = "Left"
	elif employee.status == "Left":
		employee.status = "Active"

	employee.flags.ignore_permissions = True
	employee.save()
	_publish_status_update(employee.name, employee.get(PERSONNEL_STATUS_FIELD))
	return employee


def sync_employee_separation_status(doc, method=None):
	"""A submitted separation is the source of truth for the relieving date."""
	if not doc.employee or not doc.boarding_begins_on:
		return
	_save_employee_status(doc.employee, relieving_date=doc.boarding_begins_on)


def cancel_employee_separation_status(doc, method=None):
	"""Recalculate Employee when a previously submitted separation is cancelled."""
	if not doc.employee:
		return

	other = frappe.get_all(
		"Employee Separation",
		filters={"employee": doc.employee, "docstatus": 1, "name": ["!=", doc.name]},
		fields=["boarding_begins_on"],
		order_by="boarding_begins_on desc",
		limit_page_length=1,
	)
	if other:
		_save_employee_status(doc.employee, relieving_date=other[0].boarding_begins_on)
		return

	current_relieving_date = frappe.db.get_value("Employee", doc.employee, "relieving_date")
	clear_relieving_date = bool(
		current_relieving_date
		and doc.boarding_begins_on
		and getdate(current_relieving_date) == getdate(doc.boarding_begins_on)
	)
	_save_employee_status(doc.employee, clear_relieving_date=clear_relieving_date)


def sync_due_employee_personnel_statuses():
	"""Backfill and advance the single business-facing Employee status.

	Submitted Employee Separation records remain authoritative for the effective
	date.  Reading them here also repairs older records that predate the document
	event hook, while the same function remains safe to run every day.
	"""
	meta = frappe.get_meta("Employee")
	if not meta.get_field(PERSONNEL_STATUS_FIELD):
		return {"updated": 0, "counts": {status: 0 for status in PERSONNEL_STATUS_OPTIONS}}

	fields = ["name", "status", PERSONNEL_STATUS_FIELD]
	for fieldname in ("employment_type", "final_confirmation_date", "relieving_date", "custom_is_confirmed"):
		if meta.get_field(fieldname):
			fields.append(fieldname)

	separation_dates = {}
	if frappe.db.exists("DocType", "Employee Separation"):
		for row in frappe.get_all(
			"Employee Separation",
			filters={"docstatus": 1},
			fields=["employee", "boarding_begins_on"],
			order_by="boarding_begins_on asc",
			limit_page_length=0,
		):
			if row.employee and row.boarding_begins_on:
				separation_dates[row.employee] = row.boarding_begins_on

	updated = 0
	counts = {status: 0 for status in PERSONNEL_STATUS_OPTIONS}
	for employee in frappe.get_all("Employee", fields=fields, limit_page_length=0):
		relieving_date = separation_dates.get(employee.name) or employee.get("relieving_date")
		personnel_status = derive_personnel_status(
			status=employee.get("status"),
			employment_type=employee.get("employment_type"),
			custom_is_confirmed=employee.get("custom_is_confirmed"),
			final_confirmation_date=employee.get("final_confirmation_date"),
			relieving_date=relieving_date,
		)
		counts[personnel_status] += 1
		values = {}
		if employee.get(PERSONNEL_STATUS_FIELD) != personnel_status:
			values[PERSONNEL_STATUS_FIELD] = personnel_status
		if meta.get_field("relieving_date") and relieving_date and employee.get("relieving_date") != relieving_date:
			values["relieving_date"] = relieving_date
		if personnel_status == "已离职" and employee.get("status") != "Left":
			values["status"] = "Left"
		elif personnel_status != "已离职" and employee.get("status") == "Left" and relieving_date and getdate(relieving_date) > getdate(nowdate()):
			values["status"] = "Active"
		if not values:
			continue
		frappe.db.set_value("Employee", employee.name, values, update_modified=False)
		_publish_status_update(employee.name, personnel_status)
		updated += 1

	return {"updated": updated, "counts": counts}
