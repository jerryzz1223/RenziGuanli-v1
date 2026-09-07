"""Read-only organizational base and chart candidates from the employee roster."""
import frappe
from frappe import _


def _get_employee_rows(filters):
	"""Return every permission-visible active roster row for one exact scope."""
	employees = []
	while True:
		page = frappe.get_list(
			"Employee",
			filters=filters,
			fields=["name", "employee_name", "custom_employee_code", "department", "designation", "grade"],
			order_by="name asc",
			limit_start=len(employees),
			limit_page_length=500,
		)
		employees.extend(page)
		if len(page) < 500:
			return employees


def resolve_roster_department(company: str, department: str, inherit_parent: bool = False):
	"""Find the roster-owning department for a display-only organization unit.

	A folder such as ``QE组`` can sit under ``总办室`` to express the chart
	hierarchy while employees continue to belong to 总办室 in their roster.
	Only callers that explicitly opt in may walk this Department parent chain;
	ordinary Department forms still report their own direct roster rows.
	"""
	requested_department = department
	seen = set()
	while department:
		if department in seen:
			frappe.throw(_("部门上下级关系存在循环，无法确定花名册人员来源。"))
		seen.add(department)
		doc = frappe.get_doc("Department", department)
		doc.check_permission("read")
		if doc.company != company or doc.disabled:
			frappe.throw(_("请选择当前公司已启用的部门。"))
		if not inherit_parent:
			return requested_department
		# Resolve the source by department membership only. Position/grade filtering
		# must happen afterwards; otherwise a vacant role would incorrectly climb
		# past its owning department.
		if _get_employee_rows({"company": company, "status": "Active", "department": department}):
			return department
		department = getattr(doc, "parent_department", "") or ""
	return requested_department


@frappe.whitelist()
def get_candidates(
	company: str,
	department: str = "",
	designation: str = "",
	grade: str = "",
	allow_company: bool = False,
	inherit_parent: bool = False,
):
	if not company or (not department and not allow_company):
		return {"rows": [], "employees": []}
	filters = {"company": company, "status": "Active"}
	roster_department = ""
	if department:
		roster_department = resolve_roster_department(company, department, inherit_parent=inherit_parent)
		filters["department"] = roster_department
	if designation:
		filters["designation"] = designation
	if grade:
		filters["grade"] = grade
	employees = _get_employee_rows(filters)
	return {
		"requested_department": department,
		"roster_department": roster_department or department,
		"employees": employees,
		"rows": [{"employee": row.name, "designation": row.designation or "", "grade": row.grade or "", "base_department": row.department or ""} for row in employees],
	}


@frappe.whitelist()
def get_base(department: str):
	doc = frappe.get_doc("Department", department)
	doc.check_permission("read")
	data = get_candidates(doc.company, department)
	return {"department": doc.name, "company": doc.company, "rows": [{**row, "employee": row.name} for row in data["employees"]], "employee_count": len(data["employees"])}


def validate_chart_selection(company, department, selected, kind, designation=None, grade=None, inherit_parent=False):
	if kind != "分管" and not department:
		if not any(selected):
			return {"rows": [], "employees": [], "roster_department": ""}
		frappe.throw(_("请先关联花名册对应的部门。"))
	result = get_candidates(
		company,
		department or "",
		designation or "",
		grade or "",
		kind == "分管",
		inherit_parent=inherit_parent,
	)
	allowed = {row.name for row in result["employees"]}
	if any(employee and employee not in allowed for employee in selected):
		frappe.throw(_("所选员工与花名册中的公司、部门、职位、职级或在职状态不一致，请按花名册重新选择。"))
	return result
