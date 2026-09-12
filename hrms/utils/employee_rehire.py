"""Business identity helpers for employees returning to the company."""

import frappe
from frappe.utils import cstr


EMPLOYEE_DOCTYPE = "Employee"
IDENTITY_NUMBER_FIELD = "passport_number"
IDENTITY_NUMBER_FIELDS = (IDENTITY_NUMBER_FIELD, "custom_id_number")
PREVIOUS_EMPLOYMENT_FIELD = "custom_rehired_from_employee"
PREVIOUS_EMPLOYEE_CODE_FIELD = "custom_previous_employee_code"
REHIRE_AUTOFILL_FIELDS = (
	"salutation",
	"first_name",
	"middle_name",
	"last_name",
	"gender",
	"date_of_birth",
	"custom_id_type",
	"custom_native_place",
	"custom_ethnicity",
	"marital_status",
	"custom_marital_status_text",
	"blood_group",
	"cell_number",
	"personal_email",
	"current_address",
	"permanent_address",
	"person_to_be_contacted",
	"relation",
	"emergency_phone_number",
	"custom_education_category",
	"custom_study_mode",
	"custom_education_level",
	"custom_graduation_school",
	"custom_major",
	"custom_transport",
)


def clean_identity_number(value):
	"""Keep the stored document number intact except for accidental outer spaces."""
	return cstr(value).strip()


def get_employee_identity_number(employee):
	"""Read the current certificate field, with the legacy ID-card field fallback."""
	for fieldname in IDENTITY_NUMBER_FIELDS:
		value = clean_identity_number(employee.get(fieldname))
		if value:
			return value
	return ""


def _available_identity_number_fields():
	meta = frappe.get_meta(EMPLOYEE_DOCTYPE)
	return [fieldname for fieldname in IDENTITY_NUMBER_FIELDS if meta.has_field(fieldname)]


def find_employment_history(identity_number, exclude_employee=None):
	"""Find every Employment record that uses the same document number.

	The Employee document is an employment record, not a person master.  This
	lookup deliberately spans companies and statuses so a returnee keeps the
	full history that the document number identifies.
	"""
	identity_number = clean_identity_number(identity_number)
	if not identity_number:
		return []

	rows_by_name = {}
	for fieldname in _available_identity_number_fields():
		filters = {fieldname: identity_number}
		if exclude_employee:
			filters["name"] = ["!=", exclude_employee]
		for row in frappe.get_all(
			EMPLOYEE_DOCTYPE,
			filters=filters,
			fields=[
				"name", "employee_name", "custom_employee_code", "company",
				"department", "designation", "status", "date_of_joining",
				"relieving_date", "creation",
			],
			order_by="date_of_joining asc, creation asc",
			limit_page_length=0,
		):
			rows_by_name[row.name] = row
	return sorted(rows_by_name.values(), key=lambda row: (str(row.get("date_of_joining") or ""), str(row.get("creation") or "")))


def find_previous_employment(identity_number, exclude_employee=None):
	"""Return the latest prior employment record for a new employee document."""
	history = find_employment_history(identity_number, exclude_employee)
	return history[-1] if history else None


def get_rehire_autofill_values(employee):
	"""Copy person-level values without carrying an old employment into the new one."""
	values = {}
	for fieldname in REHIRE_AUTOFILL_FIELDS:
		if not employee.meta.has_field(fieldname):
			continue
		value = employee.get(fieldname)
		if value is not None and clean_identity_number(value):
			values[fieldname] = value
	return values


def link_new_employee_to_previous_employment(employee):
	"""Persist the immutable previous-profile link when a returnee is created."""
	if not employee.is_new() or not employee.meta.has_field(PREVIOUS_EMPLOYMENT_FIELD):
		return None
	previous = find_previous_employment(get_employee_identity_number(employee), employee.name)
	employee.set(PREVIOUS_EMPLOYMENT_FIELD, previous.name if previous else None)
	if employee.meta.has_field(PREVIOUS_EMPLOYEE_CODE_FIELD):
		employee.set(
			PREVIOUS_EMPLOYEE_CODE_FIELD,
			(previous.get("custom_employee_code") or previous.name) if previous else None,
		)
	return previous
