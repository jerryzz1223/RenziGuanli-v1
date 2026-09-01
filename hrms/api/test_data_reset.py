"""Temporary, company-scoped data reset support for the TEST-HRMS trial.

This module deliberately has no hooks into normal business logic.  The matching
Desk script is the only caller, so removing the marked hook entries plus this
module and the paired ``hrms_test_data_reset`` front-end assets fully retires it.
"""

from __future__ import annotations

import json
from collections import OrderedDict

import frappe
from frappe import _


TEST_COMPANY = "TEST-HRMS"
CONFIRMATION_TEXT = "CLEAR TEST-HRMS PAGE DATA"

# Delete dependants before their source documents.  Every entry is additionally
# constrained by the TEST-HRMS company (or a TEST-HRMS employee link).
PAGE_TARGETS = {
	"attendance": (
		"HRMS Apple Reward Record",
		"HRMS Attendance Exception",
		"HRMS Attendance Leave Evidence",
		"HRMS Monthly Attendance Summary",
		"HRMS Attendance Lock Audit",
		"HRMS Attendance Month Lock",
		"HRMS Attendance Day Check",
		"HRMS Attendance Import Batch",
	),
	"payroll": (
		"HRMS Payroll Settlement Record",
		"HRMS Payroll Input Record",
		"HRMS Payroll Variable Record",
		"HRMS Payroll Welfare Source Record",
		"HRMS Employee Salary Change",
		"HRMS Payroll Variable Import Batch",
	),
	"form_intake": (
		"HRMS Form Import Row",
		"HRMS Business Process Record",
		"HRMS Form Import Batch",
	),
	"personnel_roster": ("Employee",),
	"personnel_history": ("Employee Promotion", "Employee Transfer"),
	"employee_detail": ("Employee",),
	"organization": ("Department",),
	"recruitment": (
		"Job Offer",
		"Interview Feedback",
		"Interview",
		"Job Applicant",
		"Job Opening",
		"Job Requisition",
		"Staffing Plan",
	),
	"dingtalk": (
		"HRMS DingTalk Raw Record",
		"HRMS DingTalk Sync Log",
		"HRMS DingTalk User Map",
	),
}

PAGE_SCOPES = {
	"personnel": ("personnel_roster", _("员工花名册数据")),
	"recruitment": ("recruitment", _("招聘录入数据")),
	"attendance-import-center": ("attendance", _("考勤录入数据")),
	"payroll-input-center": ("payroll", _("薪酬录入数据")),
	"form-data-intake": ("form_intake", _("表单导入数据")),
	"employee-property-history": ("personnel_history", _("人事异动记录")),
	"employee-roster-import": ("personnel_roster", _("花名册导入的员工数据")),
	"organizational-chart": ("organization", _("组织录入数据")),
}

# Some standard DocTypes do not carry a Company field themselves, but their
# linked parent does.  The relation lets the reset work on their List/Form page
# without making unsafe name- or date-based guesses.
LINKED_TEST_FIELDS = {
	"Job Applicant": ("job_title", "Job Opening"),
	"Interview": ("job_opening", "Job Opening"),
	"Interview Feedback": ("interview", "Interview"),
}


def _require_trial_access():
	if not frappe.db.exists("Company", TEST_COMPANY):
		frappe.throw(_("当前站点未启用 TEST-HRMS 测试公司，不能使用测试数据清除功能。"))
	if "System Manager" not in frappe.get_roles():
		frappe.throw(_("只有系统管理员可以清除 TEST-HRMS 测试数据。"), frappe.PermissionError)


def _route_parts(route):
	if isinstance(route, str):
		try:
			route = json.loads(route)
		except json.JSONDecodeError:
			route = route.split("/")
	return [str(part) for part in (route or []) if part]


