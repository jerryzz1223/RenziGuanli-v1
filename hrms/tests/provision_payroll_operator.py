"""Explicitly requested local operator account; never grant HR/System Manager."""
import json
from pathlib import Path
import secrets
import frappe


def run(company: str = '永新', email: str = 'payroll.operator@hrms.local'):
	from hrms.patches.v16_0.ensure_standing_pay_roles import execute
	from frappe.utils.password import update_password
	from hrms.payroll.standing_permissions import EDITOR_ROLE
	if frappe.session.user != 'Administrator':
		frappe.throw('仅 Administrator 可以创建经办账户。', frappe.PermissionError)
	if not frappe.db.exists('Company', company):
		frappe.throw('公司不存在。')
	if frappe.db.exists('User', email):
		frappe.throw('账户已存在，未覆盖其密码或权限。')
	execute()
	password = 'Hrms!' + secrets.token_urlsafe(18)
	doc = frappe.get_doc({'doctype': 'User', 'email': email, 'first_name': '薪资经办员',
		'enabled': 1, 'user_type': 'System User', 'send_welcome_email': 0,
		'roles': [{'role': EDITOR_ROLE}], 'default_workspace': ''})
	doc.flags.no_welcome_mail = True
	doc.insert(ignore_permissions=True)
	update_password(email, password, logout_all_sessions=True)
	frappe.get_doc({'doctype': 'User Permission', 'user': email, 'allow': 'Company',
		'for_value': company, 'apply_to_all_doctypes': 1, 'is_default': 1}).insert(ignore_permissions=True)
	frappe.defaults.set_user_default('Company', company, user=email)
	frappe.db.commit()
	frappe.clear_cache(user=email)
	credentials = Path('/tmp/hrms-payroll-operator-credentials.json')
	credentials.write_text(json.dumps({'url': 'http://localhost:8000/login', 'account': email,
		'password': password, 'company': company, 'role': EDITOR_ROLE}, ensure_ascii=False, indent=2))
	credentials.chmod(0o600)
	return {'account': email, 'role': EDITOR_ROLE, 'company': company,
		'can_approve': False, 'credentials_file': str(credentials)}
