import importlib.util
import sys
import types
import unittest
from pathlib import Path


class _UserDoc:
	def __init__(self, roles):
		self.roles = [types.SimpleNamespace(role=role) for role in roles]
		self.saved = False
		self.enabled = 1

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
	permissions.added = []
	permissions.add_permission = lambda *args, **kwargs: permissions.added.append((args, kwargs))
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
		module._added_permissions = permissions.added
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

	def test_every_business_action_has_a_unique_checkbox_role(self):
		module = _load_module()
		definitions = module.CAPABILITY_DEFINITIONS
		keys = [item["key"] for item in definitions]
		roles = [item["role"] for item in definitions]
		self.assertEqual(len(keys), len(set(keys)))
		self.assertEqual(len(roles), len(set(roles)))
		for required in (
			"roster_import_submit", "roster_import_approve", "employee_create",
			"employee_create_approve", "attendance_import_submit", "attendance_approve",
			"payroll_entry_submit", "payroll_approval", "payroll_confirm",
		):
			self.assertIn(required, keys)

	def test_submit_and_approve_roles_are_separate(self):
		module = _load_module()
		for submit_key, approve_key in (
			("roster_import_submit", "roster_import_approve"),
			("employee_create", "employee_create_approve"),
			("attendance_import_submit", "attendance_approve"),
			("payroll_entry_submit", "payroll_approval"),
		):
			self.assertNotEqual(
				module.CAPABILITY_BY_KEY[submit_key]["role"],
				module.CAPABILITY_BY_KEY[approve_key]["role"],
			)

	def test_role_setup_installs_real_operation_permissions_and_company_read(self):
		module = _load_module()
		module.ensure_hrms_access_roles()
		added = {(args[0], args[1], kwargs.get("ptype")) for args, kwargs in module._added_permissions}
		self.assertIn(("Employee", "花名册导入提交", "import"), added)
		self.assertIn(("HRMS Attendance Department Confirmation", "考勤审批", "submit"), added)
		self.assertIn(("HRMS Employee Salary Change", "薪资审批", "submit"), added)
		self.assertIn(("Company", "考勤导入提交", "read"), added)

	def test_registration_password_requires_length_letters_and_digits(self):
		module = _load_module()
		for password in ("short1", "onlyletterslong", "1234567890"):
			with self.assertRaises(ValueError):
				module._validate_registration_password(password)
		self.assertEqual(module._validate_registration_password("safePass123"), "safePass123")

	def test_account_is_disabled_and_deletion_is_always_rejected(self):
		user = _UserDoc([])
		module = _load_module(user)
		for protected_user in ("Administrator", "Guest", "manager@example.com"):
			with self.assertRaises(ValueError):
				module.disable_hrms_user_account(protected_user)

		result = module.disable_hrms_user_account("worker@example.com")
		self.assertEqual(result["disabled"], 1)
		self.assertEqual(user.enabled, 0)
		self.assertTrue(user.saved)
		with self.assertRaisesRegex(ValueError, "账号不允许删除"):
			module.delete_hrms_user_account("worker@example.com", "worker@example.com")
		self.assertEqual(module.frappe._deleted, [])


if __name__ == "__main__":
	unittest.main()
