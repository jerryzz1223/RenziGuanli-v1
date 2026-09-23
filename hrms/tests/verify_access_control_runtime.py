"""Exercise capability assignment on a real site and roll it back."""

import frappe

from hrms.access_control import (
	ACCESS_TIER_DEFINITIONS,
	APPROVE_TIER_CAPABILITY_KEYS,
	GRANULAR_BUSINESS_ROLES,
	READ_ONLY_ROLE,
	READ_TIER_CAPABILITY_KEYS,
	SUBMIT_ROLE,
	SUBMIT_TIER_CAPABILITY_KEYS,
	disable_hrms_user_account,
	register_read_only_account,
	set_hrms_user_access_tier,
)


def verify_business_capability_matrix():
	"""Verify the three cumulative tiers and submit/approval separation."""
	from hrms.access_control import has_hrms_capability
	from hrms.api.form_data_intake import FORM_IMPORT_CAPABILITIES, _require_form_import_capability

	original_session_user = frappe.session.user
	test_user = f"capability.matrix.{frappe.generate_hash(length=10).lower()}@example.invalid"
	frappe.set_user("Administrator")
	frappe.db.savepoint("verify_business_capability_matrix")
	try:
		frappe.get_doc({
			"doctype": "User", "email": test_user, "first_name": "Capability Matrix",
			"enabled": 1, "send_welcome_email": 0, "user_type": "System User",
		}).insert(ignore_permissions=True)
		for tier, allowed in (
			("read", READ_TIER_CAPABILITY_KEYS),
			("submit", SUBMIT_TIER_CAPABILITY_KEYS),
			("approve", APPROVE_TIER_CAPABILITY_KEYS),
		):
			result = set_hrms_user_access_tier(test_user, tier)
			assert result["access_tier"] == tier
			frappe.set_user(test_user)
			assert all(has_hrms_capability(key) for key in allowed)
			frappe.set_user("Administrator")

		for template_key, (submit_key, approval_key) in FORM_IMPORT_CAPABILITIES.items():
			if submit_key == "permission_management":
				# System configuration remains outside the three business tiers.
				continue
			set_hrms_user_access_tier(test_user, "submit")
			frappe.set_user(test_user)
			_require_form_import_capability(template_key)
			if approval_key != submit_key:
				try:
					_require_form_import_capability(template_key, approval=True)
				except frappe.PermissionError:
					pass
				else:
					raise AssertionError(f"approval bypassed submit-only permission: {template_key}")
			frappe.set_user("Administrator")

		return {"tiers": len(ACCESS_TIER_DEFINITIONS), "form_templates": len(FORM_IMPORT_CAPABILITIES), "result": "passed_and_rolled_back"}
	finally:
		frappe.db.rollback(save_point="verify_business_capability_matrix")
		frappe.clear_cache(user=test_user)
		frappe.set_user(original_session_user)


def execute():
	original_session_user = frappe.session.user
	frappe.set_user("Administrator")
	target_user = frappe.db.get_value(
		"User",
		{"name": ["not in", ("Administrator", "Guest")], "enabled": 1},
		"name",
	)
	if not target_user:
		raise AssertionError("No non-administrator account is available for the rollback test.")

	before = frappe.get_doc("User", target_user)
	before_roles = [row.role for row in before.roles]
	managed_roles = {item["role"] for item in ACCESS_TIER_DEFINITIONS} | set(GRANULAR_BUSINESS_ROLES) | {READ_ONLY_ROLE}
	preserved = [role for role in before_roles if role not in managed_roles]
	frappe.db.savepoint("verify_hrms_access_control")
	try:
		result = set_hrms_user_access_tier(target_user, "submit")
		assert result["access_tier"] == "submit"
		assert result["roles"] == preserved + [SUBMIT_ROLE]
		assert frappe.db.get_value("User", target_user, "user_type") == "System User"
		return {"user": target_user, "result": "passed_and_rolled_back"}
	finally:
		frappe.db.rollback(save_point="verify_hrms_access_control")
		frappe.clear_cache(user=target_user)
		frappe.set_user(original_session_user)


