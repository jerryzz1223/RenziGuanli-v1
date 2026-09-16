import json

import frappe


EMPLOYEE_DOCTYPE = "Employee"
IDENTITY_NUMBER_FIELD = "passport_number"
IDENTITY_NUMBER_ANCHOR = "employee_name"
CERTIFICATE_FIELDS = (
	"passport_details_section",
	"passport_number",
	"custom_id_type",
	"custom_passport_type",
	"valid_upto",
	"date_of_issue",
	"place_of_issue",
	"column_break_73",
)
HOUSEHOLD_FIELDS = (
	"permanent_address",
	"permanent_accommodation_type",
	"custom_native_place",
)
BASIC_INFORMATION_SECTION = "basic_information"
HOUSEHOLD_ANCHOR = "column_break_9"


def _move_fields_before(field_order, fieldnames, anchor):
	"""Move existing fields as one block immediately before an existing anchor."""
	fields = [fieldname for fieldname in fieldnames if fieldname in field_order]
	if not fields or anchor not in field_order:
		return False

	new_order = [fieldname for fieldname in field_order if fieldname not in fields]
	anchor_index = new_order.index(anchor)
	new_order[anchor_index:anchor_index] = fields
	field_order[:] = new_order
	return True


def ensure_employee_identity_number_in_basic_information():
	"""Arrange certificate, employee, and household fields at the top of the form."""
	if not frappe.db.exists("DocType", EMPLOYEE_DOCTYPE):
		return False

	meta = frappe.get_meta(EMPLOYEE_DOCTYPE)
	field_order = [field.fieldname for field in meta.fields if field.fieldname]
	if IDENTITY_NUMBER_FIELD not in field_order or IDENTITY_NUMBER_ANCHOR not in field_order:
		return False

	original_order = field_order[:]
	# Keep the complete certificate block together and make the number its first
	# data field.  The custom certificate type is managed by the same block.
	_move_fields_before(field_order, CERTIFICATE_FIELDS, BASIC_INFORMATION_SECTION)

	# The identity number must precede the company code even on sites where the
	# native certificate section has already been customised or is unavailable.
	identity_index = field_order.index(IDENTITY_NUMBER_FIELD)
	code_index = field_order.index("custom_employee_code") if "custom_employee_code" in field_order else None
	if code_index is not None and identity_index > code_index:
		field_order.pop(identity_index)
		code_index = field_order.index("custom_employee_code")
		field_order.insert(code_index, IDENTITY_NUMBER_FIELD)

	# Keep household registration directly below the employee identity block,
	# separate from the later current-address section.
	_move_fields_before(field_order, HOUSEHOLD_FIELDS, HOUSEHOLD_ANCHOR)

	if field_order == original_order:
		return False

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
