"""Register business rules and permission/query boundaries without a live site."""
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
def modules():
    frappe = ModuleType("frappe")
    frappe.whitelist = lambda: lambda fn: fn
    frappe.PermissionError = PermissionError
    frappe.throw = lambda message, error=ValueError: (_ for _ in ()).throw(error(message))
    frappe.has_permission = lambda *args: True
    frappe.get_list = lambda *args, **kwargs: []
    frappe.get_doc = lambda *args: SimpleNamespace(check_permission=lambda _: None)
    utils = ModuleType("frappe.utils")
    utils.cint = lambda value: int(value or 0)
    utils.getdate = lambda value: date.fromisoformat(str(value))
    model = ModuleType("frappe.model.document")
    model.Document = object
    with patch.dict(sys.modules, {"frappe": frappe, "frappe.utils": utils, "frappe.model.document": model}):
        def load(path):
            spec = importlib.util.spec_from_file_location("register_under_test", ROOT / path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
        yield frappe, load


class InterviewRegistrationTests(unittest.TestCase):
    def record(self, load, **values):
        cls = load("hrms/hr/doctype/interview_registration/interview_registration.py").InterviewRegistration
        record = cls()
        record.__dict__.update(candidate_name=" 示例人员 ", interview_date="2026-10-28", age=28,
                               expected_start_date=None, hired="", arrival_status="", no_show_reason="")
        record.__dict__.update(values)
        return record

    def test_month_derived_and_pending_result_preserved(self):
        with modules() as (_, load):
            record = self.record(load, registration_month="wrong")
            record.validate()
            self.assertEqual(record.registration_month, "2026-10")
            self.assertEqual(record.candidate_name, "示例人员")
            self.assertEqual(record.hired, "")

    def test_arrival_requires_hiring_and_no_show_reason(self):
        with modules() as (_, load):
            for status in ("已报到", "未报到"):
                with self.assertRaises(ValueError): self.record(load, arrival_status=status).validate()
            with self.assertRaises(ValueError): self.record(load, hired="是", arrival_status="未报到").validate()
            record = self.record(load, hired="是", arrival_status="未报到", no_show_reason="个人原因")
            record.validate()
            self.assertEqual(record.no_show_reason, "个人原因")
            record.arrival_status = "已报到"
            record.validate()
            self.assertEqual(record.no_show_reason, "")

    def test_invalid_values(self):
        with modules() as (_, load):
            for values in ({"age": -1}, {"age": 121}, {"age": 18.5}, {"candidate_name": " "}, {"expected_start_date": "2026-10-01"}):
                with self.assertRaises(ValueError): self.record(load, **values).validate()

    def test_forbidden_read_never_queries(self):
        with modules() as (frappe, load):
            api = load("hrms/api/interview_registration.py")
            frappe.has_permission = lambda *args: False
            frappe.get_list = lambda *a, **kw: self.fail("forbidden query")
            with self.assertRaises(PermissionError): api.get_registrations()

    def test_filters_pagination_and_read_only_role(self):
        with modules() as (frappe, load):
            api = load("hrms/api/interview_registration.py")
            calls = []
            def query(doctype, **kwargs):
                calls.append((doctype, kwargs))
                return [{"name": str(i)} for i in range(51)]
            frappe.get_list = query
            frappe.has_permission = lambda dt, action: action == "read"
            result = api.get_registrations(company="A", month="2026-10", search="示例", hired="是", arrival_status="待报到", start=50)
            self.assertEqual(len(result["rows"]), 50)
            self.assertTrue(result["has_more"])
            self.assertFalse(result["can_create"])
            dt, query = calls[0]
            self.assertEqual(dt, "Interview Registration")
            self.assertEqual(query["filters"], {"company":"A", "registration_month":"2026-10", "hired":"是", "arrival_status":"待报到"})
            self.assertEqual(query["limit_start"], 50)
            self.assertEqual(query["or_filters"]["phone"], ["like", "%示例%"])
            self.assertNotIn("ignore_permissions", query)

    def test_invalid_query_and_company_permission(self):
        with modules() as (frappe, load):
            api = load("hrms/api/interview_registration.py")
            for values in ({"month":"2026-13"}, {"month":"26-10"}, {"hired":"maybe"}, {"arrival_status":"unknown"}):
                with self.assertRaises(ValueError): api.get_registrations(**values)
            def denied(_): raise PermissionError()
            frappe.get_doc = lambda *args: SimpleNamespace(check_permission=denied)
            with self.assertRaises(PermissionError): api.get_registrations(company="forbidden")


if __name__ == "__main__":
    unittest.main()
