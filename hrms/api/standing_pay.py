"""Persistent salary and contribution registers, independent of payroll months."""
import json

import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate

SALARY = 'HRMS Employee Salary Change'
CONTRIBUTION = 'HRMS Employee Contribution Change'
CONTRIBUTION_TYPES = ('社保个人', '社保公司', '公积金个人', '公积金公司')


def _access(company, approve=False):
	from hrms.payroll.standing_permissions import require_access
	return require_access(company, approve=approve)


@frappe.whitelist()
def permissions(company: str):
	company = _access(company)
	from hrms.payroll.standing_permissions import can_approve
	return {'company': company, 'can_submit': True, 'can_approve': can_approve()}


def _register_key(row, doctype):
	return (row.employee, row.get('contribution_type') if doctype == CONTRIBUTION else '')


def _request_order(row):
	return (str(row.get('submitted_on') or row.get('creation') or ''), str(row.name))


def _attach_previous_standards(rows, doctype):
	"""Attach the approved standard that was effective when each request was submitted."""
	groups = {}
	for row in rows:
		groups.setdefault(_register_key(row, doctype), []).append(row)
	for group in groups.values():
		approved = [row for row in group if row.status == '已批准']
		for row in group:
			request_stamp = _request_order(row)[0]
			request_date = request_stamp[:10]
			candidates = [candidate for candidate in approved
				if candidate.name != row.name
				and str(candidate.get('approved_on') or candidate.get('submitted_on') or candidate.get('creation') or '') <= request_stamp
				and str(candidate.get('effective_date') or '') <= request_date]
			row['previous_standard'] = max(candidates, key=lambda candidate: (
				str(candidate.get('effective_date') or ''),
				str(candidate.get('approved_on') or candidate.get('submitted_on') or candidate.get('creation') or ''),
				str(candidate.name),
			)) if candidates else None
	return rows


def _only_change_records(rows, doctype):
	"""Return requests made after the first approved standard for each register."""
	first_approved = {}
	for row in sorted(rows, key=_request_order):
		key = _register_key(row, doctype)
		if row.status == '已批准' and key not in first_approved:
			first_approved[key] = _request_order(row)
	return [row for row in rows
		if _register_key(row, doctype) in first_approved
		and _request_order(row) > first_approved[_register_key(row, doctype)]]


@frappe.whitelist()
def list_change_records(company: str, kind: str):
	company = _access(company)
	if kind not in ('salary', 'contribution'):
		frappe.throw(_('无效的档案类型。'))
	doctype = SALARY if kind == 'salary' else CONTRIBUTION
	filters = {'company': company}
	if doctype == SALARY:
		filters['exclude_from_payroll'] = 0
	rows = frappe.get_all(doctype, filters=filters, fields=['*'],
		order_by='submitted_on desc, creation desc', limit_page_length=10000)
	_attach_previous_standards(rows, doctype)
	rows = _only_change_records(rows, doctype)
	departments = {row.name: row.department_name for row in frappe.get_all('Department',
		filters={'company': company}, fields=['name', 'department_name'], limit_page_length=100000)}
	for row in rows:
		row['decision_doctype'] = doctype
		row['department'] = departments.get(row.department, row.department) or ''
	return rows


def active_contributions(company, as_of=None, employee=None):
	"""Latest approved revision per employee/type. A stopped revision is explicit zero."""
	filters = {'company': company, 'status': '已批准', 'effective_date': ['<=', as_of or nowdate()]}
	if employee:
		filters['employee'] = employee
	rows = frappe.get_all(CONTRIBUTION,
		filters=filters,
		fields=['*'], order_by='effective_date desc, approved_on desc, creation desc, name desc',
		limit_page_length=100000)
	latest = {}
	for row in rows:
		latest.setdefault((row.employee, row.contribution_type), row)
	return list(latest.values())


@frappe.whitelist()
def list_register(company: str):
	company = _access(company)
	contributions = active_contributions(company)
	registered = {row.employee for row in contributions}
	rows = frappe.get_all('Employee', filters={'company': company},
		fields=['name', 'employee_name', 'custom_employee_code', 'department', 'status'],
		order_by='employee_name asc', limit_page_length=100000)
	departments = {row.name: row.department_name for row in frappe.get_all('Department',
		filters={'company': company}, fields=['name', 'department_name'], limit_page_length=100000)}
	employees = [dict(employee=row.name, employee_name=row.employee_name,
		employee_code=row.custom_employee_code or row.name,
		department=departments.get(row.department, row.department) or '', employee_status=row.status)
		for row in rows if row.status == 'Active' or row.name in registered]
	initialized = frappe.get_all(CONTRIBUTION, filters={'company': company, 'status': ['in', ['待审核', '已批准']]},
		fields=['employee', 'contribution_type'], limit_page_length=100000)
	return {'employees': employees, 'contributions': contributions, 'initialized': initialized}


