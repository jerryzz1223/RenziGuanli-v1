"""Dispatch uses permitted qualifications, checks date exclusions and submits once."""
from datetime import date
from types import SimpleNamespace
import unittest

from test_cross_department_support_counts import load_api


class Doc(SimpleNamespace):
    def check_permission(self, kind):
        if kind in getattr(self, 'denied', []): raise PermissionError(kind)
    def insert(self):
        self.name = 'NEW-' + self.doctype
        self.saved.append(self)
        return self
    def submit(self):
        self.docstatus = 1
        self.submitted.append(self)


class DispatchTests(unittest.TestCase):
    def run_dispatch(self, *, add=False, qualified=True, excluded=False, submit=True, retry=False,
                     invalid=False, end='2026-10-31'):
        with load_api() as (api, frappe):
            saved, submitted = [], []
            source = Doc(employee='EMP-1', employee_name='Employee')
            old = Doc(name='EXISTING', docstatus=1)
            frappe.utils = SimpleNamespace(cint=int)
            frappe.has_permission = lambda dt, kind: submit or kind != 'submit'
            frappe.db.sql = lambda *a: None
            frappe.db.get_value = lambda *a: 'EXISTING' if retry else None
            def get_doc(dt, name=None):
                if isinstance(dt, dict): return Doc(**dt, saved=saved, submitted=submitted)
                return old if name == 'EXISTING' else source
            frappe.get_doc = get_doc
            q = Doc(name='CAP-1', support_department='Dept', support_designation='Job', is_active=1,
                    qualification_status='暂停' if invalid else '有效', valid_from=None, valid_until=None)
            calls = []
            def rows(dt, filters, fields):
                calls.append((dt, filters))
                if dt == api.EXCLUSION:
                    self.assertEqual(filters['from_date'], ['<=', date.fromisoformat(end)])
                    self.assertEqual(filters['to_date'], ['>=', date(2026,10,30)])
                    return [Doc(name='EX-1')] if excluded else []
                return [q] if qualified else []
            api.visible_rows = rows
            result = api.dispatch_employee_support('CAP-1', 'Dept', 'Job', '2026-10-30', end,
                                                   'test-dispatch-request-123', add_new=int(add))
            return result, saved, submitted, calls

    def test_existing_qualification_creates_submitted_record_with_job_snapshot(self):
        result, saved, submitted, _ = self.run_dispatch()
        self.assertEqual(len(saved), 1)
        self.assertEqual(len(submitted), 1)
        self.assertEqual(saved[0].support_designation, 'Job')
        self.assertEqual(saved[0].capability, 'CAP-1')
        self.assertEqual(saved[0].source_reference, 'DISPATCH-test-dispatch-request-123')
        self.assertEqual(saved[0].docstatus, 1)
        self.assertFalse(result['already_created'])

    def test_new_job_retained_as_active_qualification_before_dispatch(self):
        _, saved, submitted, _ = self.run_dispatch(add=True, qualified=False)
        self.assertEqual(len(saved), 2)
        qualification, record = saved
        self.assertEqual(qualification.employee, 'EMP-1')
        self.assertEqual((qualification.support_designation, qualification.qualification_status, qualification.is_active), ('Job', '有效', 1))
        self.assertEqual(record.capability, qualification.name)
        self.assertEqual(len(submitted), 1)

    def test_unknown_job_requires_explicit_add_new_choice(self):
        with self.assertRaises(ValueError): self.run_dispatch(qualified=False)

    def test_paused_qualification_cannot_be_reactivated_by_add_new(self):
        with self.assertRaises(ValueError): self.run_dispatch(add=True, invalid=True)

    def test_date_overlap_and_inverted_range_block_dispatch(self):
        with self.assertRaises(ValueError): self.run_dispatch(excluded=True)
        with self.assertRaises(ValueError): self.run_dispatch(end='2026-10-29')

    def test_submit_permission_required(self):
        with self.assertRaises(PermissionError): self.run_dispatch(submit=False)

    def test_same_request_returns_existing_record_without_writes(self):
        result, saved, submitted, calls = self.run_dispatch(retry=True)
        self.assertTrue(result['already_created'])
        self.assertEqual(saved, [])
        self.assertEqual(submitted, [])
        self.assertEqual(calls, [])


if __name__ == '__main__': unittest.main()