def _resolve_scope(route):
	parts = _route_parts(route)
	page = parts[0] if parts else ""
	if page == "employee-detail":
		# The detail route is employee-detail/<employee name>.  An absent record
		# name is deliberately treated as an empty selection, never as all staff.
		return "employee_detail", _("当前员工档案"), parts[1] if len(parts) > 1 else ""
	if page in PAGE_SCOPES:
		scope, label = PAGE_SCOPES[page]
		return scope, label, ""
	if page == "attendance-import-center" and "dingtalk" in parts:
		return "dingtalk", _("钉钉同步测试数据"), ""
	if page == "List" and len(parts) > 1:
		doctype = parts[1]
		return "doctype", doctype, ""
	if page == "Form" and len(parts) > 1:
		doctype = parts[1]
		return "doctype", doctype, parts[2] if len(parts) > 2 and not parts[2].startswith("new-") else "__new__"
	return None, _("当前页面"), ""


def _employee_names():
	return frappe.get_all("Employee", filters={"company": TEST_COMPANY}, pluck="name")


def _filters_for_doctype(doctype):
	"""Return the only permitted filter for a test-record deletion.

	A DocType without a company/employee scope is intentionally not cleared.  It
	keeps global master data (rules, templates, credentials, and settings) out of
	the temporary reset button.
	"""
	if not frappe.db.exists("DocType", doctype):
		return None
	meta = frappe.get_meta(doctype)
	if meta.istable:
		return None
	if meta.has_field("company"):
		return {"company": TEST_COMPANY}
	if meta.has_field("employee"):
		employees = _employee_names()
		return {"employee": ["in", employees]} if employees else {"employee": ["in", [""]]}
	if doctype in LINKED_TEST_FIELDS:
		fieldname, parent_doctype = LINKED_TEST_FIELDS[doctype]
		parent_filters = _filters_for_doctype(parent_doctype)
		if parent_filters is None:
			return None
		parents = frappe.get_all(parent_doctype, filters=parent_filters, pluck="name")
		return {fieldname: ["in", parents]} if parents else {fieldname: ["in", [""]]}
	return None


def _target_doctypes(scope, label):
	if scope == "doctype":
		return (label,)
	return PAGE_TARGETS.get(scope, ())


def _records_for(scope, label, record_name=""):
	records = OrderedDict()
	for doctype in _target_doctypes(scope, label):
		filters = _filters_for_doctype(doctype)
		if filters is None:
			continue
		if record_name:
			filters["name"] = record_name
		records[doctype] = frappe.get_all(doctype, filters=filters, pluck="name")
	return records


def _preview(records):
	return [
		{
			"doctype": doctype,
			"count": len(names),
			"sample_names": names[:5],
			"remaining_count": max(0, len(names) - 5),
		}
		for doctype, names in records.items()
	]


@frappe.whitelist()
def get_test_data_reset_context(route: str = ""):
	"""Return the protected, current-page TEST-HRMS cleanup preview."""
	_require_trial_access()
	scope, label, record_name = _resolve_scope(route)
	if not scope:
		return {"enabled": False, "label": label, "count": 0, "message": _("此页面没有可安全清除的测试录入数据。")}
	records = _records_for(scope, label, record_name)
	return {
		"enabled": bool(records),
		"label": label,
		"count": sum(len(names) for names in records.values()),
		"doctypes": {doctype: len(names) for doctype, names in records.items()},
		"preview": _preview(records),
		"company": TEST_COMPANY,
	}


@frappe.whitelist()
def clear_test_page_data(route: str = "", confirm: str = ""):
	"""Delete only the current page's TEST-HRMS records after explicit confirmation."""
	_require_trial_access()
	if confirm != CONFIRMATION_TEXT:
		frappe.throw(_("请确认清除 TEST-HRMS 当前页数据后再执行。"))
	scope, label, record_name = _resolve_scope(route)
	if not scope:
		frappe.throw(_("此页面没有可安全清除的测试录入数据。"))

	deleted = OrderedDict()
	try:
		for doctype, names in _records_for(scope, label, record_name).items():
			deleted[doctype] = []
			for name in names:
				doc = frappe.get_doc(doctype, name)
				doc.flags.ignore_permissions = True
				if doc.docstatus == 1:
					doc.cancel()
				frappe.delete_doc(doctype, name, ignore_permissions=True, force=True)
				deleted[doctype].append(name)
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		raise

	return {
		"label": label,
		"company": TEST_COMPANY,
		"deleted": {doctype: len(names) for doctype, names in deleted.items()},
		"count": sum(len(names) for names in deleted.values()),
	}
