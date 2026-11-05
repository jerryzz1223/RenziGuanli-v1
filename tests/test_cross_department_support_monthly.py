"""Monthly totals replace a month's legacy count, and saves update under permissions."""
import unittest
from types import SimpleNamespace
from test_cross_department_support_counts import load_api, record


class MonthlyTests(unittest.TestCase):
    def test_override_zero_and_total_preserve_other_months(self):
        with load_api() as (api, _):
            legacy = api.summarize_support_records([record(), record('OLD', '2026-09-01')], 'EMP-1', '2026-10')
            result = api.merge_monthly_counts(legacy, [dict(employee='EMP-1', month='2026-10', support_count=0),
                dict(employee='EMP-1', month='2026-11', support_count=5),
                dict(employee='EMP-2', month='2026-10', support_count=99)])
            self.assertEqual(result['monthly_count'], 0)
            self.assertEqual(result['total_count'], 6)
            self.assertEqual(result['months'][0], dict(month='2026-11', count=5))

    def test_validation_rejects_invalid_month_fraction_negative_and_bool(self):
        with load_api() as (api, _):
            for count in [-1, 1.2, True, None, '', '1e2', 2147483648]:
                with self.assertRaises(ValueError): api.validate_monthly_values('2026-11', count)
            for month in ['2026-13', [], '2026-1']:
                with self.assertRaises(ValueError): api.validate_monthly_values(month, 1)
            self.assertEqual(api.validate_monthly_values('2026-11', '0'), ('2026-11', 0))

    def save(self, existing=False, denied=False):
        with load_api() as (api, frappe):
            events = []
            frappe.db.exists = lambda *args: True
            frappe.db.sql = lambda *args: events.append('lock')
            frappe.db.get_value = lambda *args: 'MONTH-1' if existing else None
            class Doc(SimpleNamespace):
                def check_permission(self, kind):
                    events.append(kind)
                    if denied: raise PermissionError(kind)
                def save(self): events.append('save')
                def insert(self):
                    self.check_permission('create')
                    events.append('insert')
            month_doc = Doc(name='MONTH-1', support_count=1)
            def get_doc(dt, name=None):
                if isinstance(dt, dict):
                    month_doc.__dict__.update(dt)
                    return month_doc
                return month_doc if dt == api.MONTHLY else SimpleNamespace(check_permission=lambda _: None)
            frappe.get_doc = get_doc
            api.save_monthly_support_count('EMP-1', '2026-11', 0)
            return month_doc, events

    def test_first_save_and_repeat_update_do_not_accumulate(self):
        doc, events = self.save()
        self.assertEqual(doc.support_count, 0)
        self.assertEqual(events, ['lock', 'create', 'insert'])
        doc, events = self.save(existing=True)
        self.assertEqual(doc.support_count, 0)
        self.assertEqual(events, ['lock', 'write', 'save'])

    def test_create_and_update_permissions(self):
        for existing in [False, True]:
            with self.assertRaises(PermissionError): self.save(existing=existing, denied=True)

    def test_monthly_only_storage_and_permission_scoped_read(self):
        with load_api() as (api, frappe):
            frappe.db.exists = lambda dt, name: name == api.MONTHLY
            seen = []
            def query(dt, **kw):
                seen.append((dt, kw))
                return [dict(employee='EMP-1', month='2026-11', support_count=7)]
            frappe.get_list = query
            result = api.get_employee_support_counts('EMP-1', '2026-11')
            self.assertEqual(result['monthly_count'], 7)
            self.assertTrue(result['can_edit'])
            self.assertEqual(seen[0][0], api.MONTHLY)
            self.assertEqual(seen[0][1]['filters'], {'employee': 'EMP-1'})
            frappe.has_permission = lambda *a: False
            with self.assertRaises(PermissionError): api.get_employee_support_counts('EMP-1', '2026-11')

    def test_year_summary_months_total_employee_scope_and_permissions(self):
        with load_api() as (api, frappe):
            frappe.db.exists = lambda *args: True
            frappe.get_doc = lambda dt, name: SimpleNamespace(employee_name=name, check_permission=lambda _: None)
            frappe.has_permission = lambda dt, kind, **kw: dt != 'Employee' or kw['doc'].employee_name != 'HIDDEN'
            def query(dt, **kw):
                self.assertEqual(dt, api.MONTHLY)
                self.assertEqual(kw['filters'], {'month': ['between', ['2026-01', '2026-12']], 'employee': 'EMP-1'})
                return [dict(employee='EMP-1', month='2026-01', support_count=2),
                        dict(employee='EMP-1', month='2026-12', support_count=3),
                        dict(employee='EMP-1', month='2026-02', support_count=0),
                        dict(employee='HIDDEN', month='2026-01', support_count=99)]
            frappe.get_list = query
            result = api.get_yearly_support_counts('2026', 'EMP-1')
            self.assertEqual(len(result['rows']), 1)
            row = result['rows'][0]
            self.assertEqual(row['total_count'], 5)
            self.assertEqual(row['months'], [2, 0] + [None] * 9 + [3])
            for year in ['26', '2026-01', '0000', None]:
                with self.assertRaises(ValueError): api.get_yearly_support_counts(year)
            frappe.has_permission = lambda *a, **kw: False
            with self.assertRaises(PermissionError): api.get_yearly_support_counts('2026')

    def test_monthly_read_uses_only_selected_month_no_legacy_records(self):
        with load_api() as (api, frappe):
            frappe.db.exists = lambda *args: True
            def query(dt, **kw):
                self.assertEqual(dt, api.MONTHLY)
                self.assertEqual(kw['filters'], {'employee': 'EMP-1', 'month': '2026-11'})
                return [dict(support_count=0)]
            frappe.get_list = query
            self.assertEqual(api.get_monthly_support_count('EMP-1', '2026-11')['monthly_count'], 0)


if __name__ == '__main__': unittest.main()
