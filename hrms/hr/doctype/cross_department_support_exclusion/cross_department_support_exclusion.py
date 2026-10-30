import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate


class CrossDepartmentSupportExclusion(Document):
    def validate(self):
        frappe.get_doc("Employee", self.employee).check_permission("read")
        if not self.from_date or not self.to_date or getdate(self.from_date) > getdate(self.to_date):
            frappe.throw(_("请填写有效的排除起止日期，结束日期不能早于开始日期。"))
        self.reason = (self.reason or "").strip()
        if not self.reason:
            frappe.throw(_("请填写排除原因。"))
