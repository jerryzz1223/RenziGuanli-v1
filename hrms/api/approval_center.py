"""Permission-aware, read-only index of approvals handled across HRMS."""

import json

import frappe
from frappe.utils import cint

from hrms.access_control import has_hrms_capability


# Only explicit approval states are included. In particular, a completed workflow
# action is not evidence that the underlying request was approved.
SOURCES = (
	{"doctype": "HRMS Announcement", "label": "公告审批", "state": "status", "pending": ("待审核",), "approved": ("审核通过", "待上传签字", "已签字"), "title": "subject", "actor": "reviewer_user", "actor_name": "reviewer_name", "date": "reviewed_on", "submitted": "submitted_on", "capability": "announcement_approve", "route": "announcement-approval", "approved_route": "announcement-approval-records"},
	{"doctype": "Employee Separation", "label": "离职审批", "state": "boarding_status", "pending": ("Pending",), "approved": ("Completed",), "title": "employee_name", "actor": "approved_by", "date": "approved_on", "filters": {"docstatus": 1}, "route": "employee-separation-approval", "approved_route": "Form", "capability": "separation_approve"},
	{"doctype": "HRMS Employee Salary Change", "label": "定薪变更", "state": "status", "pending": ("待审核",), "approved": ("已批准",), "title": "employee_name", "actor": "approved_by", "date": "approved_on", "submitted": "submitted_on", "route": "payroll-input-center/salary-approvals", "approved_route": "payroll-input-center/salary-history", "standing_approval": True},
	{"doctype": "HRMS Employee Contribution Change", "label": "社保公积金变更", "state": "status", "pending": ("待审核",), "approved": ("已批准",), "title": "employee_name", "actor": "approved_by", "date": "approved_on", "submitted": "submitted_on", "route": "payroll-input-center/salary-approvals", "approved_route": "payroll-input-center/salary-history", "standing_approval": True},
	{"doctype": "HRMS DingTalk Employee Import", "label": "钉钉员工导入", "state": "import_status", "pending": ("待审批",), "approved": ("已批准",), "title": "employee_name", "actor": "approved_by", "date": "approved_at", "submitted": "submitted_at", "capability": "dingtalk_employee_import_approve", "route": "attendance-import-center/dingtalk"},
	{"doctype": "HRMS Form Import Row", "label": "表单导入审批", "state": "review_status", "pending": ("待审核", "审批中"), "approved": ("已批准",), "title": "employee_name", "actor": "reviewed_by", "date": "reviewed_on", "route": "form-data-intake", "pending_roles": ("System Manager", "HR Manager")},
	{"doctype": "HRMS Attendance Processing Record", "label": "考勤异常审核", "state": "review_status", "pending": ("待审核",), "approved": ("已通过",), "title": "employee_name", "actor": "reviewer", "date": "reviewed_on", "route": "attendance-import-center/exceptions", "pending_roles": ("System Manager", "HR Manager")},
	{"doctype": "HRMS Employee Registration", "label": "员工入职审核", "state": "status", "pending": ("待审核",), "approved": ("已通过",), "title": "employee_name", "actor": "reviewed_by", "date": "reviewed_on", "pending_capability": "employee_create_approve"},
	{"doctype": "HRMS Employee Reward Punishment", "label": "奖惩审批", "state": "status", "pending": ("待审核",), "approved": ("已生效",), "title": "subject", "actor": "approved_by", "date": "approved_on", "pending_roles": ("System Manager", "HR Manager")},
	{"doctype": "HRMS Monthly Payroll Participation", "label": "薪酬参与审核", "state": "review_status", "pending": ("待审核",), "approved": ("审核通过",), "title": "employee_name", "actor": "approved_by", "date": "approved_on", "route": "payroll-input-center/monthly-workbench", "pending_roles": ("System Manager", "HR Manager", "薪酬规则配置")},
)

WORKFLOW_LABELS = {
	"Expense Claim": "费用报销",
	"Travel Request": "出差申请",
	"Leave Application": "请假申请",
	"Shift Request": "调班申请",
	"Employee Advance": "员工预支",
}


def _can_list(source, view):
	if not frappe.has_permission(source["doctype"], "read"):
		return False
	if source.get("capability") and not has_hrms_capability(source["capability"]):
		return False
	if view == "pending":
		if source.get("pending_capability") and not has_hrms_capability(source["pending_capability"]):
			return False
		if source.get("pending_roles") and frappe.session.user != "Administrator" and not set(source["pending_roles"]) & set(frappe.get_roles(frappe.session.user)):
			return False
		if source.get("standing_approval"):
			from hrms.payroll.standing_permissions import can_approve
			if not can_approve():
				return False
	return True


def _route(source, row, view):
	route = source.get("approved_route") if view == "approved" else None
	route = route or source.get("route")
	if route == "Form":
		return ["Form", source["doctype"], row.name]
	if route:
		return route.split("/") + ([row.name] if source["doctype"] == "HRMS Announcement" else [])
	return ["Form", source["doctype"], row.name]


def _list_source(source, view, limit):
	if not _can_list(source, view):
		return []
	states = source["pending"] if view == "pending" else source["approved"]
	fields = {"name", "creation", source["state"], source["title"]}
	fields.update(key for key in (source.get("actor"), source.get("actor_name"), source.get("date"), source.get("submitted")) if key)
	filters = {**source.get("filters", {}), source["state"]: ["in", states]}
	rows = frappe.get_list(source["doctype"], filters=filters, fields=sorted(fields), order_by="creation desc", limit_page_length=limit)
	result = []
	for row in rows:
		actor = row.get(source.get("actor")) if source.get("actor") else ""
		result.append({
			"key": f"{source['doctype']}:{row.name}", "doctype": source["doctype"], "name": row.name,
			"type": source["label"], "title": row.get(source["title"]) or row.name,
			"status": row.get(source["state"]) or "", "submitted_on": str(row.get(source.get("submitted")) or row.creation or ""),
			"approved_by": actor or "", "approved_by_name": row.get(source.get("actor_name")) or "",
			"approved_on": str(row.get(source.get("date")) or ""), "route": _route(source, row, view),
		})
	return result


