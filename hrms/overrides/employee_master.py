# Copyright (c) 2022, Frappe Technologies Pvt. Ltd. and Contributors
# License: GNU General Public License v3. See license.txt

import frappe
from frappe import _
from frappe.utils import add_years, cint, cstr, get_link_to_form, getdate

from erpnext.setup.doctype.employee.employee import Employee


WORK_NATURE_OPTIONS = ("在职·正式", "在职·试用期", "退休返聘", "待离职", "离职")


class EmployeeMaster(Employee):
	def validate(self):
		self._apply_company_employee_code()
		apply_employee_work_nature(self)
		return super().validate()

	def autoname(self):
		# Employee.name is a Frappe link key, but it is also what standard Link
		# controls display.  Use the company's work number as that key so no HR
		# user ever has to identify a person through Frappe's HR-EMP naming series.
		self._apply_company_employee_code()
		self.name = self.custom_employee_code
		self.employee = self.name

	def _apply_company_employee_code(self):
		code = cstr(self.get("custom_employee_code")).strip()
		if not code:
			frappe.throw(_("请填写公司员工号；员工档案不再使用系统自动编号。"))
		if not self.is_new() and self.has_value_changed("custom_employee_code"):
			frappe.throw(_("公司员工号创建后不可直接修改；请由管理员执行员工编号迁移以同步所有关联单据。"))

		# Keep ERPNext's legacy field in sync only for third-party schema
		# compatibility.  It is neither a naming source nor a business lookup key.
		self.custom_employee_code = code
		if self.meta.has_field("employee_number"):
			self.employee_number = code

		existing = frappe.db.get_value("Employee", {"custom_employee_code": code}, "name")
		if existing and existing != self.name:
			frappe.throw(_("公司员工号 {0} 已被员工档案 {1} 使用。").format(code, existing))


def get_employee_work_nature(employee):
	"""Return the one HR-facing work-nature label from standard Employee data."""
	if employee.get("custom_work_nature") in WORK_NATURE_OPTIONS:
		return employee.get("custom_work_nature")
	if employee.get("employment_type") in WORK_NATURE_OPTIONS:
		return employee.get("employment_type")
	if employee.get("status") == "Left":
		return "离职"
	if employee.get("status") == "Inactive":
		return "待离职"
	if employee.get("employment_type") in {"Retainer", "退休返聘", "返聘"}:
		return "退休返聘"
	if employee.get("employment_type") == "Probation" or employee.get("custom_is_confirmed") == "否":
		return "在职·试用期"
	return "在职·正式"


def _find_employment_type(*candidates):
	for candidate in candidates:
		if frappe.db.exists("Employment Type", candidate):
			return candidate
		name = frappe.db.get_value("Employment Type", {"employee_type_name": candidate}, "name")
		if name:
			return name
	frappe.throw(_("未找到工作性质需要的基础资料：{0}。").format(" / ".join(candidates)))


def apply_employee_work_nature(employee):
	"""Apply the original work-nature field to the fields consumed by ERPNext.

	The browser persists `custom_work_nature` as the one five-option HR control.
	Before standard Employee validation it synchronises the stock Employment
	Type/status values expected by attendance, payroll and separation code.
	"""
	if not employee.meta.has_field("employment_type"):
		return

	selected = cstr(employee.get("custom_work_nature")).strip()
	selected_changed = employee.is_new() or employee.has_value_changed("custom_work_nature")
	if selected and selected not in WORK_NATURE_OPTIONS:
		frappe.throw(_("工作性质只能选择：{0}").format("、".join(WORK_NATURE_OPTIONS)))
	if not selected:
		# Compatibility for an old form submission that still posted the public
		# label through the standard Link field.
		selected = cstr(employee.get("employment_type")).strip()
		selected_changed = employee.is_new() or employee.has_value_changed("employment_type")
	if selected not in WORK_NATURE_OPTIONS:
		return
	if employee.meta.has_field("custom_work_nature"):
		employee.custom_work_nature = selected

	# A submitted confirmation or separation can update an implementation field
	# outside the form. Keep the public source in sync, never make roster reads
	# infer it again.
	if not selected_changed:
		if employee.has_value_changed("status"):
			if employee.status == "Left":
				selected = "离职"
			elif employee.status == "Inactive":
				selected = "待离职"
		elif employee.has_value_changed("custom_is_confirmed") and selected in {"在职·正式", "在职·试用期"}:
			selected = "在职·正式" if employee.custom_is_confirmed == "是" else "在职·试用期"
		if employee.meta.has_field("custom_work_nature"):
			employee.custom_work_nature = selected

	if selected == "在职·正式":
		employee.employment_type = _find_employment_type("Full-time", "全职")
		employee.custom_is_confirmed = "是"
		employee.relieving_date = None
		employee.status = "Active"
	elif selected == "在职·试用期":
		employee.employment_type = _find_employment_type("Full-time", "全职", "Probation", "试用")
		employee.custom_is_confirmed = "否"
		employee.relieving_date = None
		employee.status = "Active"
	elif selected == "退休返聘":
		employee.employment_type = _find_employment_type("Retainer", "退休返聘", "返聘")
		employee.relieving_date = None
		employee.status = "Active"
	elif selected == "待离职":
		employee.employment_type = _find_employment_type("Full-time", "全职")
		employee.status = "Inactive"
	elif selected == "离职":
		employee.employment_type = _find_employment_type("Full-time", "全职")
		employee.status = "Left"


