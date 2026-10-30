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
        if self.expected_start_date and getdate(self.expected_start_date) < getdate(self.interview_date):
            frappe.throw("预计人员上班时间不能早于面试时间。")
        if self.arrival_status in ("已报到", "未报到") and self.hired != "是":
            frappe.throw("请先将录用与否设为“是”，再登记报到情况。")
        if self.arrival_status == "未报到" and not (self.no_show_reason or "").strip():
            frappe.throw("请填写未报到原因。")
        if self.arrival_status != "未报到":
            self.no_show_reason = ""
