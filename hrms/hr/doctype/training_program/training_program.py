# Copyright (c) 2017, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


import frappe
from frappe.model.document import Document
from frappe.utils import add_days, nowdate


class TrainingProgram(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		amended_from: DF.Link | None
		company: DF.Link
		contact_number: DF.Data | None
		description: DF.TextEditor
		status: DF.Literal["Scheduled", "Completed", "Cancelled"]
		supplier: DF.Link | None
		trainer_email: DF.Data | None
		trainer_name: DF.Data | None
		training_program: DF.Data
	# end: auto-generated types

	pass


def _dashboard_company(company=None):
	"""Return a company that the current user may use for training summaries."""
	company = company or frappe.defaults.get_user_default("Company")
	if not company:
		return None
	if not frappe.has_permission("Company", "read", company):
		frappe.throw("无权查看该公司的培训数据", frappe.PermissionError)
	return company


def _attendance_summary(company):
	"""Aggregate attendee outcomes from submitted training results only."""
	return frappe.db.sql(
		"""
			select
				coalesce(sum(case when employee.needs_retraining = 1 then 1 else 0 end), 0) as retraining_count,
				coalesce(sum(case when employee.assessment_result in ('Fail', 'Absent') then 1 else 0 end), 0) as exception_count
			from `tabTraining Result Employee` employee
			inner join `tabTraining Result` result on result.name = employee.parent
			inner join `tabTraining Event` event on event.name = result.training_event
			where result.docstatus = 1 and event.company = %(company)s
		""",
		{"company": company},
		as_dict=True,
	)[0]


@frappe.whitelist()
def get_training_learning_dashboard(company=None):
	"""Read-only operational summary for the existing Training Program list."""
	if not frappe.has_permission("Training Program", "read"):
		frappe.throw("无权查看培训学习数据", frappe.PermissionError)
	company = _dashboard_company(company)
	if not company:
		return {"metrics": {}, "upcoming_events": [], "risks": []}

	today = nowdate()
	soon = add_days(today, 30)
	metrics = {
		"total_programs": frappe.db.count("Training Program", {"company": company}),
		"active_programs": frappe.db.count("Training Program", {"company": company, "status": "Scheduled"}),
		"scheduled_events": frappe.db.count("Training Event", {"company": company, "event_status": "Scheduled"}),
		"completed_events": frappe.db.count("Training Event", {"company": company, "event_status": "Completed"}),
		"feedback_count": frappe.db.sql(
			"""
				select count(feedback.name)
				from `tabTraining Feedback` feedback
				inner join `tabTraining Event` event on event.name = feedback.training_event
				where feedback.docstatus < 2 and event.company = %(company)s
			""",
			{"company": company},
		)[0][0],
		"retraining_due": frappe.db.count(
			"Training Event",
			{"company": company, "retraining_due_on": ["between", [today, soon]]},
		),
	}
	attendance = _attendance_summary(company)
	metrics["retraining_count"] = int(attendance.retraining_count or 0)
	metrics["exception_count"] = int(attendance.exception_count or 0)

	upcoming_events = frappe.get_all(
		"Training Event",
		filters={"company": company, "event_status": "Scheduled", "start_time": [">=", today]},
		fields=["name", "event_name", "training_program", "start_time", "location", "training_category", "qualification_gate"],
		order_by="start_time asc",
		limit_page_length=5,
	)

	risks = []
	if metrics["retraining_due"]:
		risks.append({"tone": "warning", "title": "复训临期", "value": metrics["retraining_due"], "detail": "未来 30 天内有培训需要安排复训"})
	if metrics["retraining_count"]:
		risks.append({"tone": "danger", "title": "补训待处理", "value": metrics["retraining_count"], "detail": "已提交结果中标记为需要补训的员工"})
	if metrics["exception_count"]:
		risks.append({"tone": "danger", "title": "考核异常", "value": metrics["exception_count"], "detail": "已提交结果中不合格或缺考的员工"})
	if not risks:
		risks.append({"tone": "success", "title": "当前无高风险待办", "value": 0, "detail": "可从培训计划开始安排下一轮培训"})

	return {"metrics": metrics, "upcoming_events": upcoming_events, "risks": risks}
