import re

import frappe
from frappe import _
from frappe.utils import cint


@frappe.whitelist()
def get_separation_records(
	company: str | None = None,
	search: str | None = None,
	start: int = 0,
	page_length: int = 50,
) -> dict:
	if not frappe.has_permission("Employee", ptype="read"):
		frappe.throw(_("您没有查看离职记录的权限。"), frappe.PermissionError)

	employees = _get_departed_employees(company)
	employees_by_name = {row.name: row for row in employees}
	can_read_separations = frappe.has_permission("Employee Separation", ptype="read")
	if can_read_separations:
		try:
			submitted_employee_names = _get_submitted_separation_employee_names(company)
			missing_employee_names = [
				name for name in submitted_employee_names if name not in employees_by_name
			]
			for employee in _get_employees_by_names(missing_employee_names, company):
				employees_by_name.setdefault(employee.name, employee)
		except Exception:
			# Employee is the source of truth for departed staff. A stale optional
			# separation field must not make the complete records page unavailable.
			frappe.log_error(title="Employee separation record enrichment failed")
			can_read_separations = False
	employees = list(employees_by_name.values())
	department_names = _get_department_display_names(
		[employee.get("department") for employee in employees]
	)

	separations = {}
	if can_read_separations:
		try:
			separations = _get_latest_separations([row.name for row in employees])
		except Exception:
			frappe.log_error(title="Employee separation detail lookup failed")
	rows = [
		_build_record(employee, separations.get(employee.name), department_names)
		for employee in employees
	]

	needle = str(search or "").strip().casefold()
	if needle:
		rows = [row for row in rows if _matches_search(row, needle)]

	rows.sort(
		key=lambda row: (str(row.departure_date or ""), str(row.modified or "")),
		reverse=True,
	)
	total = len(rows)
	start = max(cint(start), 0)
	page_length = min(max(cint(page_length) or 50, 1), 100)
	return {
		"rows": rows[start : start + page_length],
		"total": total,
		"start": start,
		"page_length": page_length,
		"can_read_separations": can_read_separations,
	}


def _employee_fields():
	meta = frappe.get_meta("Employee")
	candidates = (
		"name",
		"employee_name",
		"company",
		"department",
		"designation",
		"relieving_date",
		"status",
		"modified",
		"custom_employee_code",
	)
	return [fieldname for fieldname in candidates if _meta_has_field(meta, fieldname)]


def _get_departed_employees(company=None):
	fields = _employee_fields()

	filters = {}
	if company and "company" in fields:
		filters["company"] = company
	order_fields = [fieldname for fieldname in ("relieving_date", "modified") if fieldname in fields]

	rows = frappe.get_list(
		"Employee",
		filters=filters,
		fields=fields,
		order_by=", ".join(f"{fieldname} desc" for fieldname in order_fields) or "name desc",
		limit_page_length=0,
	)
	return [row for row in rows if _is_departed_employee(row)]


def _get_submitted_separation_employee_names(company=None):
	meta = frappe.get_meta("Employee Separation")
	if not _meta_has_field(meta, "employee"):
		return []

	filters = {"docstatus": 1}
	if company and _meta_has_field(meta, "company"):
		filters["company"] = company

	rows = frappe.get_list(
		"Employee Separation",
		filters=filters,
		fields=["employee"],
		limit_page_length=0,
	)
	return [row.employee for row in rows if row.employee]


def _get_employees_by_names(employee_names, company=None):
	if not employee_names:
		return []

	filters = {"name": ["in", employee_names]}
	fields = _employee_fields()
	if company and "company" in fields:
		filters["company"] = company
	return frappe.get_list(
		"Employee",
		filters=filters,
		fields=fields,
		limit_page_length=0,
	)


def _is_departed_employee(employee):
	return employee.get("status") == "Left"


def _get_latest_separations(employee_names):
	if not employee_names:
		return {}
	meta = frappe.get_meta("Employee Separation")
	if not _meta_has_field(meta, "employee"):
		return {}
	fields = [
		fieldname
		for fieldname in (
			"name",
			"employee",
			"docstatus",
			"boarding_begins_on",
			"boarding_status",
			"exit_interview",
			"modified",
		)
		if _meta_has_field(meta, fieldname)
	]
	order_fields = [
		fieldname
		for fieldname in ("employee", "docstatus", "boarding_begins_on", "modified")
		if fieldname in fields
	]

	rows = frappe.get_list(
		"Employee Separation",
		filters={"employee": ["in", employee_names], "docstatus": ["<", 2]},
		fields=fields,
		order_by=", ".join(
			f"{fieldname} {'asc' if fieldname == 'employee' else 'desc'}"
			for fieldname in order_fields
		),
		limit_page_length=0,
	)
	latest = {}
	for row in rows:
		latest.setdefault(row.employee, row)
	return latest


def _build_record(employee, separation=None, department_names=None):
	department = employee.get("department") or ""
	return frappe._dict(
		{
			"employee": employee.get("name"),
			"employee_code": employee.get("custom_employee_code") or "",
			"employee_name": employee.get("employee_name") or "",
			"company": employee.get("company") or "",
			"department": department,
			"department_display": _department_display_name(department, department_names),
			"designation": employee.get("designation") or "",
			"departure_date": employee.get("relieving_date")
			or (separation.get("boarding_begins_on") if separation else None),
			"separation_name": separation.get("name") if separation else None,
			"separation_status": separation.get("boarding_status") if separation else None,
			"exit_interview": separation.get("exit_interview") if separation else None,
			"modified": separation.get("modified") if separation else employee.get("modified"),
		}
	)


def _strip_department_company_suffix(value):
	text = str(value or "").strip()
	return re.sub(r"\s+-\s+[^-]+$", "", text).strip()


def _get_department_display_names(department_values):
	values = sorted({value for value in department_values if value})
	if not values:
		return {}

	try:
		rows = frappe.get_all(
			"Department",
			filters={"name": ["in", values]},
			fields=["name", "department_name"],
			limit_page_length=0,
		)
	except Exception:
		# Department enrichment must not make the separation archive unavailable.
		frappe.log_error(
			title="Employee Separation Records Department Lookup Failed",
			message=frappe.get_traceback(),
		)
		return {}

	return {row.name: row.department_name for row in rows if row.get("department_name")}


def _department_display_name(value, department_names=None):
	if not value:
		return ""

	return (department_names or {}).get(value) or _strip_department_company_suffix(value)


def _meta_has_field(meta, fieldname):
	return fieldname in {"name", "docstatus", "modified"} or bool(meta.has_field(fieldname))


def _matches_search(row, needle):
	values = (
		row.employee_code,
		row.employee_name,
		row.department_display,
		row.designation,
	)
	return any(needle in str(value or "").casefold() for value in values)
