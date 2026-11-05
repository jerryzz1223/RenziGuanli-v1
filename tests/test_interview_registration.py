"""Register business rules and permission/query boundaries without a live site."""
from contextlib import contextmanager
from datetime import date
import importlib.util
import inspect
from functools import wraps
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import patch
import unittest

ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def modules():
    frappe = ModuleType("frappe")
    def whitelist():
        def decorate(fn):
            @wraps(fn)
            def checked(*args, **kwargs):
                # The installed Frappe enforces annotations before entering an API method.
                for param in inspect.signature(fn).parameters.values():
                    if param.annotation is inspect.Parameter.empty:
                        raise TypeError(f"Missing API type annotation: {param.name}")
                return fn(*args, **kwargs)
            return checked
        return decorate
    frappe.whitelist = whitelist
    frappe.PermissionError = PermissionError
    frappe.throw = lambda message, error=ValueError: (_ for _ in ()).throw(error(message))
    frappe.has_permission = lambda *args: True
    frappe.get_list = lambda *args, **kwargs: []
    schema = __import__("json").loads((ROOT / "hrms/hr/doctype/interview_registration/interview_registration.json").read_text())
    frappe.get_meta = lambda _: SimpleNamespace(fields=[SimpleNamespace(**f) for f in schema["fields"]])
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

    def test_historical_outcomes_and_notes_are_preserved(self):
        with modules() as (_, load):
            record = self.record(load, hired="否", arrival_status="未报到", no_show_reason="原表备注",
                                 expected_start_date="2026-10-01")
            record.validate()
            self.assertEqual(record.no_show_reason, "原表备注")
            self.assertEqual(record.hired, "否")

    def test_invalid_values(self):
        with modules() as (_, load):
            for values in ({"age": -1}, {"age": 121}, {"age": 18.5}, {"candidate_name": " "}):
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

    def test_import_preview_deduplication_and_fingerprint(self):
        from test_interview_register_importer import workbook
        row = dict(candidate_name="测试人员", phone="13900000000", interview_date="2026-03-27",
                   interview_position="检验员", hired="否", education="专科")
        with modules() as (frappe, load):
            api = load("hrms/api/interview_registration.py")
            parser = load("hrms/hr/interview_register_importer.py")
            inserted = []
            class Doc:
                def __init__(self, values): self.values = values
                def check_permission(self, action): pass
                def run_method(self, method): pass
                def insert(self): inserted.append(self.values)
            file = SimpleNamespace(is_private=1, file_name="test.xlsx", get_content=lambda: workbook([row, row]),
                                   check_permission=lambda _: None)
            frappe.db = SimpleNamespace(get_value=lambda *a: "file", exists=lambda *a: False)
            frappe.get_doc = lambda *args: Doc(args[0]) if isinstance(args[0], dict) else file if args[0] == "File" else SimpleNamespace(check_permission=lambda _: None)
            with patch.dict(sys.modules, {"hrms.hr.interview_register_importer": parser}):
                preview = api.preview_import("/private/files/test.xlsx", "Company A")
                self.assertEqual((preview["total"], preview["pending"], preview["skipped"]), (2, 1, 1))
                self.assertEqual(inserted, [])
                with self.assertRaises(ValueError):
                    api.import_registrations("/private/files/test.xlsx", "Company B", preview["fingerprint"])
                self.assertEqual(inserted, [])
                result = api.import_registrations("/private/files/test.xlsx", "Company A", preview["fingerprint"])
                self.assertEqual(result, {"imported": 1, "skipped": 1})
                self.assertEqual(inserted[0]["source_row"], 4)
                frappe.db.exists = lambda *a: True
                self.assertEqual(api.preview_import("/private/files/test.xlsx", "Company A")["pending"], 0)
                # The installed site's Select metadata can differ from the local JSON.
                frappe.db.exists = lambda *a: False
                frappe.get_meta = lambda _: SimpleNamespace(fields=[SimpleNamespace(
                    fieldname="education", fieldtype="Select", options="\n小学\n初中\n大专\n本科")])
                invalid = api.preview_import("/private/files/test.xlsx", "Company A")
                self.assertEqual(len(invalid["errors"]), 2)
                self.assertEqual(invalid["total"], 2)
                with self.assertRaises(ValueError):
                    api.import_registrations("/private/files/test.xlsx", "Company A", invalid["fingerprint"])
                self.assertEqual(len(inserted), 1)
                edits = [{"row": n, "field": "education", "value": "大专"} for n in (4, 5)]
                fixed = api.preview_import("/private/files/test.xlsx", "Company A", edits)
                self.assertEqual(fixed["errors"], [])
                self.assertEqual((fixed["pending"], fixed["skipped"]), (1, 1))
                with self.assertRaises(ValueError):
                    api.import_registrations("/private/files/test.xlsx", "Company A", fixed["fingerprint"], [])
                self.assertEqual(len(inserted), 1)
                api.import_registrations("/private/files/test.xlsx", "Company A", fixed["fingerprint"],
                                         __import__("json").dumps(edits))
                self.assertEqual(inserted[-1]["education"], "大专")
                self.assertEqual(len(inserted), 2)
                file.is_private = 0
                with self.assertRaises(ValueError): api.preview_import("/files/test.xlsx", "Company A")

    def test_forbidden_import_never_reads_file(self):
        with modules() as (frappe, load):
            api = load("hrms/api/interview_registration.py")
            frappe.has_permission = lambda *args: False
            frappe.get_doc = lambda *args: self.fail("must not read company or file")
            with self.assertRaises(PermissionError): api.preview_import("file", "Company A")


if __name__ == "__main__":
    unittest.main()
