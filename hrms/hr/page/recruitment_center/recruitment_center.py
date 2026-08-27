"""Read-only data feed for the recruitment centre.

The page deliberately links to the standard HRMS documents for every write
operation.  That keeps workflow, audit trail and document permissions in one
place instead of duplicating candidate data in a dashboard-specific table.
"""

import frappe
from frappe.utils import add_days, cint, getdate, nowdate


REQUIRED_DOCTYPES = ("Job Requisition", "Job Opening", "Job Applicant", "Interview", "Job Offer")


def _can_read(doctype):
	return frappe.db.exists("DocType", doctype) and frappe.has_permission(doctype, "read")


def _count(doctype, filters=None):
	"""Count through get_list so user permission conditions remain effective."""
	if not _can_read(doctype):
		return 0
	rows = frappe.get_list(doctype, fields=["count(name) as total"], filters=filters or {}, page_length=1)
	return cint(rows[0].total) if rows else 0


def _list(doctype, fields, filters=None, order_by="modified desc", page_length=8):
	if not _can_read(doctype):
		return []
	return frappe.get_list(
		doctype,
		fields=fields,
		filters=filters or {},
		order_by=order_by,
		page_length=page_length,
	)


def _status_totals():
	if not _can_read("Job Applicant"):
		return {}
	rows = frappe.get_list(
		"Job Applicant",
		fields=["status", "count(name) as total"],
		group_by="status",
		page_length=20,
	)
	return {row.status: cint(row.total) for row in rows if row.status}


def _applicant_names(names):
	if not names or not _can_read("Job Applicant"):
		return {}
	rows = frappe.get_list(
		"Job Applicant", fields=["name", "applicant_name"], filters={"name": ["in", list(set(names))]}, page_length=len(names)
	)
	return {row.name: row.applicant_name for row in rows}


@frappe.whitelist()
def get_recruitment_data():
	"""Return the work queue visible to the current HRMS user only."""
	if not any(_can_read(doctype) for doctype in REQUIRED_DOCTYPES):
		frappe.throw("无权查看招聘数据。", frappe.PermissionError)

	today = getdate(nowdate())
	week_end = add_days(today, 7)
	applicant_totals = _status_totals()

	interviews = _list(
		"Interview",
		["name", "job_applicant", "interview_type", "scheduled_on", "from_time", "to_time", "status"],
		filters={"scheduled_on": ["between", [today, week_end]], "status": ["in", ["Pending", "Under Review"]], "docstatus": ["!=", 2]},
		order_by="scheduled_on asc, from_time asc",
	)
	applicant_names = _applicant_names([row.job_applicant for row in interviews])
	for row in interviews:
		row.applicant_name = applicant_names.get(row.job_applicant, row.job_applicant)

	return {
		"today": str(today),
		"summary": {
			"pending_requisitions": _count("Job Requisition", {"status": "Pending"}),
			"open_openings": _count("Job Opening", {"status": "Open"}),
			"active_applicants": sum(
				applicant_totals.get(status, 0) for status in ("Open", "Replied", "Shortlisted", "Hold")
			),
			"upcoming_interviews": len(interviews),
			"offers_awaiting_response": _count(
				"Job Offer", {"status": "Awaiting Response", "docstatus": 1}
			),
			"onboarding_in_progress": _count(
				"Employee Onboarding", {"boarding_status": ["in", ["Pending", "In Process"]], "docstatus": ["!=", 2]}
			),
		},
		"pipeline": [
			{"label": "待初筛", "status": "Open", "total": applicant_totals.get("Open", 0)},
			{"label": "已入围", "status": "Shortlisted", "total": applicant_totals.get("Shortlisted", 0)},
			{"label": "暂缓", "status": "Hold", "total": applicant_totals.get("Hold", 0)},
			{"label": "已录用", "status": "Accepted", "total": applicant_totals.get("Accepted", 0)},
		],
		"interviews": interviews,
		"offers": _list(
			"Job Offer",
			["name", "applicant_name", "designation", "offer_date", "status"],
			filters={"status": "Awaiting Response", "docstatus": 1},
			order_by="offer_date asc",
			page_length=6,
		),
		"onboarding": _list(
			"Employee Onboarding",
			["name", "employee_name", "designation", "date_of_joining", "boarding_status"],
			filters={"boarding_status": ["in", ["Pending", "In Process"]], "docstatus": ["!=", 2]},
			order_by="date_of_joining asc",
			page_length=6,
		),
	}
