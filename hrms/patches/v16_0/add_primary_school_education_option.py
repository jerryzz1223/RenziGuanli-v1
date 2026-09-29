def execute():
	import frappe
	from hrms.api.employee_field_template import TEMPLATE_DOCTYPE, _sync_company_roster_fields

	_sync_company_roster_fields(frappe.get_single(TEMPLATE_DOCTYPE), {"custom_education_level"})