def _workflow_tasks(limit, known):
	if not frappe.has_permission("Workflow Action", "read"):
		return []
	rows = frappe.get_list(
		"Workflow Action", filters={"user": frappe.session.user, "status": "Open"},
		fields=["name", "reference_doctype", "reference_name", "creation"],
		order_by="creation desc", limit_page_length=limit,
	)
	result = []
	for row in rows:
		key = f"{row.reference_doctype}:{row.reference_name}"
		if key in known or not row.reference_doctype or not row.reference_name:
			continue
		if not frappe.has_permission(row.reference_doctype, "read", row.reference_name):
			continue
		result.append({
			"key": key, "doctype": row.reference_doctype, "name": row.reference_name,
			"type": WORKFLOW_LABELS.get(row.reference_doctype, row.reference_doctype),
			"title": row.reference_name, "status": "待审批", "submitted_on": str(row.creation or ""),
			"approved_by": "", "approved_by_name": "", "approved_on": "",
			"route": ["Form", row.reference_doctype, row.reference_name],
		})
	return result


def _monthly_final_rows(view, limit):
	"""Index the persisted monthly approval ledger without changing its state."""
	if not frappe.has_permission("HRMS Attendance Import Batch", "read"):
		return []
	if view == "pending" and not has_hrms_capability("attendance_final_approve"):
		return []
	if view == "approved" and not (has_hrms_capability("attendance_view") or has_hrms_capability("attendance_final_approve")):
		return []
	batches = frappe.get_list(
		"HRMS Attendance Import Batch", filters={"source_type": "attendance_draft"},
		fields=["name", "company", "attendance_month", "notes", "creation"],
		order_by="creation desc", limit_page_length=min(max(limit * 5, 200), 5000),
	)
	items, seen_months, seen_events = [], set(), set()
	for batch in batches:
		if not batch.company or not batch.attendance_month:
			continue
		try:
			meta = (json.loads(batch.notes or "{}") or {}).get("attendance_processing_center") or {}
		except (TypeError, ValueError, AttributeError):
			continue
		month_key = (batch.company, batch.attendance_month)
		if view == "pending":
			if month_key in seen_months:
				continue
			seen_months.add(month_key)
			approval = meta.get("monthly_final_approval") or {}
			if approval.get("status") != "待审批":
				continue
			from hrms.api.attendance_processing_center import _monthly_final_approval_state
			state = _monthly_final_approval_state(batch.company, batch.attendance_month)
			if not state.get("can_approve"):
				continue
			items.append({
				"key": f"monthly-final:{batch.company}:{batch.attendance_month}", "doctype": "HRMS Attendance Import Batch", "name": batch.name,
				"type": "月度考勤终稿", "title": f"{batch.company} · {batch.attendance_month}", "status": "待审批",
				"submitted_on": str(state.get("submitted_on") or batch.creation or ""), "approved_by": "", "approved_by_name": "", "approved_on": "",
				"route": ["attendance-import-center", "monthly-final"],
			})
		else:
			for event in meta.get("monthly_final_approval_history") or []:
				if not isinstance(event, dict) or event.get("action") != "已批准":
					continue
				event_key = (batch.company, batch.attendance_month, event.get("snapshot_version"), event.get("operator"), event.get("occurred_on"))
				if event_key in seen_events:
					continue
				seen_events.add(event_key)
				items.append({
					"key": "monthly-final:" + ":".join(str(part or "") for part in event_key), "doctype": "HRMS Attendance Import Batch", "name": batch.name,
					"type": "月度考勤终稿", "title": f"{batch.company} · {batch.attendance_month}", "status": "已批准（历史快照）",
					"submitted_on": str(batch.creation or ""), "approved_by": str(event.get("operator") or ""), "approved_by_name": "",
					"approved_on": str(event.get("occurred_on") or ""), "route": ["attendance-import-center", "monthly-final"],
				})
	return items


@frappe.whitelist()
def list_approvals(view="pending", page_length=50, page_start=0):
	"""List visible requests; approved history uses only persisted passing states."""
	if frappe.session.user == "Guest":
		frappe.throw("请先登录。", frappe.PermissionError)
	if view not in {"pending", "approved"}:
		frappe.throw("审批视图无效。")
	limit = min(max(cint(page_length) or 50, 1), 100)
	start = max(cint(page_start), 0)
	if start > 5000:
		frappe.throw("审批记录翻页范围过大，请缩小查询范围。")
	needed = start + limit + 1
	items = []
	for source in SOURCES:
		items.extend(_list_source(source, view, needed))
	items.extend(_monthly_final_rows(view, needed))
	if view == "pending":
		items.extend(_workflow_tasks(needed, {item["key"] for item in items}))
	items.sort(key=lambda item: item["approved_on"] or item["submitted_on"], reverse=True)
	page = items[start:start + limit]
	if view == "approved":
		users = {item["approved_by"] for item in page if item["approved_by"] and not item["approved_by_name"]}
		if users:
			names = {row.name: row.full_name for row in frappe.get_all("User", filters={"name": ["in", list(users)]}, fields=["name", "full_name"])}
			for item in page:
				item["approved_by_name"] = item["approved_by_name"] or names.get(item["approved_by"], item["approved_by"])
	return {"items": page, "has_more": len(items) > start + limit}
