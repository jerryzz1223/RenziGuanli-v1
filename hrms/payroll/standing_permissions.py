"""Separate payroll request entry from payroll decision approval."""
import frappe
from frappe import _

EDITOR_ROLE = '薪资经办'
APPROVER_ROLE = '薪资审批'
APPROVER_ROLES = {APPROVER_ROLE, 'System Manager', 'HR Manager'}


def can_approve():
	return frappe.session.user == 'Administrator' or bool(APPROVER_ROLES & set(frappe.get_roles(frappe.session.user)))


def can_submit():
	return can_approve() or EDITOR_ROLE in frappe.get_roles(frappe.session.user)


def require_access(company, approve=False):
	if not (can_approve() if approve else can_submit()):
		frappe.throw(_('没有薪资审批权限。' if approve else '没有薪资档案访问权限。'), frappe.PermissionError)
	from hrms.api.payroll_input import _require_company
	company = _require_company(company)
	frappe.get_doc('Company', company).check_permission('read')
	return company
