"""Exercise capability assignment on a real site and roll it back."""

import frappe

from hrms.access_control import (
	READ_ONLY_ROLE,
	delete_hrms_user_account,
	register_read_only_account,
	set_hrms_user_capabilities,
)


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
	managed_roles = {
		"HRMS 基础只读", "薪资经办", "薪资审批", "System Manager",
	}
	preserved = [role for role in before_roles if role not in managed_roles]
	frappe.db.savepoint("verify_hrms_access_control")
	try:
		result = set_hrms_user_capabilities(target_user, ["basic_read_only", "payroll_entry_submit"])
		assert result["capabilities"] == ["basic_read_only", "payroll_entry_submit"]
		assert result["roles"] == preserved + [READ_ONLY_ROLE, "薪资经办"]
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


def verify_account_deletion():
	"""Create and delete a temporary user inside a transaction, then roll back."""
	original_session_user = frappe.session.user
	email = f"codex.delete.{frappe.generate_hash(length=10).lower()}@example.com"
	frappe.set_user("Administrator")
	frappe.db.savepoint("verify_hrms_account_deletion")
	try:
		frappe.get_doc({
			"doctype": "User",
			"email": email,
			"first_name": "删除回滚测试",
			"enabled": 1,
			"user_type": "Website User",
			"send_welcome_email": 0,
		}).insert(ignore_permissions=True)
		assert frappe.db.exists("User", email)
		result = delete_hrms_user_account(email, email)
		assert result["deleted"] == 1
		assert not frappe.db.exists("User", email)
		return {"user": email, "result": "deleted_and_rolled_back"}
	finally:
		frappe.db.rollback(save_point="verify_hrms_account_deletion")
		frappe.clear_cache(user=email)
		frappe.set_user(original_session_user)
