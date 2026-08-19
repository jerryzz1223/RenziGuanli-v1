# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cstr, getdate, nowdate

from hrms.hr.utils import update_employee_work_history, validate_active_employee


# The first rollout only permits changes that belong to an employee's current role.
TRANSFER_PROPERTY_FIELDS = {
	"department": "部门",
	"designation": "岗位",
	"grade": "职级",
	"reports_to": "直属上级",
	"employment_type": "工作性质",
	"custom_direct_indirect": "直间接",
	"custom_is_confirmed": "是否转正",
}

# Frappe Link fields store the document name, while the HR UI deliberately
# shows the business-facing name. Departments created by the legacy data, for
# example, may be stored as "行政课 - 1D" but shown as "行政课".
TRANSFER_LINK_LABEL_FIELDS = {
	"Department": "department_name",
	"Designation": "designation_name",
}


def _resolve_transfer_link_value(doctype: str, value: str, company: str | None = None) -> str:
	"""Resolve a business label to the internal value required by a Link field."""
	value = cstr(value).strip()
	if not value or frappe.db.exists(doctype, value):
		return value

	label_field = TRANSFER_LINK_LABEL_FIELDS.get(doctype)
	if not label_field:
		return value

	filters = {label_field: value}
	if doctype == "Department" and company:
		filters["company"] = company

	matches = frappe.get_all(doctype, filters=filters, pluck="name", limit_page_length=2)
	if len(matches) == 1:
		return matches[0]

	if len(matches) > 1:
		label = _("部门") if doctype == "Department" else _("岗位")
		scope = _("公司 {0} 下").format(company) if company else ""
		frappe.throw(
			_("{0}存在多个业务名称为“{1}”的{2}，请先在组织架构中保持业务名称唯一。").format(
				scope, value, label
			)
		)

	return value


class EmployeeTransfer(Document):
	def validate(self):
		self.sync_employee_identity()
		validate_active_employee(self.employee)
		self.derive_transfer_type()
		self.validate_transfer_details()

	def sync_employee_identity(self):
		"""Keep the system link internal and expose the company employee code in the UI."""
		if not self.employee:
			frappe.throw(_("请先通过员工工号选择员工。"))

		employee = frappe.get_doc("Employee", self.employee)
		employee_code = cstr(employee.get("custom_employee_code")).strip()
		if not employee_code:
			frappe.throw(_("员工 {0} 未维护工号，不能办理人事异动。").format(employee.employee_name))

		self.employee_code_display = employee_code
		self.employee_name = employee.employee_name
		self.company = employee.company
		self.department = employee.department
		return employee

	def derive_transfer_type(self):
		"""Use a stable, human-readable type derived from the actual changes."""
		changed_fields = {cstr(row.fieldname).strip() for row in self.transfer_details}
		if "custom_is_confirmed" in changed_fields:
			self.transfer_type = "转全职"
		elif "grade" in changed_fields:
			self.transfer_type = "晋升"
		else:
			self.transfer_type = "调岗"

	def validate_transfer_details(self):
		if not self.transfer_details:
			frappe.throw(_("请至少添加一项实际发生变化的异动明细"))

		employee = frappe.get_doc("Employee", self.employee)
		employee_meta = frappe.get_meta("Employee")
		details = {}

		for row in self.transfer_details:
			fieldname = cstr(row.fieldname).strip()
			if fieldname not in TRANSFER_PROPERTY_FIELDS:
				frappe.throw(_("不支持通过人事异动修改字段：{0}").format(row.property or fieldname))
			if fieldname in details:
				frappe.throw(_("变更项目不能重复：{0}").format(TRANSFER_PROPERTY_FIELDS[fieldname]))

			field = employee_meta.get_field(fieldname)
			if not field:
				frappe.throw(_("员工档案中不存在字段：{0}").format(TRANSFER_PROPERTY_FIELDS[fieldname]))
			if row.new is None or not cstr(row.new).strip():
				frappe.throw(_("请填写{0}的变更后内容。").format(TRANSFER_PROPERTY_FIELDS[fieldname]))

			new_value = cstr(row.new).strip()
			if field.fieldtype == "Link" and field.options:
				row.new = _resolve_transfer_link_value(field.options, new_value, employee.company)
			else:
				row.new = new_value

			current_value = employee.get(fieldname)
			row.current = cstr(current_value)
			row.property = TRANSFER_PROPERTY_FIELDS[fieldname]
			if cstr(current_value).strip() == cstr(row.new).strip():
				frappe.throw(_("{0}的变更前后不能相同。").format(row.property))
			if fieldname == "reports_to" and row.new == employee.name:
				frappe.throw(_("直属上级不能选择员工本人。"))
			if field.fieldtype == "Link" and field.options and not frappe.db.exists(field.options, row.new):
				frappe.throw(_("{0}不存在：{1}").format(row.property, row.new))
			details[fieldname] = row

		if "department" in details and "designation" not in details:
			frappe.throw(_("调整部门时必须同时选择新岗位"))

		if "department" in details:
			department_company = frappe.db.get_value("Department", details["department"].new, "company")
			if self.company and department_company != self.company:
				frappe.throw(_("目标部门 {0} 不属于公司 {1}。").format(details["department"].new, self.company))

	def before_submit(self):
		if not self.transfer_date:
			frappe.throw(_("请填写生效日期。"))
		if getdate(self.transfer_date) > getdate(nowdate()):
			frappe.throw(_("生效日期未到，不能提交人事异动"), frappe.DocstatusTransitionError)

	def on_submit(self):
		employee = frappe.get_doc("Employee", self.employee)
		update_employee_work_history(employee, self.transfer_details, date=self.transfer_date)
		employee.save()

	def on_cancel(self):
		employee = frappe.get_doc("Employee", self.employee)
		update_employee_work_history(employee, self.transfer_details, date=self.transfer_date, cancel=True)
		employee.save()


