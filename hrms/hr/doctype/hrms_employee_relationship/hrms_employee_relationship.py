import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime

from hrms.hr.employee_relationship_importer import RELATIONSHIP_CATEGORIES


class HRMSEmployeeRelationship(Document):
	"""A business relationship shared by two employee profiles."""

	def validate(self):
		if not self.employee_a or not self.employee_b:
			frappe.throw(_("请选择两名员工。"))
		if self.employee_a == self.employee_b:
			frappe.throw(_("员工关系不能选择同一名员工。"))
		self.relationship = str(self.relationship or "").strip()
		if self.relationship not in RELATIONSHIP_CATEGORIES:
			frappe.throw(_("请选择有效的员工关系大类：{0}").format("、".join(RELATIONSHIP_CATEGORIES)))

		first = _employee_snapshot(self.employee_a)
		second = _employee_snapshot(self.employee_b)
		if not first or not second:
			frappe.throw(_("所选员工不存在或已被删除。"))
		if _employee_sort_key(first) > _employee_sort_key(second):
			first, second = second, first
		self.employee_a = first.name
		self.employee_b = second.name
		self.employee_a_name = first.employee_name
		self.employee_a_code = first.custom_employee_code or ""
		self.employee_b_name = second.employee_name
		self.employee_b_code = second.custom_employee_code or ""
		self.company = first.company or second.company
		if self.is_new() or not self.submitted_by:
			self.submitted_by = frappe.session.user
		if self.is_new() or not self.submitted_on:
			self.submitted_on = now_datetime()
		self.status = "已提交"
		if _relationship_exists(first.name, second.name, self.name if not self.is_new() else ""):
			frappe.throw(_("这两名员工已经建立关系。"))


def _employee_snapshot(employee):
	return frappe.db.get_value(
		"Employee",
		employee,
		["name", "employee_name", "custom_employee_code", "company"],
		as_dict=True,
	)


def _employee_sort_key(employee):
	return (
		str(employee.get("custom_employee_code") or "").casefold(),
		str(employee.get("employee_name") or "").casefold(),
		str(employee.name),
	)


def _relationship_exists(first, second, exclude_name=""):
	for employee_a, employee_b in ((first, second), (second, first)):
		filters = {"employee_a": employee_a, "employee_b": employee_b}
		if exclude_name:
			filters["name"] = ["!=", exclude_name]
		if frappe.get_all("HRMS Employee Relationship", filters=filters, pluck="name", limit_page_length=1):
			return True
	return False
