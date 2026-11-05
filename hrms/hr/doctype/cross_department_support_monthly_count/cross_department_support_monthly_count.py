from __future__ import annotations

import frappe
from frappe.model.document import Document

from hrms.api.cross_department_support import validate_monthly_values


class CrossDepartmentSupportMonthlyCount(Document):
    def validate(self):
        self.month, self.support_count = validate_monthly_values(self.month, self.support_count)
        employee = frappe.get_doc("Employee", self.employee)
        employee.check_permission("read")
        self.company = employee.company
        self.employee_name = employee.employee_name
        if not self.is_new():
            previous = self.get_doc_before_save()
            if previous and (previous.employee != self.employee or previous.month != self.month):
                frappe.throw("员工和月份不能修改，请打开对应月份记录。")


def on_doctype_update():
    frappe.db.add_unique("Cross Department Support Monthly Count", ["employee", "month"])
