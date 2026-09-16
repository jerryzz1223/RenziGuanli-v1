import frappe
from frappe import _
from frappe.utils import get_datetime, now_datetime


@frappe.whitelist()
def get_pending_employee_separations(
	company: str | None = None, search: str | None = None
) -> dict:
	"""Return approved separations awaiting or tracking actual departure time."""
	from hrms.access_control import require_hrms_capability

	require_hrms_capability("separation_effective", legacy_roles=("HR Manager",))
	if not frappe.has_permission("Employee Separation", ptype="read"):
		frappe.throw(_("您没有查看实际离职办理的权限。"), frappe.PermissionError)

	filters = {"docstatus": 1, "boarding_status": "Completed"}
	if company:
		filters["company"] = company
	separations = frappe.get_all(
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
			"modified",
		],
		order_by="boarding_begins_on asc, modified desc",
		limit_page_length=0,
	)

	needle = str(search or "").strip().casefold()
	rows = []
	for separation in separations:
		# Once an actual departure time has been recorded, this item is no longer
		# an operation waiting in the queue. The scheduled job will apply the
		# employee's final state when a future time arrives.
		if separation.departed_on:
			continue
		employee = frappe.db.get_value(
			"Employee",
			separation.employee,
			["status", "employee_name", "custom_employee_code"],
			as_dict=True,
		)
		if not employee or employee.status == "Left":
			continue

		row = frappe._dict(
			{
				"separation_name": separation.name,
				"employee": separation.employee,
				"employee_code": employee.custom_employee_code or separation.employee_code_display or "",
				"employee_name": employee.employee_name or separation.employee_name or "",
				"department": separation.department or "",
				"designation": separation.designation or "",
				"planned_departure_date": separation.boarding_begins_on,
				"approval_time": separation.approved_on,
				"actual_departure_time": None,
				"status": "待离职",
			}
		)
		if row.actual_departure_time and get_datetime(row.actual_departure_time) <= now_datetime():
			row.status = "已离职待同步"
		if needle and not any(
			needle in str(value or "").casefold()
			for value in (row.employee_code, row.employee_name, row.department, row.designation)
		):
			continue
		rows.append(row)

	return {"rows": rows, "total": len(rows)}
