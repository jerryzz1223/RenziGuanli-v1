import importlib.util
import sys
import types
import unittest
from pathlib import Path


class _UserDoc:
	def __init__(self, roles):
		self.roles = [types.SimpleNamespace(role=role) for role in roles]
		self.saved = False

	def set(self, fieldname, value):
		assert fieldname == "roles" and value == []
		self.roles = []

	def append(self, fieldname, value):
		assert fieldname == "roles"
		self.roles.append(types.SimpleNamespace(role=value["role"]))

	def save(self, **_kwargs):
		self.saved = True


def _load_module(user_doc=None):
	frappe = types.ModuleType("frappe")
	frappe.session = types.SimpleNamespace(user="manager@example.com")
	frappe.PermissionError = PermissionError
	frappe.get_roles = lambda _user=None: ["System Manager"]
	frappe.whitelist = lambda **_kwargs: (lambda fn: fn)
	frappe._ = lambda message: message
	frappe.db = types.SimpleNamespace(exists=lambda doctype, name=None: True)
	frappe.get_doc = lambda *_args, **_kwargs: user_doc
	frappe.clear_cache = lambda **_kwargs: None
	frappe._deleted = []
	frappe.delete_doc = lambda doctype, name, **kwargs: frappe._deleted.append((doctype, name, kwargs))
	frappe.throw = lambda message, *_args: (_ for _ in ()).throw(ValueError(message))

	permissions = types.ModuleType("frappe.permissions")
	permissions.add_permission = lambda *_args, **_kwargs: None
	rate_limiter = types.ModuleType("frappe.rate_limiter")
	rate_limiter.rate_limit = lambda **_kwargs: (lambda fn: fn)
	utils = types.ModuleType("frappe.utils")
	utils.validate_email_address = lambda email, throw=False: email
	password = types.ModuleType("frappe.utils.password")
	password.update_password = lambda *_args, **_kwargs: None

	previous = {name: sys.modules.get(name) for name in (
		"frappe", "frappe.permissions", "frappe.rate_limiter", "frappe.utils", "frappe.utils.password",
	)}
	sys.modules.update({
		"frappe": frappe,
		"frappe.permissions": permissions,
		"frappe.rate_limiter": rate_limiter,
		"frappe.utils": utils,
		"frappe.utils.password": password,
	})
	try:
		path = Path(__file__).parents[1] / "hrms" / "access_control.py"
		spec = importlib.util.spec_from_file_location("hrms_access_control_test", path)
		module = importlib.util.module_from_spec(spec)
		spec.loader.exec_module(module)
		return module
	finally:
		for name, value in previous.items():
			if value is None:
				sys.modules.pop(name, None)
			else:
				sys.modules[name] = value


class AccessControlTests(unittest.TestCase):
	def test_registration_employee_code_is_optional_and_exact(self):
		module = _load_module()
		self.assertIsNone(module._registration_employee("  "))
		seen = []
		module.frappe.db.get_value = lambda doctype, filters, fields, as_dict=False: (
			seen.append((doctype, filters, fields, as_dict))
			or {"name": "001", "employee_name": "张三", "custom_employee_code": "001", "user_id": None}
		)
		employee = module._registration_employee(" 001 ")
		self.assertEqual(employee["name"], "001")
		self.assertEqual(seen[0][1]["custom_employee_code"], "001")
		self.assertEqual(seen[0][1]["status"], ["!=", "Left"])

	def test_registration_rejects_unknown_or_already_linked_employee(self):
		module = _load_module()
		module.frappe.db.get_value = lambda *_args, **_kwargs: None
		with self.assertRaisesRegex(ValueError, "未在当前花名册"):
			module._registration_employee("404")
		module.frappe.db.get_value = lambda *_args, **_kwargs: {
			"name": "001", "employee_name": "张三", "custom_employee_code": "001", "user_id": "used@example.com",
		}
		with self.assertRaisesRegex(ValueError, "已绑定账号"):
			module._registration_employee("001")

	def test_public_baseline_excludes_sensitive_employee_and_payroll_records(self):
		module = _load_module()
		self.assertNotIn("Employee", module.READ_ONLY_DOCTYPES)
		self.assertFalse(any("Salary" in doctype or "Payroll" in doctype for doctype in module.READ_ONLY_DOCTYPES))

	def test_capability_assignment_preserves_roles_outside_checklist(self):
		user = _UserDoc(["Existing Custom Role", "HR User", "Leave Approver"])
		module = _load_module(user)
		result = module.set_hrms_user_capabilities(
			"worker@example.com", ["basic_read_only", "payroll_entry_submit"]
		)
		self.assertTrue(user.saved)
		self.assertEqual(
			[row.role for row in user.roles],
			["Existing Custom Role", "HR User", "Leave Approver", module.READ_ONLY_ROLE, "薪资经办"],
		)
		self.assertEqual(result["capabilities"], ["basic_read_only", "payroll_entry_submit"])

	def test_registration_password_requires_length_letters_and_digits(self):
		module = _load_module()
		for password in ("short1", "onlyletterslong", "1234567890"):
			with self.assertRaises(ValueError):
				module._validate_registration_password(password)
		self.assertEqual(module._validate_registration_password("safePass123"), "safePass123")

	def test_account_deletion_requires_exact_confirmation_and_protects_system_accounts(self):
		module = _load_module()
		with self.assertRaisesRegex(ValueError, "请输入完整账户"):
			module.delete_hrms_user_account("worker@example.com", "worker")
		for protected_user in ("Administrator", "Guest", "manager@example.com"):
			with self.assertRaises(ValueError):
				module.delete_hrms_user_account(protected_user, protected_user)

		result = module.delete_hrms_user_account("worker@example.com", "worker@example.com")
		self.assertEqual(result["deleted"], 1)
		self.assertEqual(module.frappe._deleted, [
			("User", "worker@example.com", {"ignore_permissions": True}),
		])


if __name__ == "__main__":
	unittest.main()
