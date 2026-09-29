"""A reviewed exclusion keeps attendance facts out of downstream results."""

import json
from datetime import datetime
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from test_apple_tree_processor import processing_center_module


class RecordRow(dict):
    __getattr__ = dict.__getitem__


class AttendanceExclusionTest(TestCase):
    def setUp(self):
        self.api, _, _ = processing_center_module()
        self.batch = SimpleNamespace(name="draft-batch", company="永新", source_type="attendance_draft")
        self.proposed = {
            "actual_attendance_hours": 24, "standard_hours": 24,
            "attendance_details": [
                {"attendance_date": "2026-08-11", "source_row": 1005, "actual_attendance_hours": 8, "standard_hours": 8},
                {"attendance_date": "2026-08-12", "source_row": 1006, "actual_attendance_hours": 8, "standard_hours": 8},
                {"attendance_date": "2026-08-13", "source_row": 1007, "actual_attendance_hours": 8, "standard_hours": 8},
            ],
            "exception_lines": [
                {"attendance_date": "2026-08-11", "source_row": 1005, "exception_codes": ["CLOCK_IN_MISSING"]},
                {"attendance_date": "2026-08-12", "source_row": 1006, "exception_codes": ["CLOCK_OUT_MISSING"]},
            ],
        }
        self.doc = SimpleNamespace(
            proposed_value_json=json.dumps(self.proposed),
            confirmed_value_json="",
            processed_value_json=json.dumps(self.proposed),
            review_history_json="[]",
            review_status="待审核",
            exception_codes='["CLOCK_IN_MISSING", "CLOCK_OUT_MISSING"]',
            eligible_for_downstream=0,
        )
        self.doc.save = lambda **_kwargs: None

    def test_selected_date_exclusion_preserves_other_dates_and_audit(self):
        api = self.api
        self.doc.as_dict = lambda: {
            "name": "row-1", "company": "永新", "attendance_month": "2026-08", "source_type": "attendance_draft",
            "employee_code": "1223", "employee_name": "陆体廷", "review_status": self.doc.review_status,
            "eligible_for_downstream": self.doc.eligible_for_downstream, "processed_value_json": self.doc.processed_value_json,
            "proposed_value_json": self.doc.proposed_value_json, "confirmed_value_json": self.doc.confirmed_value_json,
            "original_value_json": "{}", "review_history_json": self.doc.review_history_json,
            "exception_codes": '["CLOCK_IN_MISSING", "CLOCK_OUT_MISSING"]',
        }
        index = RecordRow(self.doc.as_dict())
        index["import_batch"] = "draft-batch"

        with (
            patch.object(api, "_require_processing_manager"),
            patch.object(api, "_require_company", side_effect=lambda value: value),
            patch.object(api, "_require_month", side_effect=lambda value: value),
            patch.object(api, "_require_processing_source_type", side_effect=lambda value: value),
            patch.object(api, "_latest_batch", return_value=self.batch),
            patch.object(api, "_attendance_shift_rule_bundle", return_value={"version": "rules-v1"}),
            patch.object(api.frappe, "get_all", return_value=[index]),
            patch.object(api.frappe, "get_doc", return_value=self.doc, create=True),
            patch.object(api, "now_datetime", return_value=datetime(2026, 9, 29, 10, 0)),
            patch.object(api, "_refresh_batch_review_status", return_value="待确认"),
            patch.object(api, "_export_processed_result", return_value={}),
            patch.object(api, "_save_batch_notes"),
            patch.object(api, "_invalidate_monthly_final_after_source_change") as invalidate,
            patch.object(api.frappe.db, "commit", create=True) as commit,
        ):
            result = api.bulk_update_processing_records(
                "永新", "2026-08", "attendance_draft", '["row-1"]',
                review_status="暂不计入", reason="仅排除当天",
                daily_record_ids=json.dumps([{"record_id": "row-1", "daily_record_id": api._daily_line_key(self.proposed["exception_lines"][0])}]),
            )

            self.assertEqual(result["updated_exception_lines"], 1)
            self.assertEqual(self.doc.review_status, "待审核")
            self.assertEqual(self.doc.eligible_for_downstream, 0)
            self.assertEqual(json.loads(self.doc.confirmed_value_json)["_excluded_attendance_daily_keys"], [api._daily_line_key(self.proposed["exception_lines"][0])])
            second = api.bulk_update_processing_records(
                "永新", "2026-08", "attendance_draft", '["row-1"]',
                review_status="暂不计入", reason="仅排除第二天",
                daily_record_ids=json.dumps([{"record_id": "row-1", "daily_record_id": api._daily_line_key(self.proposed["exception_lines"][1])}]),
            )

        self.assertEqual(second["updated_exception_lines"], 1)
        self.assertEqual(self.doc.review_status, "已通过")
        self.assertEqual(self.doc.eligible_for_downstream, 1)
        self.assertEqual(api._attendance_downstream_values({"source_type": "attendance_draft", "attendance_month": "2026-08", "review_status": self.doc.review_status, "processed_value": json.loads(self.doc.processed_value_json), "proposed_value": self.proposed, "confirmed_value": json.loads(self.doc.confirmed_value_json)})["actual_attendance_hours"], 8)
        self.assertEqual(json.loads(self.doc.review_history_json)[0]["attendance_date"], "2026-08-11")
        self.assertEqual(invalidate.call_count, 2)
        self.assertEqual(commit.call_count, 2)

    def test_legacy_all_selected_dates_keep_other_days_in_downstream(self):
        api = self.api
        row = {"source_type": "attendance_draft", "attendance_month": "2026-08", "review_status": "暂不计入",
               "eligible_for_downstream": 0, "exception_codes": ["CLOCK_IN_MISSING", "CLOCK_OUT_MISSING"],
               "proposed_value": self.proposed, "processed_value": self.proposed, "confirmed_value": None}
        self.assertTrue(api._attendance_row_has_downstream_dates(row))
        projected = api._attendance_downstream_values(row)
        self.assertEqual(projected["actual_attendance_hours"], 8)
        self.assertEqual([item["attendance_date"] for item in projected["attendance_details"]], ["2026-08-13"])
        self.assertEqual(self.proposed["actual_attendance_hours"], 24)

    def test_select_all_excludes_each_pending_date_across_employee_record(self):
        api = self.api
        self.doc.exception_codes = '["CLOCK_IN_MISSING", "CLOCK_OUT_MISSING"]'
        self.doc.as_dict = lambda: {
            "name": "row-1", "company": "永新", "attendance_month": "2026-08", "source_type": "attendance_draft",
            "employee_code": "1223", "employee_name": "陆体廷", "review_status": self.doc.review_status,
            "eligible_for_downstream": self.doc.eligible_for_downstream, "processed_value_json": self.doc.processed_value_json,
            "proposed_value_json": self.doc.proposed_value_json, "confirmed_value_json": self.doc.confirmed_value_json,
            "original_value_json": "{}", "review_history_json": self.doc.review_history_json,
            "exception_codes": self.doc.exception_codes,
        }
        index = RecordRow(self.doc.as_dict())
        with (
            patch.object(api, "_require_processing_manager"),
            patch.object(api, "_require_company", side_effect=lambda value: value),
            patch.object(api, "_require_month", side_effect=lambda value: value),
            patch.object(api, "_require_processing_source_type", side_effect=lambda value: value),
            patch.object(api, "_latest_batch", return_value=self.batch),
            patch.object(api, "_attendance_shift_rule_bundle", return_value={"version": "rules-v1"}),
            patch.object(api.frappe, "get_all", return_value=[index]),
            patch.object(api.frappe, "get_doc", return_value=self.doc, create=True),
            patch.object(api, "now_datetime", return_value=datetime(2026, 9, 29, 10, 0)),
            patch.object(api, "_refresh_batch_review_status", return_value="待确认"),
            patch.object(api, "_export_processed_result", return_value={}),
            patch.object(api, "_save_batch_notes"),
            patch.object(api, "_invalidate_monthly_final_after_source_change"),
            patch.object(api.frappe.db, "commit", create=True),
        ):
            result = api.bulk_update_processing_records(
                "永新", "2026-08", "attendance_draft", "[]", select_all_pending=1,
                review_status="暂不计入", reason="本月全部异常日期不计入",
                employee_code="12", employee_name="陆",
            )
        self.assertEqual(result["updated_exception_lines"], 2)
        self.assertEqual(self.doc.eligible_for_downstream, 1)
        self.assertEqual(api._attendance_downstream_values({"source_type": "attendance_draft", "attendance_month": "2026-08", "review_status": self.doc.review_status, "processed_value": json.loads(self.doc.processed_value_json), "proposed_value": self.proposed, "confirmed_value": json.loads(self.doc.confirmed_value_json)})["actual_attendance_hours"], 8)

    def test_legacy_exclusion_alias_is_limited_to_attendance_draft(self):
        api = self.api
        api.frappe.throw = lambda message: (_ for _ in ()).throw(ValueError(message))
        with (
            patch.object(api, "_require_processing_manager"),
            patch.object(api, "_require_company", side_effect=lambda value: value),
            patch.object(api, "_require_month", side_effect=lambda value: value),
            patch.object(api, "_require_processing_source_type", side_effect=lambda value: value),
        ):
            with self.assertRaisesRegex(ValueError, "处理结果无效"):
                api.bulk_update_processing_records(
                    "永新", "2026-08", "apple_tree", '["row-1"]',
                    review_status="暂不计入", reason="试验阶段待核实",
                )

    def test_deferred_daily_exception_remains_visible_without_pending_count(self):
        record = {
            "name": "row-1", "source_type": "attendance_draft", "company": "永新",
            "review_status": "暂不计入", "exception_codes": '["CLOCK_IN_MISSING"]',
            "proposed_value_json": json.dumps({"attendance_details": []}),
            "processed_value_json": "{}", "original_value_json": "{}",
            "confirmed_value_json": "", "review_history_json": "[]",
        }
        line = {"attendance_date": "2026-08-01", "exception_codes": ["CLOCK_IN_MISSING"]}
        with patch.object(self.api, "_active_attendance_exception_lines", return_value=[line]):
            result = self.api._serialize_record(record, "rules-v1", hydrate_daily_details=False)
        self.assertEqual(result["daily_pending_exception_lines"], [])
        self.assertEqual(result["daily_exception_lines"][0]["review_status"], "暂不计入")
        self.assertTrue(result["daily_exception_lines"][0]["resolved"])

    def test_rejected_draft_line_is_history_not_pending_work(self):
        record = {
            "name": "row-1", "source_type": "attendance_draft", "company": "永新",
            "review_status": "已驳回", "exception_codes": '["CLOCK_IN_MISSING"]',
            "proposed_value_json": json.dumps({"attendance_details": []}),
            "processed_value_json": "{}", "original_value_json": "{}",
            "confirmed_value_json": "", "review_history_json": "[]",
        }
        line = {"attendance_date": "2026-08-01", "exception_codes": ["CLOCK_IN_MISSING"]}
        with patch.object(self.api, "_active_attendance_exception_lines", return_value=[line]):
            result = self.api._serialize_record(record, "rules-v1", hydrate_daily_details=False)
        self.assertEqual(result["daily_pending_exception_lines"], [])
        self.assertEqual(result["daily_exception_lines"][0]["review_status"], "已驳回")
        self.assertTrue(result["daily_exception_lines"][0]["resolved"])

    def test_overview_pending_count_excludes_deferred_and_rejected_dates(self):
        line = {"attendance_date": "2026-08-11", "exception_codes": ["CLOCK_IN_MISSING"]}
        rows = [
            {"review_status": status, "processed_value_json": "{}", "proposed_value_json": json.dumps({"exception_lines": [line]}),
             "confirmed_value_json": "", "exception_codes": '["CLOCK_IN_MISSING"]'}
            for status in ("待审核", "暂不计入", "已驳回")
        ]
        with patch.object(self.api.frappe, "get_all", return_value=rows):
            self.assertEqual(self.api._pending_attendance_exception_line_count(self.batch), 1)

    def test_policy_recheck_preserves_trial_exclusion(self):
        replacement = {
            "employee_code": "260813", "exception_codes": ["CLOCK_IN_MISSING"],
            "proposed_value": {"actual_attendance_hours": 160},
        }
        record = {
            "employee_code": "260813", "review_status": "暂不计入",
            "review_history": [{"field_name": "__review_decision__"}],
        }
        with (
            patch.object(self.api, "_effective_result_values", return_value={"actual_attendance_hours": 160}),
            patch.object(self.api, "_effective_daily_source_rows", return_value=[{"工号": "260813"}]),
            patch.object(self.api, "process_attendance_draft_rows", return_value={"processed_rows": [replacement]}),
            patch.object(self.api, "_daily_exception_decisions", return_value={}),
            patch.object(self.api, "_apply_daily_exception_decisions", side_effect=lambda row, _decisions: row),
        ):
            refreshed, reason = self.api._attendance_policy_replacement(
                record, attendance_month="2026-08", employee_directory=None,
                exception_policy=None,
            )
        self.assertEqual(reason, "")
        self.assertEqual(refreshed["review_status"], "暂不计入")
        self.assertFalse(refreshed["eligible_for_downstream"])
