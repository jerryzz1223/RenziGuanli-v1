import frappe


def execute():
	"""Move legacy submitted-but-not-departed forms into the approval queue."""
	meta = frappe.get_meta("Employee Separation")
	if not meta.has_field("boarding_status"):
		return

	for row in frappe.get_all(
		"Employee Separation",
		filters={"docstatus": 1, "boarding_status": "Completed"},
		fields=["name", "employee"],
	):
		if not row.employee or not frappe.db.exists("Employee", row.employee):
			continue
		if frappe.db.get_value("Employee", row.employee, "status") == "Left":
			continue

		frappe.db.set_value(
			"Employee Separation",
			row.name,
			{"boarding_status": "Pending", "approved_by": None, "approved_on": None},
			update_modified=False,
		)