@frappe.whitelist()
def get_employee_business_options(company: str | None = None) -> list[dict]:
	"""Return employee choices as employee code plus name, never internal document IDs."""
	filters = {"status": "Active"}
	if company:
		filters["company"] = company

	fields = ["name", "employee_name", "company", "department"]
	employee_meta = frappe.get_meta("Employee")
	if employee_meta.has_field("custom_employee_code"):
		fields.append("custom_employee_code")

	employees = frappe.get_all("Employee", filters=filters, fields=fields, order_by="employee_name asc")
	return [
		{
			"name": employee.name,
			"employee_name": employee.employee_name,
			"employee_code": employee.get("custom_employee_code"),
			"company": employee.company,
			"department": employee.department,
		}
		for employee in employees
		if employee.get("custom_employee_code")
	]


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_designations_for_department(
	doctype: str, txt: str, searchfield: str, start: int, page_len: int, filters: dict
) -> list[list[str]]:
	"""Return positions already used or explicitly mapped in the target department."""
	filters = frappe._dict(filters or {})
	department = filters.get("department")
	company = filters.get("company")
	if department:
		department = _resolve_transfer_link_value("Department", department, company)
	designation_meta = frappe.get_meta("Designation")

	conditions = ["d.name like %(txt)s"]
	params = {"txt": f"%{txt}%", "start": start, "page_len": page_len}
	department_conditions = []
	if department:
		params["department"] = department
		department_conditions.append(
			"d.name in (select distinct e.designation from `tabEmployee` e "
			"where e.department = %(department)s and ifnull(e.designation, '') != '')"
		)
		if designation_meta.has_field("hrms_source_department"):
			department_conditions.append("d.hrms_source_department = %(department)s")
	if company and not department:
		params["company"] = company
		department_conditions.append(
			"d.name in (select distinct e.designation from `tabEmployee` e "
			"where e.company = %(company)s and ifnull(e.designation, '') != '')"
		)
	if department_conditions:
		conditions.append(f"({' or '.join(department_conditions)})")

	# nosemgrep: frappe-semgrep-rules.rules.frappe-using-db-sql
	return frappe.db.sql(
		f"""
			select d.name, ifnull(d.designation_name, d.name)
			from `tabDesignation` d
			where {' and '.join(conditions)}
			order by d.designation_name asc
			limit %(start)s, %(page_len)s
		""",
		params,
		as_list=True,
	)
