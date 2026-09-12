import json

import frappe


EMPLOYEE_DOCTYPE = "Employee"
IDENTITY_NUMBER_FIELD = "passport_number"
IDENTITY_NUMBER_ANCHOR = "employee_name"


def ensure_employee_identity_number_in_basic_information():
	"""Place the native identity-number field beside the employee identity fields."""
	if not frappe.db.exists("DocType", EMPLOYEE_DOCTYPE):
		return False

	meta = frappe.get_meta(EMPLOYEE_DOCTYPE)
	field_order = [field.fieldname for field in meta.fields if field.fieldname]
	if IDENTITY_NUMBER_FIELD not in field_order or IDENTITY_NUMBER_ANCHOR not in field_order:
		return False

	identity_index = field_order.index(IDENTITY_NUMBER_FIELD)
	anchor_index = field_order.index(IDENTITY_NUMBER_ANCHOR)
	if identity_index == anchor_index + 1:
		return False

	field_order.pop(identity_index)
	anchor_index = field_order.index(IDENTITY_NUMBER_ANCHOR)
	field_order.insert(anchor_index + 1, IDENTITY_NUMBER_FIELD)

	frappe.make_property_setter(
		{
			"doctype": EMPLOYEE_DOCTYPE,
			"doctype_or_field": "DocType",
			"property": "field_order",
			"property_type": "Small Text",
			"value": json.dumps(field_order),
		},
		is_system_generated=True,
	)
	frappe.clear_cache(doctype=EMPLOYEE_DOCTYPE)
	return True
