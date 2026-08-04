import frappe
from frappe import _
from frappe.model.document import Document


class HRMSPayrollRule(Document):
	def validate(self):
		if not self.company or not self.rule_code:
			return
		duplicate = frappe.db.get_value(
			"HRMS Payroll Rule",
			{"company": self.company, "rule_code": self.rule_code, "name": ["!=", self.name or ""]},
			"name",
		)
		if duplicate:
			frappe.throw(_("公司 {0} 已存在规则 {1}").format(self.company, self.rule_code))
