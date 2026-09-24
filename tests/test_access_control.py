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
	frappe.form_dict = {}
	frappe.local = types.SimpleNamespace(request=None)
	frappe.PermissionError = PermissionError
	frappe.get_roles = lambda _user=None: ["System Manager"]
	frappe.whitelist = lambda **_kwargs: (lambda fn: fn)
	frappe._ = lambda message: message
	frappe.db = types.SimpleNamespace(
		exists=lambda doctype, name=None: True,
		delete=lambda *_args, **_kwargs: None,
		get_value=lambda *_args, **_kwargs: None,
	)
	frappe.get_doc = lambda *_args, **_kwargs: user_doc
	frappe.get_all = lambda *_args, **_kwargs: []
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

	def test_undelivered_expense_capabilities_are_retired(self):
		module = _load_module()
		keys = {item["key"] for item in module.CAPABILITY_DEFINITIONS}
		self.assertNotIn("expense_submit", keys)
		self.assertNotIn("expense_approve", keys)
		self.assertEqual(module.RETIRED_CAPABILITY_ROLES, ("费用出差提交", "费用出差审批"))

	def test_stale_dialog_ignores_retired_capabilities_and_saves_current_selection(self):
		user = _UserDoc(["人事查看", "费用出差提交", "费用出差审批"])
		module = _load_module(user)
		result = module.set_hrms_user_capabilities(
			"worker@example.com", ["personnel_view", "expense_submit", "expense_approve"]
		)
		self.assertEqual([row.role for row in user.roles], [module.READ_TIER_ROLE])
		self.assertEqual(result["capabilities"], ["personnel_view"])
		self.assertEqual(result["ignored_capabilities"], ["expense_approve", "expense_submit"])
		self.assertTrue(result["saved"])

	def test_capability_assignment_preserves_roles_outside_checklist(self):
		user = _UserDoc(["Existing Custom Role", "HR User", "Leave Approver"])
		module = _load_module(user)
		result = module.set_hrms_user_capabilities(
			"worker@example.com", ["basic_read_only", "payroll_entry_submit"]
		)
		self.assertTrue(user.saved)
		self.assertEqual(
			[row.role for row in user.roles],
			["Existing Custom Role", "HR User", "Leave Approver", module.SUBMIT_ROLE],
		)
		self.assertEqual(result["capabilities"], ["basic_read_only", "payroll_entry_submit"])
		self.assertTrue(result["saved"])

	def test_whitelisted_capability_payload_has_frappe_type_annotation(self):
		module = _load_module()
		annotation = module.set_hrms_user_capabilities.__annotations__["capabilities"]
		self.assertEqual(annotation, str | None)

	def test_stale_individual_checkbox_payloads_collapse_to_three_tiers(self):
		module = _load_module()
		for capability, expected_tier, expected_role in (
			("personnel_view", "read", module.READ_TIER_ROLE),
			("roster_import_submit", "submit", module.SUBMIT_ROLE),
			("roster_import_approve", "approve", module.APPROVE_ROLE),
		):
			with self.subTest(capability=capability):
				user = _UserDoc(["Existing Custom Role"])
				module.frappe.get_doc = lambda *_args, _user=user, **_kwargs: _user
				result = module.set_hrms_user_capabilities("worker@example.com", [capability])
				self.assertEqual([row.role for row in user.roles], ["Existing Custom Role", expected_role])
				self.assertEqual(result["migrated_to_tier"], expected_tier)

	def test_one_capability_role_does_not_authorize_other_capabilities(self):
		module = _load_module()
		business_capabilities = [
			item for item in module.CAPABILITY_DEFINITIONS
			if item["key"] != "permission_management"
		]
		for granted in business_capabilities:
			with self.subTest(granted=granted["key"]):
				module.frappe.get_roles = lambda _user=None, role=granted["role"]: [role]
				allowed = [
					item["key"] for item in business_capabilities
					if module.has_hrms_capability(item["key"], user="worker@example.com")
				]
				self.assertEqual(allowed, [granted["key"]])

	def test_three_access_tiers_are_cumulative_and_do_not_grant_permission_management(self):
		module = _load_module()
		cases = (
			(module.READ_TIER_ROLE, "personnel_view", False),
			(module.SUBMIT_ROLE, "roster_import_submit", False),
			(module.APPROVE_ROLE, "roster_import_approve", False),
		)
		for role, capability, manages_permissions in cases:
			with self.subTest(role=role):
				module.frappe.get_roles = lambda _user=None, selected_role=role: [selected_role]
				self.assertTrue(module.has_hrms_capability(capability, user="worker@example.com"))
				self.assertEqual(
					module.has_hrms_capability("permission_management", user="worker@example.com"),
					manages_permissions,
				)
		module.frappe.get_roles = lambda _user=None: [module.SUBMIT_ROLE]
		self.assertTrue(module.has_hrms_capability("personnel_view", user="worker@example.com"))
		self.assertFalse(module.has_hrms_capability("roster_import_approve", user="worker@example.com"))
		module.frappe.get_roles = lambda _user=None: [module.APPROVE_ROLE]
		self.assertTrue(module.has_hrms_capability("roster_import_submit", user="worker@example.com"))

	def test_tier_docperms_include_baseline_reads_and_top_tier_organization_management(self):
		module = _load_module()
		module.ensure_hrms_access_roles()
		added = {
			(args[0], args[1], kwargs.get("ptype"))
			for args, kwargs in module._added_permissions
		}
		for tier_role in (module.READ_TIER_ROLE, module.SUBMIT_ROLE, module.APPROVE_ROLE):
			self.assertIn(("Department", tier_role, "read"), added)
		self.assertIn(
			("Department", "read", "select", "create", "write", "delete"),
			module.BUSINESS_ADMIN_DOCTYPE_PERMISSIONS,
		)
		self.assertIn(("Organization Node", module.APPROVE_ROLE, "read"), added)

	def test_setting_tier_collapses_legacy_business_roles_and_preserves_system_manager(self):
		user = _UserDoc(["System Manager", "人事查看", "花名册导入提交", "Existing Custom Role"])
		module = _load_module(user)
		result = module.set_hrms_user_access_tier("worker@example.com", "submit")
		self.assertEqual(
			[row.role for row in user.roles],
			["System Manager", "Existing Custom Role", module.SUBMIT_ROLE],
		)
		self.assertEqual(result["access_tier"], "submit")
		self.assertEqual(result["changed_by"], "manager@example.com")

	def test_employee_reportview_requires_personnel_view_without_blocking_other_workflows(self):
		module = _load_module()
		module.frappe.get_roles = lambda _user=None: ["员工档案修改"]
		module.frappe.form_dict = {"cmd": "frappe.desk.reportview.get"}
		self.assertEqual(
			module.employee_roster_permission_query("worker@example.com"), "1=0"
		)
		module.frappe.form_dict = {"cmd": "hrms.api.some_employee_edit_workflow"}
		self.assertEqual(
			module.employee_roster_permission_query("worker@example.com"), ""
		)

	def test_system_manager_does_not_bypass_individual_business_checkboxes(self):
		module = _load_module()
		module.frappe.get_roles = lambda _user=None: ["System Manager", "员工档案修改"]
		self.assertTrue(
			module.has_hrms_capability("permission_management", user="worker@example.com")
		)
		self.assertTrue(
			module.has_hrms_capability("employee_edit", user="worker@example.com")
		)
		self.assertFalse(
			module.has_hrms_capability("personnel_view", user="worker@example.com")
		)
		module.frappe.get_roles = lambda _user=None: ["人事查看"]
		module.frappe.form_dict = {"cmd": "frappe.desk.reportview.get"}
		self.assertEqual(
			module.employee_roster_permission_query("worker@example.com"), ""
		)

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
		captured = []
		module._ensure_docperm_operations = lambda doctype, role, permission_types: captured.extend(
			(doctype, role, permission_type) for permission_type in permission_types
		)
		module.ensure_hrms_access_roles()
		added = set(captured)
		self.assertIn(("Employee", "花名册导入提交", "import"), added)
		self.assertIn(("HRMS Attendance Department Confirmation", "考勤审批", "submit"), added)
		self.assertIn(("HRMS Employee Salary Change", "薪资审批", "submit"), added)
		self.assertIn(("Company", "考勤导入提交", "read"), added)

	def test_registration_password_requires_only_four_characters(self):
		module = _load_module()
		for password in ("", "123", "密码a"):
			with self.assertRaises(ValueError):
				module._validate_registration_password(password)
		for password in ("1234", "abcd", "!!!!", "密码可用"):
			self.assertEqual(module._validate_registration_password(password), password)

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
