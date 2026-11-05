"""Read-only organization diagnostics, independent of a running Frappe site."""
import json
import unittest
from unittest.mock import Mock

from test_dingtalk_assets_20261028 import load_review
from test_dingtalk_roster_attachments import load_module


class OrganizationLinkageTests(unittest.TestCase):
	def setUp(self):
		self.api = load_module()
		self.review = load_review(self.api)

	def test_paths_explain_candidates_and_local_only_departments_are_retained(self):
		result = self.review.build_department_review([
			{"external_id": "2", "department_name": "生产", "parent_id": "1"},
			{"external_id": "3", "department_name": "一组", "parent_id": "2"},
		], [
			{"name": "P", "department_name": "生产"},
			{"name": "C", "department_name": "一组", "parent_department": "P"},
			{"name": "L", "department_name": "筹备部门", "parent_department": "P"},
		])
		row = result["rows"][1]
		self.assertEqual(row["source_path"], "生产 / 一组")
		self.assertEqual(row["system_path"], "生产 / 一组")
		self.assertIn("尚未绑定编号", row["match_basis"])
		self.assertEqual(result["unmatched_system_count"], 1)
		self.assertEqual(result["unmatched_system_departments"][0]["name"], "L")
		self.assertIn("不自动停用", result["unmatched_system_departments"][0]["suggested_action"])

	def test_duplicate_names_remain_unmatched_even_with_paths(self):
		result = self.review.build_department_review([
			{"external_id": str(i), "department_name": "同名", "parent_id": "1"}
			for i in (2, 3)
		], [{"name": "D", "department_name": "同名"}])
		self.assertEqual(result["matched"], 0)
		self.assertTrue(all(row["suggested_action"] == "人工核对" for row in result["rows"]))

	def test_broken_and_cyclic_local_paths_terminate_with_diagnostics(self):
		for parent in ("A", "missing"):
			result = self.review.build_department_review([], [
				{"name": "A", "department_name": "部门", "parent_department": parent},
			])
			path = result["unmatched_system_departments"][0]["system_path"]
			self.assertIn("[循环]" if parent == "A" else "[上级缺失或不唯一: missing]", path)

	def test_preview_rejects_bad_payloads_and_exposes_mixed_batches_without_writes(self):
		api = self.api
		api._require_dingtalk_manager = Mock()
		api._require_sync_company = Mock(return_value="A")
		api.frappe.get_all = Mock(return_value=[
			{"external_id": "2", "payload_json": json.dumps({"dept_id": 2, "name": "甲", "parent_id": 1}), "sync_log": "old"},
			{"external_id": "3", "payload_json": json.dumps({"dept_id": 3, "name": "乙", "parent_id": 1}), "sync_log": "new"},
			{"external_id": "4", "payload_json": "[]"},
			{"external_id": "5", "payload_json": '{"dept_id":6,"name":"错误编号"}'},
		])
		api.frappe.get_list = Mock(return_value=[])
		api._dingtalk_api_request = Mock()
		api.frappe.get_doc = Mock()
		result = self.review.preview_organization("A")
		self.assertEqual(result["invalid_source_records"], 2)
		self.assertEqual(result["source_count"], 2)
		self.assertTrue(result["mixed_source_batches"])
		self.assertFalse(result["snapshot_complete"])
		api._dingtalk_api_request.assert_not_called()
		api.frappe.get_doc.assert_not_called()


if __name__ == "__main__":
	unittest.main()
