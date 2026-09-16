import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_module():
	frappe = types.ModuleType("frappe")
	frappe._ = lambda value: value
	frappe.whitelist = lambda **_kwargs: (lambda function: function)
	frappe.utils = types.SimpleNamespace(
		get_datetime=lambda value: value,
		getdate=lambda value: value,
		now_datetime=lambda: None,
	)
	utils = types.ModuleType("frappe.utils")
	utils.get_datetime = frappe.utils.get_datetime
	utils.getdate = frappe.utils.getdate
	utils.now_datetime = frappe.utils.now_datetime
	saved = {name: sys.modules.get(name) for name in ("frappe", "frappe.utils")}
	sys.modules["frappe"] = frappe
	sys.modules["frappe.utils"] = utils
	try:
		spec = importlib.util.spec_from_file_location(
			"dingtalk_integration_under_test", ROOT / "hrms/api/dingtalk_integration.py"
		)
		module = importlib.util.module_from_spec(spec)
		spec.loader.exec_module(module)
		return module
	finally:
		for name, value in saved.items():
			if value is None:
				sys.modules.pop(name, None)
			else:
				sys.modules[name] = value


class DingTalkRosterAttachmentTests(unittest.TestCase):
	def test_photo_field_is_preserved_as_attachment_metadata(self):
		module = load_module()
		payload = {
			"userid": "ding-user-1",
			"fieldDataList": [
				{
					"fieldCode": "sys08-forntIDcard",
					"fieldName": "身份证(人像面)",
					"fieldType": "DDPhotoField",
					"fieldValueList": [
						{
							"value": json.dumps(
								[
									{
										"spaceId": "space-1",
										"fileId": "file-1",
										"fileName": "身份证.jpg",
										"fileSize": 1234,
										"fileType": "jpg",
									}
								]
							)
						}
					],
				}
			],
		}

		user = module._normalize_dingtalk_roster_user(payload, "ding-user-1")

		self.assertEqual(
			user["roster_attachments"],
			[
				{
					"field_code": "sys08-forntIDcard",
					"field_name": "身份证(人像面)",
					"item_index": 0,
					"material_type": "identity_card_photo",
					"file_id": "file-1",
					"space_id": "space-1",
					"file_name": "身份证.jpg",
					"file_size": 1234,
					"file_type": "jpg",
					"download_url": "",
					"is_image": True,
				}
			],
		)

	def test_attachment_without_download_url_is_not_claimed_as_downloaded(self):
		module = load_module()

		self.assertEqual(
			module._normalise_dingtalk_attachment(
				{"fieldCode": "sys08-personalPhoto", "fieldName": "员工照片", "fieldType": "DDPhotoField"},
				{"fileId": "file-2", "spaceId": "space-2", "fileName": "照片.png", "fileType": "png"},
				0,
			)["download_url"],
			"",
		)

	def test_photo_field_url_is_preserved_as_download_url(self):
		module = load_module()
		payload = {
			"userid": "ding-user-2",
			"fieldDataList": [
				{
					"fieldCode": "sys08-personalPhoto",
					"fieldName": "员工照片",
					"fieldType": "DDPhotoField",
					"fieldValueList": [{"value": "dingpan://employee/photo-2.png"}],
				}
			],
		}

		user = module._normalize_dingtalk_roster_user(payload, "ding-user-2")

		self.assertEqual(len(user["roster_attachments"]), 1)
		self.assertEqual(
			user["roster_attachments"][0]["download_url"],
			"dingpan://employee/photo-2.png",
		)
		self.assertTrue(user["roster_attachments"][0]["is_image"])
		self.assertEqual(user["roster_attachments"][0]["file_name"], "photo-2.png")

	def test_dingpan_uri_file_id_is_extracted_without_exposing_the_uri(self):
		module = load_module()

		self.assertEqual(
			module._dingpan_file_id_from_uri("dingpan://AbCdEf1234567890_xYz-12.jpg"),
			"AbCdEf1234567890_xYz-12",
		)
		self.assertEqual(module._dingpan_file_id_from_uri("https://example.com/photo.jpg"), "")

	def test_alphanumeric_dingpan_file_uses_drive_file_endpoint(self):
		module = load_module()
		calls = []

		def fake_request(method, path, **kwargs):
			calls.append((method, path, kwargs))
			return {"id": "AbCdEf1234567890_xYz-12"}

		module._dingtalk_api_request = fake_request
		space_id, file_id = module._resolve_dingtalk_drive_file(
			{"file_id": "AbCdEf1234567890_xYz-12"},
			[{"spaceId": "space-1", "_operator_union_id": "union-1"}],
		)

		self.assertEqual((space_id, file_id), ("space-1", "AbCdEf1234567890_xYz-12"))
		self.assertEqual(calls[0][0], "GET")
		self.assertIn("/v1.0/drive/spaces/space-1/files/AbCdEf1234567890_xYz-12", calls[0][1])

	def test_numeric_dentry_uses_storage_file_endpoint(self):
		module = load_module()
		calls = []

		def fake_request(method, path, **kwargs):
			calls.append((method, path, kwargs))
			return {"id": "123456"}

		module._dingtalk_api_request = fake_request
		space_id, file_id = module._resolve_dingtalk_drive_file(
			{"file_id": "123456"}, [{"spaceId": "space-1", "_operator_union_id": "union-1"}]
		)

		self.assertEqual((space_id, file_id), ("space-1", "123456"))
		self.assertEqual(calls[0][0], "POST")
		self.assertIn("/v1.0/storage/spaces/space-1/dentries/123456/query", calls[0][1])
