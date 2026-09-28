import ast
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
		self.assertIn('submitted_by") == frappe.session.user', review)
		self.assertIn("上传/提交人不能审批本人提交", review)

	def test_lock_generation_requires_current_approved_snapshot(self):
		generate = self.functions["generate_monthly_final_files"]
		self.assertIn('_require_processing_manager("attendance_final_lock")', generate)
		self.assertIn("approved_for_current_snapshot", generate)
		self.assertIn("尚未审批通过，不能锁定生成", generate)

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
			'"审核通过"',
			'"月考勤审核：{0}"',
			"submit_monthly_final_for_approval()",
			"review_monthly_final_approval(decision)",
		):
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
