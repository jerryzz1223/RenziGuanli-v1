"""Permission-scoped, reusable support counts for the support page and profile exports."""
from __future__ import annotations

from collections import Counter
import re

import frappe
from frappe import _
from frappe.utils import getdate, nowdate

DOCTYPE = "Cross Department Support Record"
COUNTING_RULE = "仅统计有权查看的已提交支援记录；员工以 Employee.name 为唯一键，同一员工同一来源单号计一次，归属最早支援开始月份，跨月不重复计次；累计为全部月份，草稿和取消不计次。"


def summarize_support_records(records, employee, month):
    """Do not infer an occurrence from qualification rows, days or hours."""
    sources = {}
    for row in records:
        reference = (row.get("source_reference") or "").strip()
        if row.get("employee") != employee or row.get("docstatus") != 1 or not reference or not row.get("support_date"):
            continue
        support_date = getdate(row["support_date"]).isoformat()
        sources[reference] = min(sources.get(reference, support_date), support_date)
    counts = Counter(value[:7] for value in sources.values())
    return {
        "employee": employee,
        "month": month,
        "monthly_count": counts.get(month, 0),
        "total_count": len(sources),
        "months": [{"month": key, "count": counts[key]} for key in sorted(counts, reverse=True)],
        "counting_rule": COUNTING_RULE,
    }


@frappe.whitelist()
def get_employee_support_counts(employee: str, month: str | None = None):
    """Counts cover visible submitted history, not just the selected month.

    Full-history export callers can reuse this function for each permitted employee.
    get_list is intentional: get_all/SQL would bypass record user permissions.
    """
    month = month or nowdate()[:7]
    if not isinstance(month, str) or not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", month):
        frappe.throw(_("月份格式应为 YYYY-MM。"))
    if not employee:
        frappe.throw(_("请选择员工。"))
    frappe.get_doc("Employee", employee).check_permission("read")
    if not storage_ready(DOCTYPE):
        return {"employee": employee, "month": month, "monthly_count": None, "total_count": None,
                "months": [], "available": False, "message": "支援台账尚未安装，请管理员更新站点并执行迁移。", "counting_rule": COUNTING_RULE}
    if not frappe.has_permission(DOCTYPE, "read"):
        frappe.throw(_("你没有查看支援记录的权限。"), frappe.PermissionError)
    records = []
    start = 0
    while True:
        batch = frappe.get_list(
            DOCTYPE,
            filters={"employee": employee, "docstatus": 1},
            fields=["name", "employee", "source_reference", "support_date", "docstatus"],
            order_by="name asc", limit_start=start, limit_page_length=500,
        )
        records.extend(batch)
        if len(batch) < 500:
            break
        start += len(batch)
    return {**summarize_support_records(records, employee, month), "available": True}


EXCLUSION = "Cross Department Support Exclusion"


def storage_ready(doctype):
    return bool(frappe.db.exists("DocType", doctype) and frappe.db.table_exists(doctype))


def visible_rows(doctype, filters, fields):
    rows, start = [], 0
    while True:
        batch = frappe.get_list(doctype, filters=filters, fields=fields,
                                order_by="name asc", limit_start=start, limit_page_length=500)
        rows.extend(batch)
        if len(batch) < 500:
            return rows
        start += len(batch)


