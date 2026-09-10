"""Install narrowly scoped salary entry and approval roles, without assigning users."""
import frappe
from frappe.permissions import add_permission
from hrms.payroll.standing_permissions import EDITOR_ROLE, APPROVER_ROLE


def execute():
	for role in (EDITOR_ROLE, APPROVER_ROLE):
		if not frappe.db.exists('Role', role):
			frappe.get_doc({'doctype': 'Role', 'role_name': role, 'desk_access': 1}).insert(ignore_permissions=True)
		# Company read is necessary for the company-scoped workflow; each operator
		# account is further restricted by a Company User Permission.
		add_permission('Company', role, ptype='read')
		add_permission('Navbar Settings', role, ptype='read')
		if role == EDITOR_ROLE:
			frappe.db.set_value('Role', role, 'home_page', 'desk/payroll-input-center/salary-register')
	frappe.clear_cache()
