from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

from hrms.setup import get_custom_fields


def execute():
	custom_fields = get_custom_fields()
	create_custom_fields(
		{
			"Department": custom_fields.get("Department", []),
			"Designation": custom_fields.get("Designation", []),
		},
		ignore_validate=True,
	)
