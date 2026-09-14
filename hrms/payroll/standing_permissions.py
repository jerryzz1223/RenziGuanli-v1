"""Separate payroll request entry from payroll decision approval."""
import frappe
from frappe import _

EDITOR_ROLE = '薪资经办'
APPROVER_ROLE = '薪资审批'
VIEW_ROLE = '薪酬查看'
CHANGE_ROLE = '薪资修改提交'
CONTRIBUTION_ROLE = '社保公积金提交'
EXPORT_ROLE = '薪酬导出'
APPROVER_ROLES = {APPROVER_ROLE, 'System Manager', 'HR Manager'}
ACTION_ROLES = {
	'view': {VIEW_ROLE, EDITOR_ROLE, CHANGE_ROLE, CONTRIBUTION_ROLE, EXPORT_ROLE, APPROVER_ROLE},
	'entry': {EDITOR_ROLE},
	'change': {CHANGE_ROLE, EDITOR_ROLE},
	'contribution': {CONTRIBUTION_ROLE, EDITOR_ROLE},
	'export': {EXPORT_ROLE},
}


def can_approve():
	return frappe.session.user == 'Administrator' or bool(APPROVER_ROLES & set(frappe.get_roles(frappe.session.user)))


def can_submit(action='entry'):
	roles = set(frappe.get_roles(frappe.session.user))
	return can_approve() or bool(ACTION_ROLES.get(action, ACTION_ROLES['entry']) & roles)


def require_access(company, approve=False, action='view'):
	allowed = can_approve() if approve else can_submit(action)
	if not allowed:
		label = {'view': '查看', 'entry': '首次录入', 'change': '修改提交', 'contribution': '社保公积金提交', 'export': '导出'}.get(action, '操作')
		frappe.throw(_('没有薪资审批权限。' if approve else '没有薪酬{0}权限。').format(label), frappe.PermissionError)
	from hrms.api.payroll_input import _require_company
	company = _require_company(company)
	frappe.get_doc('Company', company).check_permission('read')
	return company
