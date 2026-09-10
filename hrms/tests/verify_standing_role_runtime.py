"""Exercise real roles and approval transitions; roll back every business record."""
import frappe
from frappe.utils import flt


def run(company: str = '永新', operator: str = 'payroll.operator@hrms.local'):
	from hrms.api import standing_pay as api
	from hrms.api.payroll_input import create_employee_salary_change, get_active_salary_change_for_employee, list_employee_salary_change_grid
	original = frappe.session.user
	assert frappe.db.exists('User', operator)
	roles = frappe.get_roles(operator)
	assert '薪资经办' in roles and not {'System Manager', 'HR Manager', '薪资审批'} & set(roles)
	created = []
	frappe.db.savepoint('standing_role_check')
	def denied(fn):
		try:
			fn()
		except frappe.PermissionError:
			return
		raise AssertionError('Expected permission denial')
	try:
		frappe.set_user(operator)
		assert api.permissions(company)['can_approve'] is False
		rows = list_employee_salary_change_grid(company)['rows']
		initial = api.initial_salary_rows(company)['rows']
		assert not any(row['name'] for row in initial)
		row = next(row for row in rows if row['name'])
		employee = row['employee']
		assert employee not in {row['employee'] for row in initial}
		old_salary = get_active_salary_change_for_employee(employee=employee, company=company, payroll_month='2099-01')
		name = create_employee_salary_change(company=company, employee=employee, effective_date='2099-01-01',
			base_salary=flt(row['base_salary']) + 1, function_allowance=flt(row['function_allowance']),
			certificate_allowance=flt(row['certificate_allowance']), multi_skill_allowance=flt(row['multi_skill_allowance']),
			remarks='权限流程自动验收：本事务回滚，不保留业务数据')
		created.append((api.SALARY, name))
		assert frappe.db.get_value(api.SALARY, name, 'status') == '待审核'
		assert get_active_salary_change_for_employee(employee=employee, company=company, payroll_month='2099-01')['name'] == old_salary['name']
		denied(lambda: api.list_pending(company))
		denied(lambda: api.review_decision(company, api.SALARY, name, '已批准', '越权测试'))
		doc = frappe.get_doc(api.SALARY, name); doc.status = '已批准'; doc.review_note = '直接保存越权测试'
		denied(lambda: doc.save(ignore_permissions=True))
		frappe.set_user('Administrator')
		api.review_decision(company, api.SALARY, name, '已批准', '审核测试，事务结束回滚')
		assert get_active_salary_change_for_employee(employee=employee, company=company, payroll_month='2099-01')['name'] == name
		doc = frappe.get_doc(api.SALARY, name)
		assert doc.submitted_by == operator and doc.approved_by == 'Administrator' and doc.submitted_on and doc.approved_on
		frappe.set_user(operator)
		before = {(r.employee, r.contribution_type): r.name for r in api.active_contributions(company, '2099-01-01')}
		name = api.submit_contribution(company, employee, '社保', '2099-01-01', 101, 202,
			remarks='权限流程自动验收：本事务回滚，不保留业务数据')
		created.append((api.CONTRIBUTION, name))
		assert {(r.employee, r.contribution_type): r.name for r in api.active_contributions(company, '2099-01-01')} == before
		denied(lambda: api.review_decision(company, api.CONTRIBUTION, name, '已批准', '越权测试'))
		frappe.set_user('Administrator')
		api.review_decision(company, api.CONTRIBUTION, name, '已批准', '审核测试，事务结束回滚')
		assert next(r for r in api.active_contributions(company, '2099-01-01') if r.employee == employee and r.contribution_type == '社保').name == name
		frappe.set_user(operator)
		assert any(r.name == name and r.approved_by == 'Administrator' for r in api.list_change_records(company, 'contribution'))
		frappe.set_user('Administrator')
		for doctype in (api.SALARY, api.CONTRIBUTION):
			for decision in ('已批准', '已驳回'):
				if doctype == api.SALARY:
					name = create_employee_salary_change(company=company, employee=employee, effective_date='2099-02-01',
						base_salary=flt(row['base_salary']) + 2, function_allowance=flt(row['function_allowance']),
						remarks='最高管理员自审验收：本事务回滚 ' + decision)
				else:
					name = api.submit_contribution(company, employee, '社保', '2099-02-01', 103, 204,
						remarks='最高管理员自审验收：本事务回滚 ' + decision)
				created.append((doctype, name))
				api.review_decision(company, doctype, name, decision, '最高管理员自审，事务结束回滚')
				doc = frappe.get_doc(doctype, name)
				assert doc.status == decision and doc.submitted_by == doc.approved_by == 'Administrator'
				assert doc.submitted_on and doc.approved_on and doc.review_note
		frappe.set_user(operator)
		for other in frappe.get_all('Company', pluck='name'):
			if other != company:
				denied(lambda: api.permissions(other))
		frappe.set_user('Guest')
		denied(lambda: api.permissions(company))
	finally:
		frappe.db.rollback(save_point='standing_role_check')
		frappe.set_user(original)
	for doctype, name in created:
		assert not frappe.db.exists(doctype, name), 'Test record must not persist'
	return {'operator': operator, 'role': '薪资经办', 'salary_and_contribution_approval_flow': 'passed',
		'operator_api_and_document_approval_denied': True, 'pending_keeps_original_standard': True,
		'approved_uses_new_standard': True, 'reviewer_and_timestamps_verified': True,
		'administrator_self_approval_and_rejection_verified': True,
		'company_scope_verified': True, 'initial_entry_excludes_existing': True, 'business_test_records_rolled_back': len(created)}
