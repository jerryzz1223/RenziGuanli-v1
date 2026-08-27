"""Align existing trial salary records with the contribution default policy.

Before the policy was clarified, the grid defaulted housing-fund participation
for every active employee.  Reset only records whose employee was in probation
on that record's effective date, so previously generated rows stop displaying
the old default as a selected contribution.  HR can still explicitly select
either switch afterwards for a legitimate exception.
"""

import frappe

from hrms.api.payroll_input import _employment_stage


SALARY_CHANGE_DOCTYPE = "HRMS Employee Salary Change"


def execute():
	if not (frappe.db.exists("DocType", SALARY_CHANGE_DOCTYPE) and frappe.db.exists("DocType", "Employee")):
		return

	employee_fields = [
		"name",
		"employment_type",
		"status",
		"custom_is_confirmed",
		"final_confirmation_date",
		"confirmation_date",
	]
	available_employee_fields = [fieldname for fieldname in employee_fields if frappe.db.has_column("Employee", fieldname)]
	employees = {
		row.name: row
		for row in frappe.get_all("Employee", fields=available_employee_fields, limit_page_length=0)
	}

	for change in frappe.get_all(
		SALARY_CHANGE_DOCTYPE,
		filters={"status": ["!=", "已作废"], "exclude_from_payroll": 0},
		fields=["name", "employee", "effective_date", "social_insurance_enabled", "housing_fund_enabled"],
		limit_page_length=0,
	):
		employee = employees.get(change.employee)
		if not employee or _employment_stage(employee, str(change.effective_date or "")) != "试用":
			continue
		if not (change.social_insurance_enabled or change.housing_fund_enabled):
			continue
		frappe.db.set_value(
			SALARY_CHANGE_DOCTYPE,
			change.name,
			{"social_insurance_enabled": 0, "housing_fund_enabled": 0},
			update_modified=False,
		)

	frappe.clear_cache(doctype=SALARY_CHANGE_DOCTYPE)
