import ast
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
API_PATH = ROOT / "hrms" / "api" / "attendance_processing_center.py"
PAGE_PATH = ROOT / "hrms" / "hr" / "page" / "attendance_import_center" / "attendance_import_center.js"
ACCESS_PAGE_PATH = ROOT / "hrms" / "hr" / "page" / "hrms_access_center" / "hrms_access_center.js"


class AttendanceFinalApprovalWorkflowTests(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls.api_source = API_PATH.read_text(encoding="utf-8")
		cls.page_source = PAGE_PATH.read_text(encoding="utf-8")
		cls.access_page_source = ACCESS_PAGE_PATH.read_text(encoding="utf-8")
		cls.api_tree = ast.parse(cls.api_source)
		cls.functions = {
			node.name: ast.get_source_segment(cls.api_source, node) or ""
			for node in cls.api_tree.body
			if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
		}

	def test_submit_and_review_endpoints_are_separate(self):
		submit = self.functions["submit_monthly_final_for_approval"]
		review = self.functions["review_monthly_final_approval"]
		self.assertIn('_require_processing_manager("attendance_import_submit")', submit)
		self.assertIn('_require_processing_manager("attendance_final_approve")', review)
		self.assertNotIn('submitted_by") == frappe.session.user', review)
		self.assertNotIn("不能审批本人提交", review)

	def test_one_click_approval_submits_then_self_approves(self):
		one_click = self.functions["approve_monthly_final_in_one_click"]
		self.assertIn('_require_processing_manager("attendance_final_approve")', one_click)
		self.assertIn('_require_processing_manager("attendance_import_submit")', one_click)
		self.assertIn("submit_monthly_final_for_approval", one_click)
		self.assertIn('review_monthly_final_approval(company, attendance_month, "approve", note)', one_click)

	def test_lock_generation_requires_current_approved_snapshot(self):
		generate = self.functions["generate_monthly_final_files"]
		self.assertIn('_require_processing_manager("attendance_final_lock")', generate)
		self.assertIn("approved_for_current_snapshot", generate)
		self.assertIn("尚未审批通过，不能锁定生成", generate)

	def test_confirmed_monthly_sources_are_ready_with_separate_daily_review_pending(self):
		main_sources = ("attendance_draft", "apple_tree", "missing_card")
		support_sources = ("housing_allowance", "full_attendance", "special_hours")
		labels = {source: source for source in main_sources + support_sources}
		batch = types.SimpleNamespace(
			name="confirmed-batch", status="已确认", source_file="source.xlsx",
			imported_by="reviewer", imported_on="2026-09-29", creation="2026-09-29",
		)
		namespace = {
		"SOURCE_TYPES": main_sources,
		"FIRST_SIGNED_SOURCE_TYPES": ("attendance_draft", "missing_card"),
		"MONTHLY_SUPPORT_SOURCE_TYPES": support_sources,
		"SOURCE_LABELS": labels,
		"MONTHLY_SUPPORT_SOURCE_CONFIG": {source: {"description": ""} for source in support_sources},
		"PROCESSING_RECORD_DOCTYPE": "processing record",
		"_latest_batch": lambda *_args: batch,
		"_processing_meta": lambda *_args: {"monthly_support_precheck": {"record_count": 1}},
		"_result_rows": lambda *_args: [],
		"_user_display_name": lambda value: value,
		"_daily_month_workflow": lambda *_args: {"required": True, "ready": False},
		"frappe": types.SimpleNamespace(db=types.SimpleNamespace(count=lambda *_args: 1)),
		"cint": int,
		"Path": Path,
	}
		for name in ("_finalization_inputs", "_first_signed_inputs"):
			exec(self.functions[name], namespace)
		slots = [{"source_type": source, "status": "已确认"} for source in main_sources]
		final_inputs = namespace["_finalization_inputs"]("永新", "2026-08", slots)
		first_signed_inputs = namespace["_first_signed_inputs"]("永新", "2026-08", slots)
		self.assertEqual([item["source_type"] for item in final_inputs], list(main_sources + support_sources))
		self.assertTrue(all(item["ready"] for item in final_inputs))
		self.assertEqual([item["source_type"] for item in first_signed_inputs], list(("attendance_draft", "missing_card")))
		self.assertTrue(all(item["ready"] for item in first_signed_inputs))

	def test_source_changes_invalidate_prior_approval(self):
		invalidate = self.functions["_invalidate_monthly_final_after_source_change"]
		self.assertIn('"status": "已失效"', invalidate)
		self.assertIn('"action": "审批失效"', invalidate)
		self.assertIn("monthly_final_approval_history", invalidate)

	def test_ui_exposes_submit_review_and_lock_as_distinct_actions(self):
		for marker in (
			'data-hrms-capability="attendance_import_submit" data-submit-final-approval',
			'data-hrms-capability="attendance_final_approve" data-review-final-approval="approve"',
			'data-hrms-capability="attendance_final_lock" data-generate-final',
			'"提交月考勤审核"',
			'"审批通过（可审本人）"',
			'"月考勤审核：{0}"',
			"submit_monthly_final_for_approval()",
			"review_monthly_final_approval(decision)",
		):
			self.assertIn(marker, self.page_source)
		self.assertIn("data-one-click-final-approval", self.page_source)
		self.assertIn("一键提交并审批", self.page_source)
		self.assertIn("审批通过（可审本人）", self.page_source)

	def test_six_source_submission_and_approval_ledgers_are_exposed(self):
		batch_ledger = self.functions["list_processing_batches"]
		approval_ledger = self.functions["list_monthly_final_approval_history"]
		register_source = self.functions["register_source_file"]
		self.assertIn("SOURCE_TYPES + MONTHLY_SUPPORT_SOURCE_TYPES", batch_ledger)
		self.assertIn('"submitted_by_name"', batch_ledger)
		self.assertIn('"operator_name"', approval_ledger)
		self.assertIn('"source_type": "attendance_draft"', approval_ledger)
		self.assertIn('"monthly_final_approval_history"', register_source)
		for marker in ("六类来源提交记录", "考勤审批记录", "approval-records"):
			self.assertIn(marker, self.page_source)

	def test_submit_action_stays_visible_while_sources_are_incomplete(self):
		self.assertIn('const submitApprovalDisabled = !approval.can_submit;', self.page_source)
		self.assertIn('data-submit-final-approval ${submitApprovalDisabled ? "disabled" : ""}', self.page_source)
		self.assertIn('以下来源尚未完备：{0}', self.page_source)

	def test_access_center_has_per_account_final_approval_checkbox(self):
		self.assertIn('fieldname: "attendance_final_approve"', self.access_page_source)
		self.assertIn("set_hrms_user_attendance_final_approval", self.access_page_source)


if __name__ == "__main__":
	unittest.main()
