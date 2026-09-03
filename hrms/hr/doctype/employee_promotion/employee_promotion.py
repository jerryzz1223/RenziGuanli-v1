# Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate

from hrms.hr.utils import update_employee_work_history, validate_active_employee


CONFIRMATION_PASSED = "转正通过"
CONFIRMATION_REJECTED = "转正不通过"
CONFIRMATION_DETAIL_FIELDS = {"custom_is_confirmed", "final_confirmation_date"}


class EmployeePromotion(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		from hrms.hr.doctype.employee_property_history.employee_property_history import (
			EmployeePropertyHistory,
		)

		amended_from: DF.Link | None
		company: DF.Link | None
		current_ctc: DF.Currency
		department: DF.Link | None
		employee: DF.Link
		employee_name: DF.Data | None
		custom_confirmation_interview_date: DF.Date | None
		custom_confirmation_interviewer: DF.Data | None
		custom_confirmation_interview_notes: DF.SmallText | None
		custom_confirmation_result: DF.Literal["转正通过", "转正不通过"] | None
		custom_is_confirmation_interview: DF.Check
		promotion_date: DF.Date
		promotion_details: DF.Table[EmployeePropertyHistory]
		revised_ctc: DF.Currency
		salary_currency: DF.Link | None
	# end: auto-generated types

	def validate(self):
		validate_active_employee(self.employee)
		self.validate_confirmation_interview()

	def is_confirmation_interview(self):
		"""A result or confirmation-field change identifies a probation interview."""
		return bool(self.custom_is_confirmation_interview or self.custom_confirmation_result) or any(
			row.fieldname in CONFIRMATION_DETAIL_FIELDS for row in self.promotion_details
		)

	def validate_confirmation_interview(self):
		if not self.is_confirmation_interview():
			return

		if self.custom_confirmation_result not in {CONFIRMATION_PASSED, CONFIRMATION_REJECTED}:
			frappe.throw(_("请在转正面谈中选择“转正通过”或“转正不通过”"))
		if not self.custom_confirmation_interview_date:
			frappe.throw(_("请填写转正面谈日期"))
		if not self.custom_confirmation_interview_notes:
			frappe.throw(_("请填写转正面谈记录"))

		changed_fields = {row.fieldname for row in self.promotion_details}
		if self.custom_confirmation_result == CONFIRMATION_PASSED:
			missing_fields = CONFIRMATION_DETAIL_FIELDS - changed_fields
			if missing_fields:
				frappe.throw(_("转正通过时必须同步更新员工转正状态和转正日期"))
			details = {row.fieldname: str(row.new or "").strip() for row in self.promotion_details}
			if details.get("custom_is_confirmed") != "是" or not details.get("final_confirmation_date"):
				frappe.throw(_("转正通过时，必须同步填写是否转正和转正日期"))
		elif self.promotion_details:
			frappe.throw(_("转正不通过不会变更员工档案，请移除转正/晋升调整项目"))

	def before_submit(self):
		if getdate(self.promotion_date) > getdate():
			frappe.throw(
				_("Employee Promotion cannot be submitted before Promotion Date"),
				frappe.DocstatusTransitionError,
			)

	def on_submit(self):
		if self.custom_confirmation_result == CONFIRMATION_REJECTED:
			return

		employee = frappe.get_doc("Employee", self.employee)
		employee = update_employee_work_history(employee, self.promotion_details, date=self.promotion_date)
		if employee.meta.has_field("custom_work_nature") and self.custom_confirmation_result == CONFIRMATION_PASSED:
			employee.custom_work_nature = "在职·正式"

		if self.revised_ctc:
			employee.ctc = self.revised_ctc

		employee.save()

	def on_cancel(self):
		if self.custom_confirmation_result == CONFIRMATION_REJECTED:
			return

		employee = frappe.get_doc("Employee", self.employee)
		employee = update_employee_work_history(employee, self.promotion_details, cancel=True)
		if employee.meta.has_field("custom_work_nature") and self.custom_confirmation_result == CONFIRMATION_PASSED:
			employee.custom_work_nature = "在职·试用期"

		if self.revised_ctc:
			employee.ctc = self.current_ctc

		employee.save()