def validate_onboarding_process(doc, method=None):
	"""Validates Employee Creation for linked Employee Onboarding"""
	if not doc.job_applicant:
		return

	employee_onboarding = frappe.get_all(
		"Employee Onboarding",
		filters={
			"job_applicant": doc.job_applicant,
			"docstatus": 1,
			"boarding_status": ("!=", "Completed"),
		},
	)
	if employee_onboarding:
		onboarding = frappe.get_doc("Employee Onboarding", employee_onboarding[0].name)
		onboarding.validate_employee_creation()
		onboarding.db_set("employee", doc.name)


def publish_update(doc, method=None):
	import hrms

	hrms.refetch_resource("hrms:employee", doc.user_id)


def update_job_applicant_and_offer(doc, method=None):
	"""Updates Job Applicant and Job Offer status as 'Accepted' and submits them"""
	if not doc.job_applicant:
		return

	applicant_status_before_change = frappe.db.get_value("Job Applicant", doc.job_applicant, "status")
	if applicant_status_before_change != "Accepted":
		frappe.db.set_value("Job Applicant", doc.job_applicant, "status", "Accepted")
		frappe.msgprint(
			_("Updated the status of linked Job Applicant {0} to {1}").format(
				get_link_to_form("Job Applicant", doc.job_applicant), frappe.bold(_("Accepted"))
			)
		)
	offer_status_before_change = frappe.db.get_value(
		"Job Offer", {"job_applicant": doc.job_applicant, "docstatus": ["!=", 2]}, "status"
	)
	if offer_status_before_change and offer_status_before_change != "Accepted":
		job_offer = frappe.get_last_doc("Job Offer", filters={"job_applicant": doc.job_applicant})
		job_offer.status = "Accepted"
		job_offer.flags.ignore_mandatory = True
		job_offer.flags.ignore_permissions = True
		job_offer.save()

		msg = _("Updated the status of Job Offer {0} for the linked Job Applicant {1} to {2}").format(
			get_link_to_form("Job Offer", job_offer.name),
			frappe.bold(doc.job_applicant),
			frappe.bold(_("Accepted")),
		)
		if job_offer.docstatus == 0:
			msg += "<br>" + _("You may add additional details, if any, and submit the offer.")

		frappe.msgprint(msg)


def update_approver_role(doc, method=None):
	"""Adds relevant approver role for the user linked to Employee"""
	if doc.leave_approver:
		user = frappe.get_doc("User", doc.leave_approver)
		user.flags.ignore_permissions = True
		user.add_roles("Leave Approver")

	if doc.expense_approver:
		user = frappe.get_doc("User", doc.expense_approver)
		user.flags.ignore_permissions = True
		user.add_roles("Expense Approver")


def update_approver_user_roles(doc, method=None):
	approver_roles = set()
	if frappe.db.exists("Employee", {"leave_approver": doc.name}):
		approver_roles.add("Leave Approver")

	if frappe.db.exists("Employee", {"expense_approver": doc.name}):
		approver_roles.add("Expense Approver")

	if approver_roles:
		doc.append_roles(*approver_roles)


def update_employee_transfer(doc, method=None):
	"""Unsets Employee ID in Employee Transfer if doc is deleted"""
	if frappe.db.exists("Employee Transfer", {"new_employee_id": doc.name, "docstatus": 1}):
		emp_transfer = frappe.get_doc("Employee Transfer", {"new_employee_id": doc.name, "docstatus": 1})
		emp_transfer.db_set("new_employee_id", "")


@frappe.whitelist()
def get_timeline_data(doctype: str, name: str) -> dict:
	"""Return timeline for attendance"""
	from frappe.desk.notifications import get_open_count

	out = {}

	frappe.has_permission(doctype, "read", name, throw=True)
	frappe.has_permission("Attendance", "read", throw=True)

	open_count = get_open_count(doctype, name)
	out["count"] = open_count["count"]

	timeline_data = dict(
		frappe.db.sql(
			"""
			select unix_timestamp(attendance_date), count(*)
			from `tabAttendance` where employee=%s
			and attendance_date > date_sub(curdate(), interval 1 year)
			and status in ('Present', 'Half Day')
			group by attendance_date""",
			name,
		)
	)

	out["timeline_data"] = timeline_data
	return out


@frappe.whitelist()
def get_retirement_date(date_of_birth: str | None = None):
	if date_of_birth:
		try:
			retirement_age = cint(frappe.db.get_single_value("HR Settings", "retirement_age") or 60)
			dt = add_years(getdate(date_of_birth), retirement_age)
			return dt.strftime("%Y-%m-%d")
		except ValueError:
			# invalid date
			return
