# Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

from erpnext.setup.doctype.employee.employee import get_employee_emails


class TrainingResult(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		from hrms.hr.doctype.training_result_employee.training_result_employee import TrainingResultEmployee

		amended_from: DF.Link | None
		employee_emails: DF.SmallText | None
		employees: DF.Table[TrainingResultEmployee]
		training_event: DF.Link
	# end: auto-generated types

	def validate(self):
		training_event = frappe.get_doc("Training Event", self.training_event)
		if training_event.docstatus != 1:
			frappe.throw(_("{0} must be submitted").format(_("Training Event")))

		self.set_assessment_outcomes(training_event)
		self.employee_emails = ", ".join(get_employee_emails([d.employee for d in self.employees]))

	def set_assessment_outcomes(self, training_event):
		passing_score = flt(training_event.passing_score)
		for row in self.employees:
			if row.assessment_result == "Absent":
				row.needs_retraining = 1
				continue
			if training_event.assessment_required and row.score is not None and passing_score:
				row.assessment_result = "Pass" if flt(row.score) >= passing_score else "Fail"
			if not training_event.assessment_required and row.assessment_result == "Pending":
				row.assessment_result = "Pass"
			if row.assessment_result == "Fail":
				row.needs_retraining = 1

	def on_submit(self):
		training_event = frappe.get_doc("Training Event", self.training_event)
		training_event.event_status = "Completed"
		for e in self.employees:
			for e1 in training_event.employees:
				if e1.employee == e.employee:
					e1.status = "Completed" if e.assessment_result == "Pass" else "Open"
					break

		training_event.save()
		self.sync_passed_training_to_skill_map()

	def sync_passed_training_to_skill_map(self):
		"""Keep the existing employee skill map as the employee training history."""
		for row in self.employees:
			if row.assessment_result != "Pass" or not row.employee:
				continue
			skill_map_name = frappe.db.exists("Employee Skill Map", {"employee": row.employee})
			if skill_map_name:
				skill_map = frappe.get_doc("Employee Skill Map", skill_map_name)
			else:
				skill_map = frappe.get_doc({"doctype": "Employee Skill Map", "employee": row.employee})
				skill_map.insert(ignore_permissions=True)
			if any(item.training == self.training_event for item in skill_map.trainings):
				continue
			skill_map.append("trainings", {"training": self.training_event})
			skill_map.save(ignore_permissions=True)


@frappe.whitelist()
def get_employees(training_event: str):
	return frappe.get_doc("Training Event", training_event).employees
