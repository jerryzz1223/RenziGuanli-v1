import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate, now_datetime

def _employee_full_salary(employee, company, occurred_on=None):
	filters = {"employee": employee, "company": company, "status": "已批准"}
	if occurred_on:
		filters["effective_date"] = ["<=", getdate(occurred_on)]
	return flt(
		frappe.db.get_value(
			"HRMS Employee Salary Change",
			filters,
			"full_salary",
			order_by="effective_date desc, modified desc",
		)
	)


def _conversion_note(rule, effective_count=0):
	calculation = _("{0}×{1:g}%={2:.2f}元")
	if not rule.conversion_count:
		return calculation
	progress = effective_count % int(rule.conversion_count)
	return _("{0}；已生效同类记录 {1} 次，{2}/{3} 次可折算为1次{4}。").format(
		calculation,
		effective_count,
		progress,
		rule.conversion_count,
		rule.converts_to,
	)


@frappe.whitelist()
def get_reward_punishment_context(employee: str, rule: str = "", occurred_on: str = "", record_name: str = ""):
	frappe.has_permission("HRMS Employee Reward Punishment", "read", throw=True)
	employee_fields = ["employee_name", "company", "department", "designation"]
	employee_meta = frappe.get_meta("Employee")
	for fieldname in ("custom_employee_code", "employee_number"):
		if employee_meta.has_field(fieldname):
			employee_fields.append(fieldname)
	context = frappe.db.get_value("Employee", employee, employee_fields, as_dict=True)
	if not context:
		frappe.throw(_("员工 {0} 不存在。").format(employee))
	context.employee_code = context.get("custom_employee_code") or context.get("employee_number") or employee
	rule_doc = frappe.get_doc("HRMS Reward Punishment Rule", rule) if rule else None
	if rule_doc and (rule_doc.company != context.company or not rule_doc.enabled):
		frappe.throw(_("所选奖惩条例不属于该员工公司或已停用。"))
	full_salary = _employee_full_salary(employee, context.company, occurred_on)
	effective_count = 0
	if rule_doc:
		filters = {"employee": employee, "category": rule_doc.category, "status": "已生效"}
		if record_name:
			filters["name"] = ["!=", record_name]
		effective_count = frappe.db.count("HRMS Employee Reward Punishment", filters)
	return {
		"employee": employee,
		"employee_code": context.employee_code,
		"employee_name": context.employee_name,
		"company": context.company,
		"department": context.department,
		"designation": context.designation,
		"full_salary": full_salary,
		"effective_count": effective_count,
		"rule": rule_doc.as_dict() if rule_doc else None,
	}


@frappe.whitelist()
def get_reward_punishment_rule_options(company: str):
	"""Return business-facing rule choices without exposing internal rule IDs in the form."""
	frappe.has_permission("HRMS Employee Reward Punishment", "read", throw=True)
	if not company:
		return []
	return frappe.get_all(
		"HRMS Reward Punishment Rule",
		filters={"company": company, "enabled": 1},
		fields=[
			"name",
			"reward_punishment_type",
			"category",
			"rate_percent",
			"standard_text",
			"conversion_count",
			"converts_to",
			"termination_action",
		],
		order_by="display_order asc, category asc",
	)


