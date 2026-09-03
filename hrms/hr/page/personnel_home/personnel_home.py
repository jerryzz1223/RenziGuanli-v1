import frappe

from hrms.hr.page.hrms_workbench.hrms_workbench import get_personnel_home_data


@frappe.whitelist()
def get_data():
	"""Compatibility endpoint for the standalone personnel home page."""
	return get_personnel_home_data()
