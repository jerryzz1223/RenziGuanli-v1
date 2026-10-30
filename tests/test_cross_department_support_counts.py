"""Regression checks without a database: counting rules, permission boundaries and pagination."""
from contextlib import contextmanager
from datetime import date
import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import patch
import unittest

ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def load_api():
    frappe = ModuleType('frappe')
    frappe._ = lambda value: value
    frappe.whitelist = lambda: lambda fn: fn
    frappe.PermissionError = PermissionError
    frappe.throw = lambda message, error=ValueError: (_ for _ in ()).throw(error(message))
    utils = ModuleType('frappe.utils')
    utils.getdate = lambda value: date.fromisoformat(str(value)[:10])
    utils.nowdate = lambda: '2026-10-23'
    frappe.get_doc = lambda *args: SimpleNamespace(check_permission=lambda value: None)
    frappe.has_permission = lambda *args: True
    frappe.get_list = lambda *args, **kwargs: []
    frappe.db = SimpleNamespace(exists=lambda *args: True, table_exists=lambda *args: True)
    with patch.dict(sys.modules, {'frappe': frappe, 'frappe.utils': utils}):
        spec = importlib.util.spec_from_file_location('support_counts_under_test', ROOT / 'hrms/api/cross_department_support.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        yield module, frappe


def record(reference='REQ-1', when='2026-10-01', employee='EMP-1', status=1):
    return dict(source_reference=reference, support_date=when, employee=employee, docstatus=status)


class SupportCountTests(unittest.TestCase):
    def test_month_total_employee_identity_and_invalid_states(self):
        with load_api() as (api, _):
            rows = [record(), record('REQ-2', '2026-09-30'), record('REQ-3', status=0),
                    record('REQ-4', status=2), record(employee='EMP-2'), record(''), record(when=None)]
            result = api.summarize_support_records(rows, 'EMP-1', '2026-10')
            self.assertEqual((result['monthly_count'], result['total_count']), (1, 2))
            self.assertEqual(result['months'], [{'month':'2026-10','count':1}, {'month':'2026-09','count':1}])

    def test_duplicate_details_cross_month_and_order_independence(self):
        with load_api() as (api, _):
            rows = [record('REQ-1', '2026-10-02'), record(' REQ-1 ', '2026-09-30'), record('REQ-1', '2026-10-15')]
            result = api.summarize_support_records(rows, 'EMP-1', '2026-10')
            self.assertEqual((result['monthly_count'], result['total_count']), (0, 1))
            self.assertEqual(result, api.summarize_support_records(list(reversed(rows)), 'EMP-1', '2026-10'))

    def test_cancelled_old_version_does_not_shift_amendment_month(self):
        with load_api() as (api, _):
            result = api.summarize_support_records([record(when='2026-09-30', status=2), record()], 'EMP-1', '2026-10')
            self.assertEqual((result['monthly_count'], result['total_count']), (1, 1))

    def test_empty_history_and_month_validation(self):
        with load_api() as (api, _):
            self.assertEqual(api.get_employee_support_counts('EMP-1')['total_count'], 0)
            for month in ['2026-13', '2026-1', '2026-00', ['2026-10']]:
                with self.assertRaises(ValueError):
                    api.get_employee_support_counts('EMP-1', month)

    def test_employee_and_record_permissions_fail_before_read(self):
        with load_api() as (api, frappe):
            def forbidden(*args, **kwargs):
                raise PermissionError('employee denied')
            frappe.get_list = lambda *a, **kw: self.fail('must not query records')
            frappe.get_doc = lambda *a: SimpleNamespace(check_permission=forbidden)
            with self.assertRaises(PermissionError): api.get_employee_support_counts('EMP-1')
            frappe.get_doc = lambda *a: SimpleNamespace(check_permission=lambda _: None)
            frappe.has_permission = lambda *a: False
            with self.assertRaises(PermissionError): api.get_employee_support_counts('EMP-1')

    def test_permission_filtered_query_paginates_all_history(self):
        with load_api() as (api, frappe):
            calls = []
            def get_list(doctype, **kwargs):
                calls.append(kwargs)
                self.assertEqual(kwargs['filters'], {'employee':'EMP-1', 'docstatus':1})
                self.assertNotIn('ignore_permissions', kwargs)
                self.assertNotIn('support_date', kwargs['filters'])
                start = kwargs['limit_start']
                return [record(f'REQ-{i}') for i in range(start, min(start + 500, 501))]
            frappe.get_list = get_list
            self.assertEqual(api.get_employee_support_counts('EMP-1')['total_count'], 501)
            self.assertEqual([row['limit_start'] for row in calls], [0, 500])

    def test_missing_schema_is_not_zero_history(self):
        with load_api() as (api, frappe):
            frappe.db.exists = lambda *a: False
            frappe.get_list = lambda *a, **kw: self.fail('missing table must not be queried')
            result = api.get_employee_support_counts('EMP-1')
            self.assertFalse(result['available'])
            self.assertIsNone(result['total_count'])
            self.assertIn('迁移', result['message'])

    def test_overview_batch_scope_and_selected_date(self):
        import json
        with load_api() as (api, frappe):
            class Row(dict):
                __getattr__ = dict.get
            frappe.parse_json = json.loads
            frappe.has_permission = lambda *a, **kw: True
            seen = []
            def query(dt, **kw):
                seen.append((dt, kw))
                self.assertNotIn('ignore_permissions', kw)
                if dt == 'Cross Department Support Capability':
                    self.assertEqual(kw['filters']['name'], ['in', ['CAP-1']])
                    return [Row(name='CAP-1', employee='EMP-1')]
                if dt == api.DOCTYPE:
                    return [Row(record())]
                self.assertEqual(kw['filters']['from_date'], ['<=', '2026-10-30'])
                self.assertEqual(kw['filters']['to_date'], ['>=', '2026-10-30'])
                return [Row(employee='EMP-1', name='EX-1')]
            frappe.get_list = query
            result = api.get_support_overview('["CAP-1"]', '2026-10', '2026-10-30')
            self.assertEqual(result['rows']['EMP-1']['monthly_count'], 1)
            self.assertEqual(len(result['rows']['EMP-1']['exclusions']), 1)
            with self.assertRaises(ValueError): api.get_support_overview('{}')
            with self.assertRaises(ValueError): api.get_support_overview('["CAP-1"]', '2026-13')

    def test_exclusion_create_and_revoke_use_document_permissions(self):
        with load_api() as (api, frappe):
            inserted, saved = [], []
            class Doc:
                name = 'EX-1'
                employee = 'EMP-1'
                is_active = 1
                def check_permission(self, kind):
                    if kind == 'write': raise PermissionError('denied')
                def insert(self): inserted.append(self)
                def save(self): saved.append(self)
            frappe.get_doc = lambda *args: Doc()
            self.assertEqual(api.save_support_exclusion('CAP-1', '2026-10-30', '2026-10-31', 'leave')['name'], 'EX-1')
            self.assertEqual(len(inserted), 1)
            with self.assertRaises(PermissionError): api.revoke_support_exclusion('EX-1')
            self.assertEqual(saved, [])


class SupportRecordValidationTests(unittest.TestCase):
    def validate(self, **overrides):
        with load_api() as (_, frappe):
            frappe.get_doc = lambda *args: SimpleNamespace(company='Company A', employee_name='Same Name', check_permission=lambda value: None)
            frappe.db = SimpleNamespace(get_value=lambda *args: overrides.pop('department_company', 'Company A'))
            model = ModuleType('frappe.model')
            document = ModuleType('frappe.model.document')
            document.Document = object
            with patch.dict(sys.modules, {'frappe.model': model, 'frappe.model.document': document}):
                source = ROOT / 'hrms/hr/doctype/cross_department_support_record/cross_department_support_record.py'
                spec = importlib.util.spec_from_file_location('support_record_under_test', source)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                doc = module.CrossDepartmentSupportRecord()
                for key, value in dict(employee='EMP-1', source_reference=' REQ-1 ', support_date='2026-10-01', end_date=None, support_department='Dept A', company='forged company', **{}).items():
                    setattr(doc, key, value)
                for key, value in overrides.items(): setattr(doc, key, value)
                doc.validate()
                return doc

    def test_company_name_come_from_employee_and_reference_trimmed(self):
        doc = self.validate()
        self.assertEqual((doc.company, doc.employee_name, doc.source_reference), ('Company A', 'Same Name', 'REQ-1'))

    def test_missing_source_and_inverted_dates_rejected(self):
        with self.assertRaises(ValueError): self.validate(source_reference='  ')
        with self.assertRaises(ValueError): self.validate(end_date='2026-09-30')

    def test_department_in_other_company_rejected(self):
        with self.assertRaises(ValueError): self.validate(department_company='Company B')


if __name__ == '__main__':
    unittest.main()
