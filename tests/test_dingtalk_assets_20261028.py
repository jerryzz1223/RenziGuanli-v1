import importlib.util
import json
import sys
import types
import unittest
from unittest.mock import Mock, patch

from test_dingtalk_roster_attachments import ROOT, load_module


def load_review(api):
	package = types.ModuleType("hrms.api")
	package.dingtalk_integration = api
	with patch.dict(sys.modules, {"frappe": api.frappe, "hrms": types.ModuleType("hrms"), "hrms.api": package}):
		spec = importlib.util.spec_from_file_location("org_review_test", ROOT / "hrms/api/dingtalk_organization_review.py")
		module = importlib.util.module_from_spec(spec)
		spec.loader.exec_module(module)
		return module


class DingTalkAssetTests(unittest.TestCase):
	def setUp(self):
		self.api = load_module()
		self.api.frappe.throw = Mock(side_effect=ValueError)
		self.api._require_dingtalk_manager = Mock()
		self.api._require_sync_company = Mock(side_effect=lambda company: company or "A")

	def test_all_supported_attachment_url_keys_survive_roster_extraction(self):
		for key in ["download_url", "downloadUrl", "file_url", "fileUrl", "download_uri", "downloadUri", "url"]:
			field = {"field_code": "sys08-personalPhoto", "field_value_list": [{"value": json.dumps([{key: "https://file.dingtalk.com/photo.png", "fileName": "photo.png"}])}]}
			items = self.api._roster_attachment_items(field)
			self.assertEqual(len(items), 1, key)
			self.assertEqual(self.api._normalise_dingtalk_attachment(field, items[0], 0)["download_url"], "https://file.dingtalk.com/photo.png")

	def test_drive_download_accepts_top_level_result_and_data_wrappers(self):
		self.api._resolve_dingtalk_drive_file = Mock(return_value=("space", "FileToken123"))
		self.api._dingtalk_drive_union_id = Mock(return_value="test-operator")
		payload = {"downloadInfo": {"resourceUrl": "https://files.example.test/object", "headers": {"x-test-signature": "fixture"}}}
		for wrapper in [payload, {"result": payload}, {"data": payload}]:
			self.api._dingtalk_api_request = Mock(return_value=wrapper)
			url, headers, error = self.api._fetch_dingtalk_drive_download_info({"file_id": "FileToken123"}, spaces=[])
			self.assertEqual(url, payload["downloadInfo"]["resourceUrl"])
			self.assertEqual(headers, payload["downloadInfo"]["headers"])
			self.assertEqual(error, "")

	def test_storage_nested_header_signature_response_is_usable(self):
		self.api._resolve_dingtalk_drive_file = Mock(return_value=("space", "123456789"))
		self.api._dingtalk_drive_union_id = Mock(return_value="test-operator")
		self.api._dingtalk_api_request = Mock(return_value={"data": {"headerSignatureInfo": {"resourceUrls": ["https://files.example.test/a"], "headers": {"x-fixture": "yes"}}}})
		url, headers, error = self.api._fetch_dingtalk_drive_download_info({"file_id": "123456789"}, spaces=[])
		self.assertEqual(url, "https://files.example.test/a")
		self.assertEqual(headers, {"x-fixture": "yes"})
		self.assertEqual(self.api._dingtalk_api_request.call_args.args[0], "POST")
		self.assertEqual(error, "")

	def test_downloaded_attachment_becomes_private_employee_file(self):
		api = self.api
		requests = types.ModuleType("requests")
		requests.RequestException = type("RequestException", (Exception,), {})
		requests.get = Mock(return_value=types.SimpleNamespace(url="https://file.dingtalk.com/photo.png", headers={"Content-Length": "4"}, content=b"test", raise_for_status=Mock()))
		template = types.ModuleType("hrms.api.employee_field_template")
		template._get_employee_material_type_map = lambda: {"personal_id_photo": {"fieldname": "custom_photo_material"}}
		api.frappe.db = types.SimpleNamespace(exists=Mock(return_value=None))
		created = []
		file_doc = types.SimpleNamespace(name="FILE-1", file_url="/private/files/photo.png")
		def get_doc(data):
			created.append(data)
			return types.SimpleNamespace(insert=Mock(return_value=file_doc))
		api.frappe.get_doc = get_doc
		with patch.dict(sys.modules, {"requests": requests, "hrms.api.employee_field_template": template}):
			result = api._import_dingtalk_attachments({"attachments_json": [{"file_name": "photo.png", "material_type": "personal_id_photo", "download_url": "https://file.dingtalk.com/photo.png"}]}, "EMP-1")
		self.assertEqual(result["status"], "已下载")
		self.assertEqual(result["downloaded"], 1)
		self.assertEqual(created[0]["doctype"], "File")
		self.assertEqual(created[0]["attached_to_doctype"], "Employee")
		self.assertEqual(created[0]["attached_to_name"], "EMP-1")
		self.assertEqual(created[0]["attached_to_field"], "custom_photo_material")
		self.assertEqual(created[0]["content"], b"test")
		self.assertEqual(created[0]["is_private"], 1)

	def test_untrusted_direct_url_is_not_requested(self):
		api = self.api
		content, reason = api._download_dingtalk_attachment({"download_url": "https://other.example.test/file"})
		self.assertIsNone(content)
		self.assertIn("受信任", reason)

	def setup_worker(self, result, employee_company="A"):
		api = self.api
		log = types.SimpleNamespace(name="LOG-1")
		doc = types.SimpleNamespace(company="A", source_record="RAW-1", matched_employee="EMP-1", save=Mock())
		api.frappe.get_doc = Mock(side_effect=lambda doctype, name: log if doctype == api.DINGTALK_SYNC_LOG_DOCTYPE else doc)
		api.frappe.db = types.SimpleNamespace(savepoint=Mock(), rollback=Mock(), commit=Mock(), get_value=Mock(side_effect=lambda doctype, *_args: api.DINGTALK_EMPLOYEE_ROSTER_SOURCE_TYPE if doctype == api.DINGTALK_RAW_RECORD_DOCTYPE else employee_company))
		api._import_dingtalk_attachments = Mock(return_value=result)
		api._finish_sync_log = Mock()
		return doc

	def test_download_failure_or_unavailable_file_is_not_reported_as_complete(self):
		for result in [
			{"status": "下载失败", "downloaded": 0, "failed": 1, "unavailable": 0},
			{"status": "接口未提供下载", "downloaded": 0, "failed": 0, "unavailable": 1},
			{"status": "部分下载", "downloaded": 1, "failed": 1, "unavailable": 0},
		]:
			doc = self.setup_worker(result)
			actual = self.api.run_existing_dingtalk_employee_attachment_import("A", ["IMPORT-1"], "LOG-1")
			self.assertEqual(actual["failed"], 1)
			self.assertEqual(self.api._finish_sync_log.call_args.args[1], "部分失败")
			doc.save.assert_called_once()
			self.assertEqual(actual["downloaded"], result["downloaded"])

	def test_successful_attachment_worker_keeps_completed_status(self):
		self.setup_worker({"status": "已下载", "downloaded": 2, "failed": 0, "unavailable": 0})
		result = self.api.run_existing_dingtalk_employee_attachment_import("A", ["IMPORT-1"], "LOG-1")
		self.assertEqual((result["failed"], result["downloaded"], result["updated"]), (0, 2, 1))
		self.assertEqual(self.api._finish_sync_log.call_args.args[1], "已完成")

	def test_attachment_worker_rechecks_employee_company(self):
		self.setup_worker({}, employee_company="B")
		result = self.api.run_existing_dingtalk_employee_attachment_import("A", ["IMPORT-1"], "LOG-1")
		self.assertEqual(result["failed"], 1)
		self.api._import_dingtalk_attachments.assert_not_called()
		self.api.frappe.db.rollback.assert_called_once()

	def test_single_file_verification_rejects_other_company_before_download(self):
		self.api.frappe.get_doc = Mock(return_value=types.SimpleNamespace(company="B"))
		self.api._download_dingtalk_attachment = Mock()
		with self.assertRaises(ValueError):
			self.api.verify_dingtalk_employee_attachment_download("IMPORT-B", company="A")
		self.api._download_dingtalk_attachment.assert_not_called()

	def test_attachment_task_type_is_allowed_by_actual_log_schema(self):
		schema = json.loads((ROOT / "hrms/hr/doctype/hrms_dingtalk_sync_log/hrms_dingtalk_sync_log.json").read_text())
		options = next(field["options"] for field in schema["fields"] if field["fieldname"] == "sync_type").splitlines()
		self.assertIn("员工附件同步", options)