@frappe.whitelist()
def initial_salary_rows(company: str):
	company = _access(company)
	from hrms.api.payroll_input import list_employee_salary_change_grid
	rows = list_employee_salary_change_grid(company, payroll_month='', page_length=100000)['rows']
	initialized = set(frappe.get_all(SALARY, filters={'company': company,
		'exclude_from_payroll': 0, 'status': ['in', ['待审核', '已批准']]}, pluck='employee', limit_page_length=100000))
	return {'rows': [row for row in rows if row['employee'] not in initialized]}


@frappe.whitelist()
def submit_contribution(company: str, employee: str, contribution_type: str, effective_date: str, personal_amount: float = 0,
	company_amount: float = 0, enabled: int = 1, remarks: str = '', request_mode: str = 'change'):
	company = _access(company)
	if request_mode == 'initial' and frappe.db.exists(CONTRIBUTION, {
		'company': company, 'employee': employee, 'contribution_type': contribution_type,
		'status': ['in', ['待审核', '已批准']]}):
		frappe.throw(_('该缴费项目已录入或正在审批，请通过申请修改处理。'))
	if not str(remarks).strip():
		frappe.throw(_('请填写修改原因。'))
	if not effective_date:
		frappe.throw(_('请填写生效日期。'))
	context = frappe.db.get_value('Employee', employee,
		['company', 'employee_name', 'custom_employee_code', 'department'], as_dict=True) or {}
	if context.get('company') != company:
		frappe.throw(_('员工不属于当前公司。'))
	values = dict(company=company, employee=employee, employee_code=context.get('custom_employee_code') or employee,
		employee_name=context.get('employee_name'), department=context.get('department'),
		contribution_type=contribution_type, effective_date=getdate(effective_date),
		personal_amount=flt(personal_amount), company_amount=flt(company_amount),
		enabled=int(bool(int(enabled))), remarks=remarks)
	# Exact retries of a pending request reuse the request; changed payloads are new revisions.
	existing = frappe.db.get_value(CONTRIBUTION,
		{**values, 'status': '待审核', 'submitted_by': frappe.session.user}, 'name')
	if existing:
		return existing
	# Keep one pending decision per employee, contribution type and effective
	# date.  The Employee-row lock also prevents concurrent submissions from
	# both observing an empty pending slot.
	frappe.db.sql('SELECT name FROM `tabEmployee` WHERE name=%s FOR UPDATE', (employee,))
	pending = frappe.db.get_value(CONTRIBUTION, {
		'company': company, 'employee': employee, 'contribution_type': contribution_type,
		'effective_date': values['effective_date'], 'status': '待审核',
	}, 'name')
	if pending:
		frappe.throw(_('该员工在此生效日期已有待审批的缴费申请，请先等待审批结果或驳回后再提交。'))
	doc = frappe.get_doc({'doctype': CONTRIBUTION, **values}).insert(ignore_permissions=True)
	return doc.name


@frappe.whitelist()
def list_pending(company: str):
	company = _access(company, approve=True)
	result = []
	for doctype in (SALARY, CONTRIBUTION):
		filters = {'company': company, 'status': '待审核'}
		if doctype == SALARY:
			filters['exclude_from_payroll'] = 0
		pending = frappe.get_all(doctype, filters=filters,
			fields=['*'], order_by='creation desc', limit_page_length=100000)
		# Compare against the approved standard in force when the reviewer opens
		# the page. Pending proposals and future approvals are not current pay.
		current = {}
		if pending:
			approved_filters = {**filters, 'status': '已批准', 'effective_date': ['<=', nowdate()],
				'employee': ['in', list({row.employee for row in pending})]}
			for approved in frappe.get_all(doctype, filters=approved_filters, fields=['*'],
				order_by='effective_date desc, approved_on desc, creation desc, name desc', limit_page_length=100000):
				current.setdefault((approved.employee, approved.get('contribution_type')), approved)
		for row in pending:
			row['decision_doctype'] = doctype
			row['previous_standard'] = current.get((row.employee, row.get('contribution_type')))
			result.append(row)
	return result


