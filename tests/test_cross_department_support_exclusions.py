"""Date exclusions affect every qualification of an employee and preserve history."""
from datetime import date
from types import SimpleNamespace, ModuleType
from unittest.mock import patch
import sys
import unittest

from test_support_and_form_revocation import Row, functions, fail


class ExclusionTests(unittest.TestCase):
    def candidates(self, day, include=0, ready=True):
        rows = [Row(name=f'CAP-{i}', employee=employee, employee_name=employee,
                    qualification_status='有效', is_active=1, valid_from=None, valid_until=None)
                for i, employee in enumerate(['EMP-1', 'EMP-1', 'EMP-2'])]
        support = ModuleType('hrms.api.cross_department_support')
        support.EXCLUSION = 'Cross Department Support Exclusion'
        support.storage_ready = lambda *a: ready
        def exclusions(dt, filters, fields):
            selected = filters['from_date'][1]
            self.assertEqual(selected, filters['to_date'][1])
            return [Row(employee='EMP-1')] if date(2026,10,20) <= selected <= date(2026,10,30) else []
        support.visible_rows = exclusions
        frappe = SimpleNamespace(throw=fail, PermissionError=PermissionError,
                                 has_permission=lambda *a: True, get_list=lambda *a, **kw: rows,
                                 utils=SimpleNamespace(cint=int, cstr=lambda value:str(value or '')))
        api = functions('hrms/hr/doctype/cross_department_support_capability/cross_department_support_capability.py',
                        ['get_available_support_candidates'], dict(frappe=frappe, _=lambda s:s,
                        getdate=lambda v=None: date.fromisoformat(v or '2026-10-30'),
                        _can_read_support_capabilities=lambda:True))
        with patch.dict(sys.modules, {'hrms.api.cross_department_support':support}):
            return api.get_available_support_candidates(dispatch_date=day, include_unavailable=include)

    def test_date_boundaries_and_employee_wide_exclusion(self):
        for day in ['2026-10-20', '2026-10-25', '2026-10-30']:
            self.assertEqual(self.candidates(day)['count'], 1)
            result = self.candidates(day, 1)
            self.assertEqual(result['count'], 3)
            self.assertEqual([r.availability for r in result['rows']].count('排除派遣'), 2)
        for day in ['2026-10-19', '2026-10-31']:
            self.assertEqual(self.candidates(day)['count'], 3)

    def test_missing_exclusion_ledger_preserves_imported_candidates(self):
        result = self.candidates('2026-10-30', ready=False)
        self.assertEqual(result['count'], 3)
        self.assertTrue(all(row.availability == '可派' for row in result['rows']))
        self.assertTrue(all(not row.exclusion_active for row in result['rows']))

    def test_dropdown_keeps_imported_values_and_reads_only_permitted_masters(self):
        support = ModuleType('hrms.api.cross_department_support')
        calls = []
        def visible_rows(dt, filters, fields):
            calls.append(dt)
            if dt == 'Cross Department Support Capability':
                return [Row(support_department='Imported Dept', support_designation='Imported Job')]
            return [Row(name='Master Job')]
        support.visible_rows = visible_rows
        frappe = SimpleNamespace(throw=fail, PermissionError=PermissionError,
                                 has_permission=lambda dt, kind: dt == 'Designation')
        api = functions('hrms/hr/doctype/cross_department_support_capability/cross_department_support_capability.py',
                        ['get_support_capability_options'], dict(frappe=frappe, _=lambda s:s, cstr=str,
                        _can_read_support_capabilities=lambda:True))
        with patch.dict(sys.modules, {'hrms.api.cross_department_support':support}):
            result = api.get_support_capability_options()
        self.assertEqual(result['departments'], ['Imported Dept'])
        self.assertEqual(result['designations'], ['Imported Job', 'Master Job'])
        self.assertEqual(result['pairs'], [{'department': 'Imported Dept', 'designation': 'Imported Job'}])
        self.assertNotIn('Department', calls)

    def test_dropdown_requires_capability_read_permission(self):
        frappe = SimpleNamespace(throw=fail, PermissionError=PermissionError)
        api = functions('hrms/hr/doctype/cross_department_support_capability/cross_department_support_capability.py',
                        ['get_support_capability_options'], dict(frappe=frappe, _=lambda s:s,
                        _can_read_support_capabilities=lambda:False))
        with self.assertRaises(PermissionError): api.get_support_capability_options()

    def test_form_validation_dates_reason_and_employee_permission(self):
        frappe = SimpleNamespace(throw=fail, get_doc=lambda *a: Row())
        api = functions('hrms/hr/doctype/cross_department_support_exclusion/cross_department_support_exclusion.py',
                        ['CrossDepartmentSupportExclusion'], dict(Document=Row, frappe=frappe, _=lambda s:s,
                        getdate=date.fromisoformat))
        doc = api.CrossDepartmentSupportExclusion(employee='EMP-1', from_date='2026-10-30', to_date='2026-10-30', reason='leave')
        doc.validate()
        for end, reason in [('2026-10-29', 'leave'), ('2026-10-30', '  ')]:
            doc.to_date, doc.reason = end, reason
            with self.assertRaises(ValueError): doc.validate()
        frappe.get_doc = lambda *a: Row(denied=['read'])
        with self.assertRaises(PermissionError): doc.validate()


if __name__ == '__main__':
    unittest.main()
