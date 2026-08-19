"""Make the company work number the Employee document name.

Frappe uses ``Employee.name`` in standard Link fields.  Keeping a generated
``HR-EMP-*`` value there leaks an implementation key into every standard HR
form, even when the roster itself displays ``custom_employee_code``.
"""

import frappe
from frappe import _
from frappe.model.rename_doc import rename_doc
from frappe.utils import cstr


def _company_employee_code(employee):
	"""Read the one permitted business identifier, with a one-time legacy fill."""
	code = cstr(employee.custom_employee_code).strip()
	if not code:
		# Existing installations may have populated ERPNext's former field before
		# the company-code policy was introduced.  Read it only during this
		# migration and write the value into the company-owned field.
		code = cstr(employee.get("employee_number")).strip()
	if not code and not employee.name.startswith("HR-EMP-"):
		code = cstr(employee.name).strip()
	return code


def _set_company_employee_code(employee_name, code):
	values = {"custom_employee_code": code}
	if frappe.db.has_column("Employee", "employee_number"):
		values["employee_number"] = code
	frappe.db.set_value("Employee", employee_name, values, update_modified=False)


def execute():
	if not frappe.db.exists("DocType", "Employee"):
		return
	if not frappe.db.has_column("Employee", "custom_employee_code"):
		frappe.throw(_("缺少公司员工号字段，无法迁移员工编号。请先执行站点迁移后重试。"))

	employees = frappe.get_all(
		"Employee",
		fields=["name", "custom_employee_code", "employee_number"],
		order_by="creation asc",
		limit_page_length=0,
	)
	targets = {}
	missing = []
	for employee in employees:
		code = _company_employee_code(employee)
		if not code:
			missing.append(employee.name)
			continue
		if code in targets and targets[code] != employee.name:
			frappe.throw(_("公司员工号 {0} 对应多份员工档案，无法自动迁移。请先合并重复档案。").format(code))
		targets[code] = employee.name

	if missing:
		frappe.throw(
			_("以下员工档案缺少公司员工号，不能继续替换系统编号：{0}").format("、".join(missing[:20]))
		)

	for code, current_name in targets.items():
		if current_name == code:
			_set_company_employee_code(current_name, code)
			continue
		owner = frappe.db.get_value("Employee", code, "name")
		if owner and owner != current_name:
			frappe.throw(_("公司员工号 {0} 已作为其他员工档案编号，无法自动迁移。").format(code))
		_set_company_employee_code(current_name, code)
		rename_doc("Employee", current_name, code, force=True)

	frappe.db.set_single_value("HR Settings", "emp_created_by", "Company Employee Code")
	frappe.clear_cache(doctype="Employee")