@frappe.whitelist()
def employee_history(company: str, employee: str):
	company = _access(company)
	if frappe.db.get_value('Employee', employee, 'company') != company:
		frappe.throw(_('员工不属于当前公司。'))
	result = []
	for doctype in (SALARY, CONTRIBUTION):
		filters = {'company': company, 'employee': employee}
		if doctype == SALARY:
			filters['exclude_from_payroll'] = 0
		for row in frappe.get_all(doctype, filters=filters,
			fields=['*'], order_by='effective_date desc, creation desc', limit_page_length=100000):
			row['decision_doctype'] = doctype
			result.append(row)
	return sorted(result, key=lambda row: str(row.get('submitted_on') or row.get('creation') or ''), reverse=True)


@frappe.whitelist()
def review_decision(company: str, decision_doctype: str, name: str, decision: str, review_note: str):
	company = _access(company, approve=True)
	if decision_doctype not in (SALARY, CONTRIBUTION) or decision not in ('已批准', '已驳回'):
		frappe.throw(_('无效的审批操作。'))
	# Serialize competing reviewers; the document controller checks status and self-approval.
	frappe.db.sql(f'SELECT name FROM `tab{decision_doctype}` WHERE name=%s FOR UPDATE', (name,))
	doc = frappe.get_doc(decision_doctype, name)
	if doc.company != company:
		frappe.throw(_('不能审批其他公司的记录。'))
	doc.status, doc.review_note = decision, review_note
	doc.save(ignore_permissions=True)
	return {'name': doc.name, 'status': doc.status, 'approved_by': doc.approved_by, 'approved_on': doc.approved_on}


@frappe.whitelist()
def import_contribution_workbook(company: str, file_url: str, effective_date: str, preview: int = 1, request_mode: str = 'change'):
	"""Reuse the existing source parsers; the independent register owns the approval."""
	company = _access(company)
	from hrms.api.payroll_input import (_load_workbook, _raw_payroll_source_kind, _raw_payroll_source_rows,
		_first, _payroll_employee_lookup, _raw_variable_entries)
	if not effective_date:
		frappe.throw(_('请选择本次变更的生效日期。'))
	workbook = _load_workbook(file_url)
	rows, errors, seen = [], [], set()
	for sheet in workbook:
		kind = _raw_payroll_source_kind(sheet)
		if kind not in ('social_insurance', 'housing_fund'):
			continue
		for index, raw in enumerate(_raw_payroll_source_rows(sheet, kind), 1):
			code, name = _first(raw, '工号', '员工编号'), _first(raw, '姓名')
			if not code and not name:
				continue
			try:
				employee = _payroll_employee_lookup(code, name)
				if not employee or frappe.db.get_value('Employee', employee, 'company') != company:
					raise ValueError('工号、姓名或公司不匹配')
				if request_mode == 'initial' and frappe.db.exists(CONTRIBUTION, {'company': company, 'employee': employee,
					'contribution_type': '社保' if kind == 'social_insurance' else '公积金', 'status': ['in', ['待审核', '已批准']]}):
					raise ValueError('已录入或正在审批，请通过申请修改处理')
				key = (employee, kind)
				if key in seen:
					raise ValueError('同一员工同一缴费类型重复，请先合并源文件')
				seen.add(key)
				amounts = _raw_variable_entries(kind, raw)
				if any(amount < 0 for _, amount in amounts):
					raise ValueError('缴费金额不能为负数')
				rows.append(dict(employee=employee, employee_name=name or employee,
					contribution_type='社保' if kind == 'social_insurance' else '公积金',
					personal_amount=amounts[0][1], company_amount=amounts[1][1]))
			except Exception as exc:
				errors.append(f'{sheet.title} / {index} / {code or name}: {exc}')
	if int(preview):
		return {'rows': rows, 'errors': errors}
	if errors or not rows:
		frappe.throw(_('请先修正预览中的异常；文件必须包含社保或公积金来源表。'))
	for row in rows:
		submit_contribution(company, row['employee'], row['contribution_type'], effective_date,
			row['personal_amount'], row['company_amount'], remarks=f'Excel 导入：{file_url}', request_mode=request_mode)
	return {'submitted': len(rows)}
