"""Permission-aware candidates and draft creation for probation confirmation."""

import frappe
from frappe import _
from frappe.utils import cint, getdate, nowdate


def is_pending_confirmation(employee):
	if employee.get("status") != "Active":
		return False
	if employee.get("custom_work_nature"):
		return employee.get("custom_work_nature") == "在职·试用期"
	if employee.get("employment_type") == "Probation" or employee.get("custom_is_confirmed") == "否":
		return True
	if employee.get("custom_is_confirmed") == "是":
		return False
	date = employee.get("final_confirmation_date")
	return bool(date and getdate(date) > getdate(nowdate()))


@frappe.whitelist()
def get_candidates(company: str | None = None, search: str | None = None, start: int = 0):
	frappe.has_permission("Employee", "read", throw=True)
	meta = frappe.get_meta("Employee")
	fields = ["name", "employee_name", "department", "designation", "date_of_joining", "status", "employment_type"]
	fields += [field for field in ("custom_employee_code", "custom_work_nature", "custom_is_confirmed", "final_confirmation_date") if meta.has_field(field)]
	filters = {"status": "Active"}
	if company:
		filters["company"] = company
	# get_list deliberately retains Employee user permissions and query conditions.
	employees = frappe.get_list("Employee", filters=filters, fields=fields, order_by="date_of_joining asc, name asc", limit_page_length=0)
	query = str(search or "").strip().casefold()
	candidates = [row for row in employees if is_pending_confirmation(row) and (not query or any(query in str(row.get(field) or "").casefold() for field in ("name", "custom_employee_code", "employee_name", "department", "designation")))]
	start = max(0, cint(start))
	return {"total": len(candidates), "rows": candidates[start:start + 20]}


@frappe.whitelist()
def create_draft(employee: str, confirmation_date: str, interview_date: str, notes: str, result: str, interviewer: str | None = None):
	frappe.has_permission("Employee Promotion", "create", throw=True)
	employee = frappe.get_doc("Employee", employee)
	employee.check_permission("read")
	if not is_pending_confirmation(employee):
		frappe.throw(_("请选择在职且未转正的员工"))
	if not confirmation_date or not interview_date or not str(notes or "").strip():
		frappe.throw(_("请填写转正日期、面谈日期和面谈记录"))
	if result not in ("转正通过", "转正不通过"):
		frappe.throw(_("请选择转正结果"))
	details = []
	if result == "转正通过":
		details = [
			{"property": "是否转正", "fieldname": "custom_is_confirmed", "current": employee.get("custom_is_confirmed") or "", "new": "是"},
			{"property": "转正日期", "fieldname": "final_confirmation_date", "current": employee.get("final_confirmation_date") or "", "new": confirmation_date},
		]
	doc = frappe.get_doc({
		"doctype": "Employee Promotion", "employee": employee.name,
		"company": employee.company, "department": employee.department,
		"promotion_date": confirmation_date, "custom_is_confirmation_interview": 1,
		"custom_confirmation_interview_date": interview_date,
		"custom_confirmation_interviewer": interviewer,
		"custom_confirmation_interview_notes": notes,
		"custom_confirmation_result": result, "promotion_details": details,
	})
	doc.insert()
	return doc.name
