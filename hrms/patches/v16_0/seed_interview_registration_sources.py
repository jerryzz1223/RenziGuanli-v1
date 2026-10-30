"""Initialize only the template's channel names, never its candidate examples."""
import frappe


def execute():
    for source in ("门口", "公众号", "网上", "老乡朋友", "其他"):
        if not frappe.db.exists("Job Applicant Source", source):
            frappe.get_doc({"doctype": "Job Applicant Source", "source_name": source}).insert()