class HRMSEmployeeRewardPunishment(Document):
	"""Editable HR record for formal rewards and disciplinary actions."""

	def before_validate(self):
		self._set_employee_snapshot()
		self._apply_rule_and_calculation()
		self._validate_amount()

	def validate(self):
		if not self.employee:
			frappe.throw(_("请输入有效的公司员工号。"))
		if not self.rule:
			frappe.throw(_("请选择奖惩类别。"))
		self._validate_status_transition()
		self._set_approval_audit()

	def _set_employee_snapshot(self):
		if not self.employee:
			return
		previous = None if self.is_new() else self.get_doc_before_save()
		if previous and previous.employee == self.employee and previous.status in ("已生效", "已撤销"):
			return
		employee_fields = ["employee_name", "company", "department", "designation"]
		employee_meta = frappe.get_meta("Employee")
		for fieldname in ("custom_employee_code", "employee_number"):
			if employee_meta.has_field(fieldname):
				employee_fields.append(fieldname)
		employee = frappe.db.get_value("Employee", self.employee, employee_fields, as_dict=True)
		if not employee:
			frappe.throw(_("员工 {0} 不存在。").format(self.employee))
		self.employee_code = (
			employee.get("custom_employee_code") or employee.get("employee_number") or self.employee
		)
		self.employee_code_display = self.employee_code
		self.employee_name = employee.employee_name
		self.company = employee.company
		self.department = employee.department
		self.designation = employee.designation

	def _apply_rule_and_calculation(self):
		if not self.company or not self.rule:
			return
		rule = frappe.get_doc("HRMS Reward Punishment Rule", self.rule)
		if rule.company != self.company or not rule.enabled:
			frappe.throw(_("奖惩条例必须属于员工当前公司且处于启用状态。"))
		self.reward_punishment_type = rule.reward_punishment_type
		self.category = rule.category
		self.category_selector = rule.category
		self.rate_percent = flt(rule.rate_percent)
		self.standard = rule.standard_text
		self.conversion_count = rule.conversion_count
		self.converts_to = rule.converts_to
		if self.occurred_on:
			self.payroll_month = getdate(self.occurred_on).strftime("%Y-%m")
		if not flt(self.full_salary) and self.employee:
			self.full_salary = _employee_full_salary(self.employee, self.company, self.occurred_on)
		if flt(self.full_salary) <= 0:
			frappe.throw(_("请填写全薪，或先在薪资主数据中维护该员工已批准的全薪。"))
		calculated_amount = round(flt(self.full_salary) * flt(self.rate_percent) / 100, 2)
		if not self.manual_amount_override:
			self.amount = calculated_amount
		effective_count = frappe.db.count(
			self.doctype,
			{"employee": self.employee, "category": self.category, "status": "已生效", "name": ["!=", self.name]},
		)
		calculation = _("{0}×{1:g}%={2:.2f}元").format(
			flt(self.full_salary), flt(self.rate_percent), calculated_amount
		)
		self.calculation_note = _conversion_note(rule, effective_count).format(
			flt(self.full_salary), flt(self.rate_percent), calculated_amount
		)
		if self.manual_amount_override:
			self.calculation_note = _("{0}；已人工调整为 {1:.2f} 元。").format(calculation, flt(self.amount))

	def _validate_amount(self):
		if flt(self.amount) < 0:
			frappe.throw(_("奖惩金额请填写正数；发放或扣减方向由奖惩类型决定。"))

	def _validate_status_transition(self):
		if self.status in ("已生效", "已驳回", "已撤销") and not {
			"HR Manager",
			"System Manager",
		}.intersection(frappe.get_roles()):
			frappe.throw(_("只有人事经理或系统管理员可以审批、驳回或撤销奖惩记录。"))
		if self.is_new():
			return
		previous = self.get_doc_before_save()
		if not previous:
			return
		if previous.status in ("已生效", "已撤销") and previous.status == self.status:
			protected_fields = (
				"employee",
				"employee_code",
				"employee_name",
				"company",
				"department",
				"designation",
				"rule",
				"reward_punishment_type",
				"category",
				"occurred_on",
				"subject",
				"reason",
				"standard",
				"decision_result",
				"full_salary",
				"rate_percent",
				"amount",
				"payroll_welfare_source",
			)
			if any(previous.get(fieldname) != self.get(fieldname) for fieldname in protected_fields):
				frappe.throw(_("已生效或已撤销的奖惩记录不能改写业务内容。"))
			return
		if previous.status == self.status:
			return
		allowed = {
			"草稿": {"待审核", "已驳回"},
			"待审核": {"已生效", "已驳回", "草稿"},
			"已驳回": {"草稿"},
			"已生效": {"已撤销"},
			"已撤销": set(),
		}
		if self.status not in allowed.get(previous.status, set()):
			frappe.throw(
				_("奖惩记录不能从“{0}”直接变更为“{1}”。").format(previous.status, self.status)
			)

	def _set_approval_audit(self):
		if self.status == "已生效" and not self.approved_on:
			self.approved_by = frappe.session.user
			self.approved_on = now_datetime()
