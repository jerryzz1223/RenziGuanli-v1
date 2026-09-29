"""Trial deferral keeps attendance facts while excluding a reviewed draft row."""

import json
from datetime import datetime
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from test_apple_tree_processor import processing_center_module


class RecordRow(dict):
    __getattr__ = dict.__getitem__


class TrialDeferralTest(TestCase):
    def setUp(self):
        self.api, _, _ = processing_center_module()
        self.batch = SimpleNamespace(name="draft-batch", source_type="attendance_draft")
        self.proposed = {"actual_attendance_hours": 160, "exception_lines": [
            {"attendance_date": "2026-08-11", "source_row": 1005, "exception_codes": ["CLOCK_IN_MISSING"]},
            {"attendance_date": "2026-08-12", "source_row": 1006, "exception_codes": ["CLOCK_OUT_MISSING"]},
        ]}
        self.doc = SimpleNamespace(
            proposed_value_json=json.dumps(self.proposed),
            confirmed_value_json="",
            processed_value_json=json.dumps({"actual_attendance_hours": 160, "source_sheet": "原始数据"}),
            review_history_json="[]",
            review_status="待审核",
            eligible_for_downstream=0,
        )
        self.doc.save = lambda **_kwargs: None

    def test_bulk_deferral_preserves_values_and_invalidates_final(self):
        api = self.api

        def records(_doctype, **kwargs):
            if kwargs["filters"] == {"name": ["in", ["row-1"]]}:
                return [RecordRow(name="row-1", import_batch="draft-batch", company="永新", source_type="attendance_draft",
                                  exception_codes='["CLOCK_IN_MISSING"]', review_status="待审核",
                                  proposed_value_json=self.doc.proposed_value_json, processed_value_json=self.doc.processed_value_json)]
            return [SimpleNamespace(review_status=self.doc.review_status, eligible_for_downstream=self.doc.eligible_for_downstream)]

        with (
            patch.object(api, "_require_processing_manager"),
            patch.object(api, "_require_company", side_effect=lambda value: value),
            patch.object(api, "_require_month", side_effect=lambda value: value),
            patch.object(api, "_require_processing_source_type", side_effect=lambda value: value),
            patch.object(api, "_latest_batch", return_value=self.batch),
            patch.object(api, "_attendance_shift_rule_bundle", return_value={"version": "rules-v1"}),
            patch.object(api.frappe, "get_all", side_effect=records),
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
                review_status="暂不计入", reason="试验阶段待核实",
            )

        self.assertEqual(result["deferred_rows"], 1)
        self.assertEqual(result["included_rows"], 0)
        self.assertEqual(self.doc.review_status, "暂不计入")
        self.assertEqual(self.doc.eligible_for_downstream, 0)
        self.assertEqual(json.loads(self.doc.confirmed_value_json), self.proposed)
        self.assertEqual(json.loads(self.doc.processed_value_json), {**self.proposed, "source_sheet": "原始数据"})
        self.assertEqual(json.loads(self.doc.review_history_json)[0]["reason"], "试验阶段待核实")
        invalidate.assert_called_once_with(self.batch, "bulk_manual_review_update")
        commit.assert_called_once_with()

    def test_select_all_uses_pending_dates_when_parent_status_and_codes_are_clear(self):
        api = self.api
        current = RecordRow(
            name="row-1", import_batch="draft-batch", company="永新", source_type="attendance_draft",
            employee_code="1223", employee_name="陆体廷", review_status="已通过", exception_codes="[]",
            proposed_value_json=self.doc.proposed_value_json, processed_value_json=self.doc.processed_value_json,
        )
        already_deferred = RecordRow({**current, "name": "row-2", "review_status": "暂不计入"})
        self.doc.review_status = "已通过"
        self.doc.eligible_for_downstream = 1

        def records(_doctype, **kwargs):
            if kwargs["fields"] == ["review_status", "eligible_for_downstream"]:
                return [SimpleNamespace(review_status=self.doc.review_status, eligible_for_downstream=self.doc.eligible_for_downstream)]
            if kwargs["filters"] == {"import_batch": "draft-batch"}:
                return [current, already_deferred]
            if kwargs["filters"] == {"name": ["in", ["row-1"]]}:
                return [current]
            raise AssertionError(kwargs)

        with (
            patch.object(api, "_require_processing_manager"),
            patch.object(api, "_require_company", side_effect=lambda value: value),
            patch.object(api, "_require_month", side_effect=lambda value: value),
            patch.object(api, "_require_processing_source_type", side_effect=lambda value: value),
            patch.object(api, "_latest_batch", return_value=self.batch),
            patch.object(api, "_attendance_shift_rule_bundle", return_value={"version": "rules-v1"}),
            patch.object(api.frappe, "get_all", side_effect=records),
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
                review_status="暂不计入", reason="试验阶段待核实",
                employee_code="12", employee_name="陆",
            )
        self.assertEqual(result["updated_rows"], 1)
        self.assertEqual(result["updated_exception_lines"], 2)
        self.assertEqual(self.doc.review_status, "暂不计入")
        self.assertEqual(self.doc.eligible_for_downstream, 0)

    def test_deferral_is_limited_to_attendance_draft(self):
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