@frappe.whitelist()
def get_support_overview(capabilities: str, month: str | None = None, dispatch_date: str | None = None):
    """Batch the visible page, preserving capability and record user permissions."""
    names = frappe.parse_json(capabilities)
    if not isinstance(names, list) or len(names) > 100 or any(not isinstance(n, str) for n in names):
        frappe.throw(_("一次最多查询 100 条支援资格。"))
    month = month or nowdate()[:7]
    if not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", month):
        frappe.throw(_("月份格式应为 YYYY-MM。"))
    day = getdate(dispatch_date or nowdate()).isoformat()
    capabilities = frappe.get_list("Cross Department Support Capability", filters={"name": ["in", names]},
                                   fields=["name", "employee"], limit_page_length=100) if names else []
    employees = sorted({r.employee for r in capabilities if r.employee})
    employees = [e for e in employees if frappe.has_permission("Employee", "read", doc=frappe.get_doc("Employee", e))]
    counts_ready = storage_ready(DOCTYPE) and frappe.has_permission(DOCTYPE, "read")
    exclusions_ready = storage_ready(EXCLUSION) and frappe.has_permission(EXCLUSION, "read")
    records = visible_rows(DOCTYPE, {"employee": ["in", employees], "docstatus": 1},
                           ["employee", "source_reference", "support_date", "docstatus"]) if employees and counts_ready else []
    exclusions = visible_rows(EXCLUSION, {"employee": ["in", employees], "is_active": 1,
                              "from_date": ["<=", day], "to_date": [">=", day]},
                              ["name", "employee", "from_date", "to_date", "reason"]) if employees and exclusions_ready else []
    return {"counts_ready": bool(counts_ready), "exclusions_ready": bool(exclusions_ready),
            "rows": {e: {**(summarize_support_records(records, e, month) if counts_ready else
                               {"monthly_count": None, "total_count": None}),
                         "exclusions": [x for x in exclusions if x.employee == e]} for e in employees}}


@frappe.whitelist()
def get_support_details(capability: str, month: str | None = None):
    doc = frappe.get_doc("Cross Department Support Capability", capability)
    doc.check_permission("read")
    result = {"counts": None, "records": [], "exclusions": [],
              "records_ready": bool(storage_ready(DOCTYPE) and frappe.has_permission(DOCTYPE, "read")),
              "exclusions_ready": bool(storage_ready(EXCLUSION) and frappe.has_permission(EXCLUSION, "read"))}
    if not doc.employee:
        return result
    if result["records_ready"] and frappe.has_permission(DOCTYPE, "read"):
        result["counts"] = get_employee_support_counts(doc.employee, month)
    if result["exclusions_ready"] and frappe.has_permission(EXCLUSION, "read"):
        result["exclusions"] = visible_rows(EXCLUSION, {"employee": doc.employee, "is_active": 1},
            ["name", "from_date", "to_date", "reason"])
    return result


@frappe.whitelist()
def save_support_exclusion(capability: str, from_date: str, to_date: str, reason: str):
    capability_doc = frappe.get_doc("Cross Department Support Capability", capability)
    capability_doc.check_permission("read")
    if not storage_ready(EXCLUSION):
        frappe.throw(_("支援排除表尚未安装，请管理员更新站点并执行迁移。"))
    if not capability_doc.employee:
        frappe.throw(_("请先为该支援资格关联员工。"))
    doc = frappe.get_doc({"doctype": EXCLUSION, "employee": capability_doc.employee,
                          "from_date": from_date, "to_date": to_date, "reason": reason, "is_active": 1})
    doc.insert()
    return {"name": doc.name}


@frappe.whitelist()
def revoke_support_exclusion(name: str):
    doc = frappe.get_doc(EXCLUSION, name)
    doc.check_permission("write")
    doc.is_active = 0
    doc.save()
    return {"name": doc.name}


CAPABILITY = "Cross Department Support Capability"


def _dispatch_employee(capability):
    doc = frappe.get_doc(CAPABILITY, capability)
    doc.check_permission("read")
    if not doc.employee:
        frappe.throw(_("请先为支援资格关联员工。"))
    frappe.get_doc("Employee", doc.employee).check_permission("read")
    return doc


@frappe.whitelist()
def get_dispatch_options(capability: str):
    doc = _dispatch_employee(capability)
    rows = visible_rows(CAPABILITY, {"employee": doc.employee, "is_active": 1, "qualification_status": "有效"},
                        ["name", "support_department", "support_designation", "valid_from", "valid_until"])
    return {"employee": doc.employee, "employee_name": doc.employee_name, "capabilities": rows,
            "can_add": bool(frappe.has_permission(CAPABILITY, "create")),
            "can_dispatch": bool(storage_ready(DOCTYPE) and frappe.has_permission(DOCTYPE, "create")
                                 and frappe.has_permission(DOCTYPE, "submit"))}