class DingTalkOrganizationReviewTests(unittest.TestCase):
	def setUp(self):
		self.api = load_module()
		self.review = load_review(self.api)

	def test_existing_parent_difference_and_new_department_are_reported(self):
		sources = [{"external_id": "2", "department_name": "总办", "parent_id": "1"}, {"external_id": "3", "department_name": "人事", "parent_id": "2"}, {"external_id": "4", "department_name": "新部门", "parent_id": "2"}]
		local = [{"name": "总办-A", "department_name": "总办", "parent_department": "根-A"}, {"name": "人事-A", "department_name": "人事", "parent_department": "其他-A"}]
		result = self.review.build_department_review(sources, local)
		self.assertEqual(result["matched"], 2)
		self.assertEqual(result["missing"], 1)
		self.assertIn("上下级关系不一致，需人工确认", result["rows"][1]["issues"])
		self.assertEqual(result["rows"][2]["status"], "待新建")
		self.assertTrue(result["read_only"])

	def test_duplicate_source_and_local_names_do_not_choose_a_department(self):
		sources = [{"external_id": str(i), "department_name": "同名", "parent_id": "1"} for i in [2, 3]]
		local = [{"name": f"同名-{i}", "department_name": "同名"} for i in [1, 2]]
		result = self.review.build_department_review(sources, local)
		self.assertTrue(all(not row["matched_department"] for row in result["rows"]))
		self.assertTrue(all(len(row["issues"]) >= 2 for row in result["rows"]))

	def test_duplicate_dingtalk_names_cannot_both_match_one_local_department(self):
		sources = [{"external_id": str(i), "department_name": "同名", "parent_id": "1"} for i in [2, 3]]
		result = self.review.build_department_review(sources, [{"name": "同名-A", "department_name": "同名"}])
		self.assertEqual(result["matched"], 0)
		self.assertTrue(all(not row["matched_department"] for row in result["rows"]))

	def test_cycles_and_missing_parents_are_explicit(self):
		sources = [{"external_id": "2", "department_name": "甲", "parent_id": "3"}, {"external_id": "3", "department_name": "乙", "parent_id": "2"}, {"external_id": "4", "department_name": "丙", "parent_id": "99"}]
		result = self.review.build_department_review(sources, [])
		self.assertIn("钉钉部门上下级存在循环", result["rows"][0]["issues"])
		self.assertIn("来源上级部门缺失或不唯一", result["rows"][2]["issues"])

	def test_preview_reads_only_current_company_and_reports_invalid_sources(self):
		api = self.api
		api._require_dingtalk_manager = Mock()
		api._require_sync_company = Mock(return_value="A")
		api.frappe.get_all = Mock(return_value=[{"external_id": "2", "payload_json": '{"dept_id":2,"name":"人事","parent_id":1}', "sync_log": "LOG-1", "received_at": "2026-10-28"}, {"payload_json": "invalid"}])
		api.frappe.get_list = Mock(return_value=[])
		api._dingtalk_api_request = Mock()
		api.frappe.get_doc = Mock()
		result = self.review.preview_organization("A")
		self.assertEqual(result["invalid_source_records"], 1)
		self.assertEqual(result["source_count"], 1)
		self.assertEqual(result["latest_source_at"], "2026-10-28")
		self.assertEqual(api.frappe.get_all.call_args.kwargs["filters"]["company"], "A")
		self.assertEqual(api.frappe.get_list.call_args.kwargs["filters"]["company"], "A")
		api._dingtalk_api_request.assert_not_called()
		api.frappe.get_doc.assert_not_called()


if __name__ == "__main__":
	unittest.main()
