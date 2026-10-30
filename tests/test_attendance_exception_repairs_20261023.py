"""Regression coverage for 2026-10-23 attendance exception repairs."""
import ast
import copy
import unittest
from pathlib import Path
from unittest.mock import patch
from test_attendance_daily_exception_resolution import load_processing_center


class AttendanceExceptionRepairTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.api = load_processing_center()

    def record(self, codes):
        daily = {"source_row": 10, "source_file": "test.xlsx", "source_sheet": "daily",
                 "attendance_date": "2026-10-01", "standard_hours": 8,
                 "actual_attendance_hours": 8, "workday_overtime_hours": 2,
                 "personal_leave_hours": 1, "deep_night_shifts": 1}
        values = {**daily, "attendance_details": [daily],
                  "exception_lines": [{**daily, "exception_codes": codes}]}
        return {"source_type": "attendance_draft", "attendance_month": "2026-10",
                "review_status": "待审核", "exception_codes": codes, "processed_value": values}

    def test_overtime_warning_preserves_base_and_night_facts_without_mutation(self):
        api = self.api
        for code in api.WORKDAY_OVERTIME_ONLY_EXCEPTIONS:
            with self.subTest(code=code):
                row = self.record([code]); before = copy.deepcopy(row)
                result = api._attendance_downstream_values(row, exclude_pending_dates=True)
                self.assertEqual(result["standard_hours"], 8)
                self.assertEqual(result["actual_attendance_hours"], 8)
                self.assertEqual(result["personal_leave_hours"], 1)
                self.assertEqual(result["deep_night_shifts"], 1)
                self.assertEqual(result["workday_overtime_hours"], 0)
                self.assertEqual(result["attendance_details"][0]["workday_overtime_hours"], 0)
                self.assertEqual(row, before)
                self.assertEqual(len(api._pending_attendance_daily_keys(row)), 1)

    def test_mixed_and_unknown_exceptions_keep_strict_exclusion(self):
        for codes in (["WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", "ATTENDANCE_HOURS_MISMATCH"],
                      ["CLOCK_IN_MISSING"], ["UNKNOWN_NEW_EXCEPTION"]):
            with self.subTest(codes=codes):
                result = self.api._attendance_downstream_values(self.record(codes), exclude_pending_dates=True)
                self.assertEqual(result["actual_attendance_hours"], 0)
                self.assertEqual(result["standard_hours"], 8)

    def test_explicit_exclusion_wins_over_overtime_separation(self):
        row = self.record(["WORKDAY_OUTSIDE_SHIFT_UNAPPROVED"])
        row["processed_value"]["_excluded_attendance_daily_keys"] = [self.api._daily_line_key(row["processed_value"]["attendance_details"][0])]
        result = self.api._attendance_downstream_values(row, exclude_pending_dates=True)
        self.assertEqual(result["actual_attendance_hours"], 0)

    def test_deep_night_zero_overlay_is_available_and_processed(self):
        api = self.api
        source = {"工号": "E1", "姓名": "TEST", "日期": "2026-10-01", "班次": "生产夜班20:00-次日08:00", "source_row": 10}
        row = {"original_value": {"rows": [source]}, "processed_value": {}}
        field = next(f for f in api._daily_row_editor_payload(row)[0]["editable_fields"] if f["default_name"] == "深夜班")
        self.assertTrue(field["late_editor"])
        source[field["fieldname"]] = 0
        processed = api.process_attendance_draft_rows([source], attendance_month="2026-10")["processed_rows"][0]
        self.assertEqual(processed["proposed_value"]["deep_night_shifts"], 0)

    def test_daily_save_defers_export_and_reads_directory_once(self):
        source = Path(self.api.__file__).read_text()
        tree = ast.parse(source)
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "update_attendance_draft_daily_row")
        calls = [n.func.id for n in ast.walk(function) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
        self.assertNotIn("_export_processed_result", calls)
        self.assertEqual(calls.count("_employee_directory"), 1)
        self.assertIn("_invalidate_monthly_final_after_source_change", calls)
        download = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "export_processing_result")
        self.assertTrue(any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "_export_processed_result" for n in ast.walk(download)))


if __name__ == "__main__":
    unittest.main()
