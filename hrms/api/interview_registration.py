"""Permission-filtered list for the template-based interview register."""
import re

import frappe
from frappe.utils import cint

DOCTYPE = "Interview Registration"
FIELDS = [
    "name", "modified", "company", "registration_month", "candidate_name", "native_place",
    "source", "phone", "gender", "education", "marital_status", "age", "interview_date",
    "interview_position", "referrer", "interviewer", "hired", "assigned_department",
    "assigned_position", "rejection_reason", "expected_start_date", "arrival_status", "no_show_reason",
]


@frappe.whitelist()
def get_registrations(company: str = "", month: str = "", search: str = "", hired: str = "", arrival_status: str = "", start: int = 0):
    if not frappe.has_permission(DOCTYPE, "read"):
        frappe.throw("无权查看面试人员登记。", frappe.PermissionError)
    filters = {}
    if company:
        frappe.get_doc("Company", company).check_permission("read")
        filters["company"] = company
    if month:
        if not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", month):
            frappe.throw("月份格式应为 YYYY-MM。")
        filters["registration_month"] = month
    if hired:
        if hired not in ("是", "否"):
            frappe.throw("录用筛选值无效。")
        filters["hired"] = hired
    if arrival_status:
        if arrival_status not in ("待报到", "已报到", "未报到"):
            frappe.throw("报到筛选值无效。")
        filters["arrival_status"] = arrival_status
    start = max(0, cint(start))
    search = search.strip()[:100]
    rows = frappe.get_list(
        DOCTYPE, fields=FIELDS, filters=filters,
        or_filters={key: ["like", f"%{search}%"] for key in ("candidate_name", "phone", "interview_position")} if search else None,
        order_by="interview_date desc, creation desc, name desc", limit_start=start, limit_page_length=51,
    )
    return {
        "rows": rows[:50], "has_more": len(rows) > 50, "start": start,
        "can_create": bool(frappe.has_permission(DOCTYPE, "create")),
    }
