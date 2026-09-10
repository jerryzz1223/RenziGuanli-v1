"""Preserve confirmed legacy contributions as dated, traceable standing decisions."""
from collections import defaultdict
import json

import frappe
from frappe.utils import flt

from hrms.api.standing_pay import CONTRIBUTION, CONTRIBUTION_TYPES, SALARY
from hrms.payroll.standing_pay import legacy_migration


def execute():
	frappe.reload_doc('hr', 'doctype', 'hrms_employee_contribution_change')
	frappe.reload_doc('hr', 'doctype', 'hrms_employee_salary_change')
	from hrms.api.payroll_input import (_current_payroll_attendance_lock, _monthly_variable_scope,
		VARIABLE_BATCH_DOCTYPE, VARIABLE_RECORD_DOCTYPE)
	batches = {row.name: row for row in frappe.get_all(VARIABLE_BATCH_DOCTYPE,
		fields=['name', 'company', 'payroll_month', 'source_type', 'status', 'is_selected', 'confirmed_by', 'confirmed_on'],
		limit_page_length=100000)}
	selected = {(row.company, row.payroll_month, row.source_type): row.name
		for row in batches.values() if row.is_selected and row.status == '已确认' and row.source_type}
	groups, locks = {}, {}
	for row in frappe.get_all(VARIABLE_RECORD_DOCTYPE,
		filters={'variable_type': ['in', CONTRIBUTION_TYPES], 'review_status': '已确认', 'excluded': 0},
		fields=['*'], order_by='modified asc, name asc', limit_page_length=100000):
		batch = batches.get(row.import_batch)
		if batch and (batch.status != '已确认' or (batch.source_type and
			selected.get((row.company, row.payroll_month, batch.source_type), batch.name) != batch.name)):
			continue
		scope = (row.company, row.payroll_month)
		if scope not in locks:
			locks[scope] = (_current_payroll_attendance_lock(*scope) or {}).get('attendance_lock_version') or ''
		if (row.attendance_lock_version or '') not in ('', _monthly_variable_scope(row.payroll_month), locks[scope]):
			continue
		if not row.employee or frappe.db.get_value('Employee', row.employee, 'company') != row.company:
			frappe.throw(f'历史缴费来源 {row.name} 缺少有效员工，迁移前请修正工号/公司。')
		kind = '社保' if row.variable_type.startswith('社保') else '公积金'
		key = (row.company, row.employee, row.payroll_month, kind)
		entry = groups.setdefault(key, dict(company=row.company, employee=row.employee,
			employee_code=row.employee_code, employee_name=row.employee_name, department=row.department,
			contribution_type=kind, effective_date=f'{row.payroll_month}-01', enabled=1,
			personal_amount=0, company_amount=0, status='已批准',
			submitted_by=row.modified_by or row.owner, submitted_on=row.modified or row.creation,
			approved_by=batch.confirmed_by if batch else None,
			approved_on=batch.confirmed_on if batch else None,
			remarks='历史已确认月度缴费迁入，后续持续延用；原始来源保留。', refs=[]))
		entry['personal_amount' if row.variable_type.endswith('个人') else 'company_amount'] += flt(row.amount)
		entry['refs'].append(row.name)
	with legacy_migration():
		for values in groups.values():
			values['legacy_reference'] = json.dumps(sorted(values.pop('refs')), ensure_ascii=False)
			if not frappe.db.exists(CONTRIBUTION, {'company': values['company'], 'employee': values['employee'],
				'contribution_type': values['contribution_type'], 'effective_date': values['effective_date'],
				'legacy_reference': values['legacy_reference']}):
				frappe.get_doc({'doctype': CONTRIBUTION, **values}).insert(ignore_permissions=True)
	# Historical salary approvals are not fabricated. Preserve unknown reviewers as unknown.
	for row in frappe.get_all(SALARY, fields=['name', 'submitted_by', 'modified_by', 'modified', 'creation'], limit_page_length=100000):
		if not row.submitted_by:
			frappe.db.set_value(SALARY, row.name, dict(submitted_by=row.modified_by,
				submitted_on=row.modified or row.creation, legacy_reference='历史定薪：修改人及时间取自原记录；旧审批信息按原样保留。'), update_modified=False)
	frappe.db.add_index(CONTRIBUTION, ['company', 'employee', 'contribution_type', 'status', 'effective_date'], 'standing_contribution_lookup')
