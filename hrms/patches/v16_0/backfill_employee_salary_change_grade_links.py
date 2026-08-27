"""Restore safe salary-grade links for historical amount-only salary rows."""

import frappe

from hrms.api.payroll_input import (
	EMPLOYEE_SALARY_CHANGE_DOCTYPE,
	_salary_grade_from_unique_amounts,
	_workflow_month,
)


def execute():
	if not frappe.db.exists("DocType", EMPLOYEE_SALARY_CHANGE_DOCTYPE):
		return
	linked = 0
	for row in frappe.get_all(
		EMPLOYEE_SALARY_CHANGE_DOCTYPE,
		filters={"salary_grade": ["is", "not set"], "status": ["!=", "已作废"]},
		fields=["name", "effective_date", "base_salary", "function_allowance"],
		limit_page_length=0,
	):
		effective_date = str(row.effective_date or "")
		payroll_month = effective_date[:7] if len(effective_date) >= 7 else ""
		if not payroll_month:
			continue
		grade = _salary_grade_from_unique_amounts(
			row.base_salary, row.function_allowance, _workflow_month(payroll_month)
		)
		if not grade:
			continue
		frappe.db.set_value(EMPLOYEE_SALARY_CHANGE_DOCTYPE, row.name, "salary_grade", grade.name, update_modified=False)
		linked += 1
	frappe.clear_cache(doctype=EMPLOYEE_SALARY_CHANGE_DOCTYPE)
	if linked:
		print("已按唯一薪资金额恢复 {0} 条员工定薪档位关联。".format(linked))
