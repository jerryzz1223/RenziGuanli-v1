"""Interview register, independent of scheduling and offer approval documents."""
import frappe
from frappe.model.document import Document
from frappe.utils import getdate


class InterviewRegistration(Document):
    def validate(self):
        self.candidate_name = (self.candidate_name or "").strip()
        if not self.candidate_name:
            frappe.throw("请填写姓名。")
        self.registration_month = getdate(self.interview_date).strftime("%Y-%m")
        if self.age is not None and (int(self.age) != float(self.age) or not 0 <= int(self.age) <= 120):
            frappe.throw("年龄应为 0 至 120 的整数。")
