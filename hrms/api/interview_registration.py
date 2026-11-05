"""Permission-filtered list for the template-based interview register."""
import re
import hashlib
import json

import frappe
from frappe.utils import cint

DOCTYPE = "Interview Registration"
FIELDS = [
    "name", "modified", "company", "registration_month", "source_sequence", "source_month", "candidate_name", "native_place",
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


def _import_data(file_url, company, corrections=None):
    for action in ("read", "create"):
        if not frappe.has_permission(DOCTYPE, action):
            frappe.throw("无权导入面试人员登记。", frappe.PermissionError)
    if not company:
        frappe.throw("请先选择公司。")
    frappe.get_doc("Company", company).check_permission("read")
    file_name = frappe.db.get_value("File", {"file_url": file_url}, "name")
    if not file_name:
        frappe.throw("请先上传 Excel 文件。")
    file = frappe.get_doc("File", file_name)
    file.check_permission("read")
    if not file.is_private:
        frappe.throw("面试清单须使用私有附件上传。")
    if not (file.file_name or "").lower().endswith(".xlsx"):
        frappe.throw("请选择 .xlsx 文件。")
    content = file.get_content()
    if len(content) > 10 * 1024 * 1024:
        frappe.throw("文件不能超过 10 MB。")
    if isinstance(corrections, str):
        corrections = json.loads(corrections)
    corrections = corrections or []
    select_options = {
        field.fieldname: list(dict.fromkeys(["", *(field.options or "").split("\n")]))
        for field in frappe.get_meta(DOCTYPE).fields if field.fieldtype == "Select"
    }
    from hrms.hr.interview_register_importer import parse_workbook

    try:
        data = parse_workbook(content, corrections=corrections, select_options=select_options)
    except ValueError as exc:
        frappe.throw(str(exc))
    pending, seen = [], set()
    skipped = 0
    for item in data["rows"]:
        values = item["values"]
        values["company"] = company
        identity = [company, values["candidate_name"], values["phone"], values["interview_date"], values["interview_position"]]
        key = hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()
        # Existing hand-entered registrations are duplicates too. Never overwrite them.
        filters = {field: values[field] for field in ("company", "candidate_name", "phone", "interview_date", "interview_position")}
        if key in seen or frappe.db.exists(DOCTYPE, filters):
            skipped += 1
            continue
        seen.add(key)
        values["import_key"] = key
        values["source_file"] = file_url
        values["source_row"] = item["row"]
        doc = frappe.get_doc({"doctype": DOCTYPE, **values})
        doc.check_permission("create")
        doc.run_method("validate")
        pending.append(doc)
    token = hashlib.sha256(content + json.dumps(
        {"company": company, "corrections": corrections, "select_options": select_options},
        ensure_ascii=False, sort_keys=True,
    ).encode()).hexdigest()
    return {"total": data["total"], "pending": len(pending), "skipped": skipped,
            "errors": data["errors"], "corrections": data["corrections"], "fingerprint": token}, pending


@frappe.whitelist()
def preview_import(file_url: str, company: str, corrections: str | list | None = None):
    summary, _ = _import_data(file_url, company, corrections)
    return summary


@frappe.whitelist()
def import_registrations(file_url: str, company: str, fingerprint: str, corrections: str | list | None = None):
    summary, docs = _import_data(file_url, company, corrections)
    if summary["fingerprint"] != fingerprint:
        frappe.throw("文件或公司发生变化，请重新预览。")
    if summary["errors"]:
        frappe.throw("请修正表格中的错误后重新导入。")
    # A failed insert rolls back this entire request; no partial imports or explicit commits.
    for doc in docs:
        doc.insert()
    return {"imported": len(docs), "skipped": summary["skipped"]}
