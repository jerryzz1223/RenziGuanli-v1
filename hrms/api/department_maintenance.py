"""Apply the scoped department cleanup and verify existing business references."""
import hashlib
import json

import frappe


def repair_roster_department_authority():
	from hrms.setup import flatten_yongxin_roster_department_parents, hide_roster_department_tree_columns

	frappe.only_for("System Manager")
	def references():
		return {
			"employees": frappe.get_all("Employee", fields=["name", "company", "department", "designation", "status"], order_by="name"),
			"nodes": frappe.get_all("Organization Node", fields=["name", "parent_node", "source_text", "confirmation_status", "planned_headcount"], order_by="name"),
			"other_departments": frappe.get_all("Department", filters={"company": ["!=", "永新"]}, fields=["name", "parent_department"], order_by="name"),
		}
	before = references()
	result = flatten_yongxin_roster_department_parents()
	if result.get("reason"):
		frappe.throw("部门根节点缺失，未执行修复。")
	hide_roster_department_tree_columns()
	if references() != before:
		frappe.db.rollback()
		frappe.throw("引用核对不一致，修复已回滚。")
	frappe.clear_cache()
	return {**result, "employee_references_unchanged": True, "organization_configuration_unchanged": True,
		"other_companies_unchanged": True, "reference_hash": hashlib.sha256(json.dumps(before, sort_keys=True, default=str).encode()).hexdigest()}
