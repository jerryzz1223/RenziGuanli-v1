"""Read-only verification against an already migrated local site; no user or business writes."""
from collections import defaultdict
import json

import frappe
from frappe.utils import flt


def run(company: str = '永新'):
	from hrms.api import payroll_input as payroll
	from hrms.api import standing_pay as api
	frappe.set_user('Administrator')
	july = api.active_contributions(company, '2026-07-31')
	september = api.active_contributions(company, '2026-09-30')
	assert july, 'No migrated legacy contribution records'
	assert {row.name for row in july} == {row.name for row in september}, 'Carry-forward changed IDs'
	for row in july:
		references = json.loads(row.legacy_reference)
		original = frappe.get_all(payroll.VARIABLE_RECORD_DOCTYPE, filters={'name': ['in', references]}, fields=['variable_type', 'amount', 'employee', 'company'])
		assert all(item.employee == row.employee and item.company == company for item in original)
		for suffix, field in (('个人', 'personal_amount'), ('公司', 'company_amount')):
			assert abs(sum(flt(item.amount) for item in original if item.variable_type == row.contribution_type + suffix) - flt(row.get(field))) < .005
	actual, _, sources = payroll._variable_totals(company, '2026-09')
	for row in september:
		key = payroll._employee_identity_key(row)
		assert actual[key][row.contribution_type + '个人'] == flt(row.personal_amount)
		assert actual[key][row.contribution_type + '公司'] == flt(row.company_amount)
		assert row.name in [item['name'] for item in sources[key]]
	assert not {'social_insurance', 'housing_fund'} & {row['source_code'] for row in payroll._default_variable_source_rows()}
	old = payroll._latest_salary_change_map('2026-07', company)
	later = payroll._latest_salary_change_map('2026-09', company)
	common = [key for key in old if key in later]
	assert common and all(old[key].name == later[key].name for key in common)
	# Exercise the installed Frappe controller in memory only. Never insert/save.
	fixture_employee = july[0].employee
	controller_checks = []
	for doctype in (api.SALARY, api.CONTRIBUTION):
		doc = frappe.get_doc(dict(doctype=doctype, company=company, employee=fixture_employee,
			effective_date='2199-01-01', base_salary=3000, function_allowance=200,
			certificate_allowance=0, multi_skill_allowance=0, contribution_type='社保',
			personal_amount=100, company_amount=200, enabled=1, remarks='仅内存控制器测试',
			status='已批准', approved_by='forged'))
		doc.validate()
		assert doc.status == '待审核' and not doc.approved_by
		doc._doc_before_save = frappe.get_doc(doc.as_dict())
		doc.status, doc.review_note = '已批准', '内存测试审批'
		try:
			doc.validate()
		except frappe.ValidationError:
			pass
		else:
			raise AssertionError('self approval not rejected')
		# The prior in-memory fixture has a different author; no User or Role is created.
		doc.submitted_by = doc._doc_before_save.submitted_by = 'memory-fixture-author'
		doc.validate()
		assert doc.approved_by == 'Administrator' and doc.approved_on
		controller_checks.append(doctype)
	result = {'installed_controller_memory_checks': controller_checks, 'migrated_records' : len(july), 'employee_count': len({row.employee for row in july}),
		'personal_and_company_amounts_match_original': True, 'july_to_september_same_source_ids': True,
		'payroll_totals_and_trace_verified': True, 'salary_carry_forward_keys': len(common), 'database_writes': 0}
	print(json.dumps(result, ensure_ascii=False))
	return result
