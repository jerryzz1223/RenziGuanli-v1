from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

from hrms.setup import get_custom_fields


def execute():
	"""Expose the explicit leaf flag before the Q3 folder tree is imported."""
	department_fields = [
		field for field in get_custom_fields().get("Department", []) if field.get("fieldname") == "hrms_roster_assignable"
	]
	create_custom_fields({"Department": department_fields}, ignore_validate=True)
