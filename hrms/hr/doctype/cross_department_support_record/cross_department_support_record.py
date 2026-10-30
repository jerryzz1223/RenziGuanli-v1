from __future__ import annotations

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate


class CrossDepartmentSupportRecord(Document):
    def validate(self):
        employee = frappe.get_doc("Employee", self.employee)
        employee.check_permission("read")
        self.company = employee.company
        self.employee_name = employee.employee_name
        self.source_reference = (self.source_reference or "").strip()
        if not self.source_reference:
            frappe.throw(_("请填写可追溯的来源单号。"))
        if self.end_date and getdate(self.end_date) < getdate(self.support_date):
            frappe.throw(_("支援结束日期不能早于开始日期。"))
        department_company = frappe.db.get_value("Department", self.support_department, "company")
        if department_company and department_company != self.company:
            frappe.throw(_("支援部门必须属于员工所在公司。"))