def verify_registration():
	"""Create a complete public account inside a transaction, then remove it."""
	original_session_user = frappe.session.user
	email = f"codex.signup.{frappe.generate_hash(length=10).lower()}@example.com"
	frappe.set_user("Guest")
	frappe.db.savepoint("verify_hrms_registration")
	try:
		registration = getattr(register_read_only_account, "__wrapped__", register_read_only_account)
		result = registration(email, "注册回滚测试", "SafePassword123")
		user = frappe.get_doc("User", email)
		assert result["user"] == email
		assert user.user_type == "System User"
		assert [row.role for row in user.roles] == [READ_ONLY_ROLE]
		return {"user": email, "result": "registered_and_rolled_back"}
	finally:
		frappe.db.rollback(save_point="verify_hrms_registration")
		frappe.clear_cache(user=email)
		frappe.set_user(original_session_user)


def verify_employee_registration():
	"""Bind one unclaimed current employee inside a transaction, then roll it back."""
	original_session_user = frappe.session.user
	employee = frappe.db.get_value(
		"Employee", {"status": ["!=", "Left"], "user_id": ["in", (None, "")]},
		["name", "custom_employee_code", "employee_name"], as_dict=True,
	)
	if not employee:
		return {"result": "skipped", "reason": "No unclaimed current employee is available."}
	other_employee = frappe.db.get_value("Employee", {"name": ["!=", employee.name]}, "name")
	email = f"codex.employee.signup.{frappe.generate_hash(length=10).lower()}@example.com"
	frappe.set_user("Guest")
	frappe.db.savepoint("verify_hrms_employee_registration")
	try:
		registration = getattr(register_read_only_account, "__wrapped__", register_read_only_account)
		result = registration(email, "", "SafePassword123", employee.custom_employee_code)
		user = frappe.get_doc("User", email)
		assert result["employee"] == employee.name
		assert result["profile_matched"] is True
		assert frappe.db.get_value("Employee", employee.name, "user_id") == email
		assert [row.role for row in user.roles] == [READ_ONLY_ROLE, "Employee Self Service"]
		frappe.clear_cache(user=email)
		frappe.set_user(email)
		from hrms.api.employee_field_template import get_employee_detail
		profile = get_employee_detail(employee.name)
		assert profile["header"]["name"] == employee.name
		assert profile["header"]["custom_employee_code"] == employee.custom_employee_code
		assert "sections" in profile and "standing_pay_summary" in profile and "materials" in profile
		if other_employee:
			try:
				get_employee_detail(other_employee)
			except frappe.PermissionError:
				pass
			else:
				raise AssertionError("Matched employee account could read another employee profile.")
		return {"employee": employee.name, "result": "matched_and_rolled_back"}
	finally:
		frappe.db.rollback(save_point="verify_hrms_employee_registration")
		frappe.clear_cache(user=email)
		frappe.set_user(original_session_user)


def verify_account_disabling():
	"""Create and disable a temporary user while preserving the record."""
	original_session_user = frappe.session.user
	email = f"codex.disable.{frappe.generate_hash(length=10).lower()}@example.com"
	frappe.set_user("Administrator")
	frappe.db.savepoint("verify_hrms_account_disabling")
	try:
		frappe.get_doc({
			"doctype": "User",
			"email": email,
			"first_name": "停用回滚测试",
			"enabled": 1,
			"user_type": "Website User",
			"send_welcome_email": 0,
		}).insert(ignore_permissions=True)
		assert frappe.db.exists("User", email)
		try:
			frappe.delete_doc("User", email, ignore_permissions=True)
		except frappe.PermissionError:
			pass
		else:
			raise AssertionError("User deletion was not blocked by the retention hook.")
		assert frappe.db.exists("User", email)
		result = disable_hrms_user_account(email)
		assert result["disabled"] == 1
		assert frappe.db.exists("User", email)
		assert frappe.db.get_value("User", email, "enabled") == 0
		return {"user": email, "result": "disabled_and_preserved_then_rolled_back"}
	finally:
		frappe.db.rollback(save_point="verify_hrms_account_disabling")
		frappe.clear_cache(user=email)
		frappe.set_user(original_session_user)
