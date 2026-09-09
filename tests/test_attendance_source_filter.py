"""Regression coverage for monthly approval filtering and versioned imports."""
from copy import deepcopy
import json
import sys
from datetime import datetime
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from test_apple_tree_processor import processing_center_module


class AttendanceSourceFilterTest(TestCase):
    def setUp(self):
        self.api, _, self.modules = processing_center_module()
        self.batch = SimpleNamespace(name="new", company="永新", attendance_month="2026-08", source_type="apple_tree", source_file="raw.xlsx")

    def test_business_date_not_creation_or_completion_month(self):
        for kind, field in (("apple_tree", "奖/惩日期"), ("missing_card", "补卡时间")):
            for value in ("2026-08-01", "2026-08-31 23:59:59", datetime(2026, 8, 15)):
                row = {field: value, "创建时间": "2026-09-01", "完成时间": "2026-09-02"}
                self.assertEqual(self.api._approval_source_exclusion(kind, "2026-08", row), "")
            for value in ("2026-07-31 23:59", "2026-09-01", "2025-08-01"):
                self.assertEqual(self.api._approval_source_exclusion(kind, "2026-08", {field: value}), "不属于处理月份")

    def test_invalid_dates_and_pending_approvals_remain_reviewable(self):
        for value in ("", "2026-02-30", "未知日期"):
            self.assertEqual(self.api._approval_source_exclusion("apple_tree", "2026-08", {"奖/惩日期": value}), "")
        self.assertEqual(self.api._approval_source_exclusion("apple_tree", "2026-08", {"奖/惩日期": "2026-08-01", "审批状态": "审批中"}), "")

    def test_excluded_source_keeps_immutable_row_and_trace(self):
        rows = [
            {"数据id": "rejected", "审批结果": "审批未通过", "_source_row": 2},
            {"数据id": "stopped", "审批状态": "审批终止", "_source_row": 3},
            {"数据id": "old", "奖/惩日期": "2026-07-31", "_source_row": 4},
            {"数据id": "pending", "奖/惩日期": "2026-08-01", "审批状态": "审批中", "_source_row": 5},
        ]
        original = deepcopy(rows)
        kept, excluded = self.api._filter_approval_source_rows(self.batch, rows)
        self.assertEqual(rows, original)
        self.assertEqual([r["数据id"] for r in kept], ["pending"])
        self.assertEqual([r["source_row"] for r in excluded], [2, 3, 4])
        self.assertTrue(all(r["source_file"] == "raw.xlsx" and r["reason"] for r in excluded))

    def test_reimport_removes_old_month_and_newly_rejected_approval_without_deleting_parent(self):
        parent = SimpleNamespace(name="old", company="永新", attendance_month="2026-08", source_type="apple_tree")
        def prior(key, day):
            return {"source_id": key, "source_file": "prior.xlsx", "original_value": {"奖/惩日期": day}, "eligible_for_downstream": True, "review_history": [{"reason": "原审核"}]}
        existing = [prior("july", "2026-07-31"), prior("changed", "2026-08-01"), prior("keep", "2026-08-02"), prior("replace", "2026-08-03")]
        before = deepcopy(existing)
        incoming = {"source_id": "replace", "exception_codes": [], "proposed_value": {"有效苹果数": 5}}
        result = {"processed_rows": [incoming], "excluded_source_records": [{"source_id": "changed", "reason": "审批终止"}], "metrics": {}}
        with patch.object(self.api, "_processing_meta", return_value={"merge_parent_batch": "old"}), patch.object(self.api.frappe.db, "exists", return_value=True, create=True), patch.object(self.api.frappe, "get_doc", return_value=parent, create=True), patch.object(self.api, "_result_rows", return_value=existing):
            merged = self.api._merge_processed_rows(self.batch, result)
        self.assertEqual(existing, before)
        self.assertEqual([r["source_id"] for r in merged["processed_rows"]], ["keep", "replace"])
        self.assertEqual(merged["merge"]["excluded_previous_rows"], 2)
        self.assertEqual(merged["merge"]["merged_rows"], 1)
        self.assertEqual(merged["processed_rows"][0]["review_history"], [{"reason": "原审核"}])

    def test_other_sources_are_not_filtered(self):
        self.assertEqual(self.api._approval_source_exclusion("attendance_draft", "2026-08", {"审批状态": "终止", "奖/惩日期": "2026-07-01"}), "")

    def test_large_exclusion_audit_is_a_private_attachment_with_bounded_metadata(self):
        entries = [{"source_id": f"id-{i}", "source_row": i + 2, "source_file": "原始文件.xlsx", "reason": "不属于处理月份"} for i in range(2000)]
        file_manager = self.modules["frappe.utils.file_manager"]
        with patch.dict(sys.modules, self.modules), patch.object(file_manager, "save_file", return_value=SimpleNamespace(file_url="/private/files/audit.json"), create=True) as save:
            summary = self.api._save_exclusion_audit(self.batch, {"excluded_source_records": entries})
        self.assertLess(len(json.dumps(summary)), 1000)
        self.assertEqual(summary["source_rows"], 2000)
        self.assertTrue(save.call_args.kwargs["is_private"])
        self.assertEqual(save.call_args.args[2:4], (self.api.IMPORT_BATCH_DOCTYPE, "new"))
        self.assertEqual(len(json.loads(save.call_args.args[1])["excluded_source_records"]), 2000)

    def test_default_result_request_includes_approvals_after_row_500(self):
        rows = [{"eligible_for_downstream": True, "processed_value": {"苹果类型": "绿苹果", "有效苹果数": 1}} for _ in range(601)]
        with patch.object(self.api, "_require_processing_manager"), patch.object(self.api, "_require_company", side_effect=lambda v:v), patch.object(self.api, "_require_month", side_effect=lambda v:v), patch.object(self.api, "_require_processing_source_type", side_effect=lambda v:v), patch.object(self.api, "_latest_batch", return_value=SimpleNamespace(name="batch", status="已确认")), patch.object(self.api, "_processing_meta", return_value={}), patch.object(self.api, "_result_rows", side_effect=lambda batch,limit:rows[:limit]):
            response = self.api.list_processing_results("永新", "2026-08", "apple_tree")
        self.assertEqual(len(response["processed_rows"]), 601)
        self.assertEqual(response["result_summary"]["green_apples"], 601)
