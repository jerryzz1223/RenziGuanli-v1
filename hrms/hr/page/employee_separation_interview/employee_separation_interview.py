import frappe
from frappe import _


def _require_interview_access():
	from hrms.access_control import require_hrms_capability

	require_hrms_capability("separation_approve", legacy_roles=("HR Manager",))
	if not frappe.has_permission("Employee Separation", ptype="read"):
		frappe.throw(_("您没有查看离职面谈的权限。"), frappe.PermissionError)


@frappe.whitelist()
def get_employee_separation_interviews(
	company: str | None = None, search: str | None = None
) -> dict:
	"""Return approved separation records whose interview belongs to the separation."""
	_require_interview_access()
	filters = {"docstatus": 1, "boarding_status": "Completed"}
	if company:
		filters["company"] = company
	rows = frappe.get_all(
		"Employee Separation",
		filters=filters,
		fields=[
			"name",
			"employee",
			"employee_code_display",
			"employee_name",
			"department",
			"designation",
			"boarding_begins_on",
			"approved_on",
			"departed_on",
			"exit_interview",
			"modified",
		],
		order_by="approved_on desc, modified desc",
		limit_page_length=0,
	)
	needle = str(search or "").strip().casefold()
	if needle:
		rows = [
			row
			for row in rows
			if any(
				needle in str(row.get(fieldname) or "").casefold()
				for fieldname in (
					"employee_code_display",
					"employee_name",
					"department",
					"designation",
				)
			)
		]
	return {
		"rows": [
			{
				"separation_name": row.name,
				"employee": row.employee,
				"employee_code": row.employee_code_display or "",
				"employee_name": row.employee_name or "",
				"department": row.department or "",
				"designation": row.designation or "",
				"planned_departure_date": row.boarding_begins_on,
				"approval_time": row.approved_on,
				"actual_departure_time": row.departed_on,
				"exit_interview": row.exit_interview or "",
				"modified": row.modified,
			}
			for row in rows
		],
		"total": len(rows),
	}


@frappe.whitelist()
def save_employee_separation_interview(
	separation_name: str, exit_interview: str | None = None
) -> dict:
	"""Save the interview on the approved separation for downstream records."""
	_require_interview_access()
	separation = frappe.get_doc("Employee Separation", separation_name)
	separation.check_permission("write")
	if separation.docstatus != 1 or separation.boarding_status != "Completed":
		frappe.throw(_("只有离职审批通过后才能填写离职面谈。"))

	interview = str(exit_interview or "").strip()
	separation.db_set("exit_interview", interview, update_modified=True)
	return {
		"separation_name": separation.name,
		"exit_interview": interview,
		"updated_by": frappe.session.user,
	}
