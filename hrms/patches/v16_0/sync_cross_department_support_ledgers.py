"""Ensure actual support history and temporary exclusions exist on upgraded sites."""
import frappe


def execute():
    for name in ("cross_department_support_capability", "cross_department_support_record", "cross_department_support_exclusion"):
        frappe.reload_doc("hr", "doctype", name)