@frappe.whitelist()
def dispatch_employee_support(capability: str, support_department: str, support_designation: str,
                              support_date: str, end_date: str, request_id: str,
                              add_new: int | str = 0, remarks: str | None = None):
    """One transaction: optionally retain a qualification, then submit a dispatch.

    Employee locking serializes qualification creation and double-click retries.
    A failed insert/submit rolls back the newly created qualification with the request.
    """
    source = _dispatch_employee(capability)
    if not storage_ready(DOCTYPE):
        frappe.throw(_("支援记录暂不可用，请联系管理员启用。"))
    for permission in ("create", "submit"):
        if not frappe.has_permission(DOCTYPE, permission):
            frappe.throw(_("你没有确认派出支援的权限。"), frappe.PermissionError)
    if not request_id or not re.fullmatch(r"[A-Za-z0-9-]{16,80}", request_id):
        frappe.throw(_("派出请求无效，请重新打开窗口。"))
    if not support_date or not end_date or getdate(end_date) < getdate(support_date):
        frappe.throw(_("请填写有效的支援起止日期。"))
    start, end = getdate(support_date), getdate(end_date)
    department = (support_department or "").strip()
    designation = (support_designation or "").strip()
    if not department or not designation or len(designation) > 140:
        frappe.throw(_("请选择支援部门并填写有效的支援岗位（最多 140 字）。"))
    frappe.db.sql("SELECT name FROM `tabEmployee` WHERE name=%s FOR UPDATE", (source.employee,))
    reference = "DISPATCH-" + request_id
    existing = frappe.db.get_value(DOCTYPE, {"employee": source.employee, "source_reference": reference}, "name")
    if existing:
        record = frappe.get_doc(DOCTYPE, existing)
        record.check_permission("read")
        if record.docstatus != 1:
            frappe.throw(_("该派出请求已有未生效或已取消的记录，请重新发起。"))
        return {"name": record.name, "already_created": True}
    if storage_ready(EXCLUSION):
        if not frappe.has_permission(EXCLUSION, "read"):
            frappe.throw(_("无法核对该员工的排除时段，请联系管理员授权。"), frappe.PermissionError)
        exclusions = visible_rows(EXCLUSION, {"employee": source.employee, "is_active": 1,
                                  "from_date": ["<=", end], "to_date": [">=", start]}, ["name"])
        if exclusions:
            frappe.throw(_("所选日期与该员工的排除派遣时段重叠，请调整日期。"))
    qualifications = visible_rows(CAPABILITY, {"employee": source.employee},
                                  ["name", "support_department", "support_designation", "is_active",
                                   "qualification_status", "valid_from", "valid_until"])
    matches = [q for q in qualifications if q.support_department == department and q.support_designation == designation]
    qualified = next((q for q in matches if q.is_active and q.qualification_status == "有效"
                      and (not q.valid_from or getdate(q.valid_from) <= start)
                      and (not q.valid_until or getdate(q.valid_until) >= end)), None)
    if not qualified:
        if matches:
            frappe.throw(_("该岗位资格暂停、失效或不覆盖所选支援日期，请先维护支援能力。"))
        if not frappe.utils.cint(add_new):
            frappe.throw(_("请选择该员工已有的可支援岗位，或选择添加新岗位。"))
        if not frappe.has_permission(CAPABILITY, "create"):
            frappe.throw(_("你没有新增支援岗位的权限。"), frappe.PermissionError)
        qualified = frappe.get_doc({"doctype": CAPABILITY, "employee": source.employee,
                                    "support_department": department, "support_designation": designation,
                                    "qualification_status": "有效", "is_active": 1})
        qualified.insert()
    record = frappe.get_doc({"doctype": DOCTYPE, "employee": source.employee,
                             "source_reference": reference, "support_date": start, "end_date": end,
                             "support_department": department, "support_designation": designation,
                             "capability": qualified.name, "remarks": remarks})
    record.insert()
    record.submit()
    return {"name": record.name, "already_created": False}
