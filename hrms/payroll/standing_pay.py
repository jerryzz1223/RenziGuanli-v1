"""Immutable, effective-dated payroll decisions shared by Desk and API writes."""
import math
from contextlib import contextmanager
from contextvars import ContextVar

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate, get_datetime, now_datetime

_migrating = ContextVar('standing_pay_migration', default=False)


@contextmanager
def legacy_migration():
	token = _migrating.set(True)
	try:
		yield
	finally:
		_migrating.reset(token)


def _comparable(field, value):
	# Desk JSON and database rows represent empty checks, dates and currency
	# differently; compare their field values, never their transport types.
	if field.fieldtype in ('Check', 'Int', 'Float', 'Currency', 'Percent'):
		return flt(value)
	if field.fieldtype == 'Date' and value:
		return getdate(value)
	if field.fieldtype == 'Datetime' and value:
		return get_datetime(value)
	return value or ''


def _pending_request_filters(doc):
	"""Return the single approval slot represented by a payroll decision.

	A salary change is unique for an employee on its effective date.  A social
	insurance or housing-fund change additionally has a contribution type.  The
	filter deliberately covers only pending requests: approved decisions remain
	immutable history and can be followed by a later, distinct application.
	"""
	filters = {
		'company': doc.company,
		'employee': doc.employee,
		'effective_date': doc.effective_date,
		'status': '待审核',
	}
	if doc.doctype == 'HRMS Employee Salary Change':
		filters['exclude_from_payroll'] = 0
	else:
		filters['contribution_type'] = doc.contribution_type
	return filters


def _lock_employee_decision_slot(employee):
	"""Serialize new decisions for one employee before checking the pending slot."""
	frappe.db.sql('SELECT name FROM `tabEmployee` WHERE name=%s FOR UPDATE', (employee,))


class StandingPayDecision(Document):
	def validate(self):
		if _migrating.get():
			return
		from hrms.payroll.standing_permissions import require_access
		require_access(self.company)
		if frappe.db.get_value('Employee', self.employee, 'company') != self.company:
			frappe.throw(_('员工不属于当前公司。'))
		old = self.get_doc_before_save()
		# Participation markers are managed by the existing monthly scope workflow.
		# They must never be usable to change real salary or contribution amounts.
		marker = self.doctype == 'HRMS Employee Salary Change' and self.get('exclude_from_payroll')
		if marker and (not old or old.get('exclude_from_payroll')):
			from hrms.api.payroll_input import _require_payroll_master_manager
			_require_payroll_master_manager()
			for field in ('base_salary', 'function_allowance', 'certificate_allowance', 'multi_skill_allowance', 'full_salary'):
				if flt(self.get(field)):
					frappe.throw(_('不参与薪资标记不能包含薪资金额。'))
			return
		if not self.effective_date:
			frappe.throw(_('请填写生效日期。'))
		getdate(self.effective_date)
		if self.doctype == 'HRMS Employee Salary Change':
			money_fields = ('base_salary', 'function_allowance', 'certificate_allowance', 'multi_skill_allowance')
			self.full_salary = flt(self.base_salary) + flt(self.function_allowance)
		else:
			money_fields = ('personal_amount', 'company_amount')
			if self.contribution_type not in ('社保', '公积金'):
				frappe.throw(_('缴费类型必须是社保或公积金。'))
			if not self.enabled:
				self.personal_amount = self.company_amount = 0
		for field in money_fields:
			if not math.isfinite(flt(self.get(field))) or flt(self.get(field)) < 0:
				frappe.throw(_('金额不能小于零。'))
		if not old:
			if not str(self.get('remarks') or '').strip():
				frappe.throw(_('请填写修改原因。'))
			# Lock the stable Employee row, rather than a possibly absent change row,
			# so simultaneous submissions cannot both pass an empty pending query.
			_lock_employee_decision_slot(self.employee)
			if frappe.db.exists(self.doctype, _pending_request_filters(self)):
				frappe.throw(_('该员工在此生效日期已有待审批申请，请先等待审批结果或驳回后再提交。'))
			self.status = '待审核'
			self.submitted_by = frappe.session.user
			self.submitted_on = now_datetime()
			self.approved_by = self.approved_on = self.review_note = self.legacy_reference = None
			return
		require_access(self.company, approve=True)
		# No amount, effective date, identity, source or audit field can be rewritten.
		mutable = {'status', 'approved_by', 'approved_on', 'review_note'}
		for field in self.meta.fields:
			key = field.fieldname
			if field.fieldtype in ('Section Break', 'Column Break', 'Tab Break', 'HTML', 'Button') or key in mutable:
				continue
			if _comparable(field, self.get(key)) != _comparable(field, old.get(key)):
				frappe.throw(_('已提交的档案不可覆盖，请新增变更申请。'))
		if old.status != '待审核' or self.status not in ('已批准', '已驳回'):
			frappe.throw(_('仅待审核申请可以审批；已审批记录永久保留。'))
		# The built-in highest administrator may review their own requests.
		# An ordinary account with approval roles still requires a second person.
		if frappe.session.user != 'Administrator' and frappe.session.user == (old.submitted_by or old.owner):
			frappe.throw(_('修改人不能审批自己的申请，请由另一位人事管理员审批。'))
		if not self.review_note:
			frappe.throw(_('请填写审批意见。'))
		if self.status == '已批准':
			# Confirmed payslips keep their source meaning. Backdated changes require
			# the established payroll adjustment process, never a silent new baseline.
			closed = frappe.db.exists('HRMS Payroll Settlement Record', {
				'company': self.company, 'employee': self.employee,
				'payroll_month': ['>=', str(self.effective_date)[:7]],
				'calculation_status': ['in', ['已确认', '已生成工资单']]})
			if closed:
				frappe.throw(_('生效日期涉及已确认薪资，请选择未结算期间；历史差额通过薪资调整处理。'))
		self.approved_by = frappe.session.user
		self.approved_on = now_datetime()

	def on_trash(self):
		if not _migrating.get() and not self.get('exclude_from_payroll'):
			frappe.throw(_('薪资及缴费变更记录须永久保留，不能删除。'))
