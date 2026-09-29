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
	def test_each_full_roster_pull_gets_its_own_review_row(self):
		module = load_module()

		class ImportDoc(dict):
			def save(self, **_kwargs):
				self["saved"] = True

		previous = ImportDoc(sync_log="OLD", payload_hash="same", import_status="已批准")
		fresh = ImportDoc()
		module.frappe.get_all = lambda *_args, **_kwargs: ["RAW-1"]
		module.frappe.db = types.SimpleNamespace(get_value=lambda *_args, **_kwargs: "IMPORT-OLD")
		module.frappe.get_doc = lambda *_args: previous
		module.frappe.new_doc = lambda *_args: fresh
		module._dingtalk_employee_mapping = lambda *_args: ({"custom_employee_code": "4018", "employee_name": "测试", "date_of_joining": "2026-01-01"}, {})
		module._dingtalk_employee_match = lambda *_args: {"status": "待审批", "reason": "", "employee": ""}
		module._payload_hash = lambda *_args: "same"
		module.now_datetime = lambda: "2026-09-29"
		class Source(dict):
			name = "RAW-1"

		source = Source(source_type=module.DINGTALK_EMPLOYEE_ROSTER_SOURCE_TYPE)
		result = module._stage_dingtalk_employee_import(
			{"dingtalk_userid": "USER-1", "raw": {"userid": "USER-1"}},
			"永新", types.SimpleNamespace(name="LATEST"), source,
		)
		self.assertIs(result, fresh)
		self.assertEqual(result["sync_log"], "LATEST")
		self.assertTrue(result["saved"])
		self.assertEqual(previous["sync_log"], "OLD")

	def test_initial_roster_import_requires_a_complete_coded_snapshot(self):
		module = load_module()
		self.assertTrue(module._dingtalk_suspected_placeholder_code("111111111111"))
		self.assertFalse(module._dingtalk_suspected_placeholder_code("260905"))
		issues = module._dingtalk_roster_initial_import_source_issues({
			"sync_log": "SYNC-1",
			"status": "已完成",
			"records_received": 217,
			"snapshot_row_count": 217,
			"employee_codes": {"4018"},
			"missing_employee_code_count": 24,
			"duplicate_employee_codes": [],
		})
		self.assertIn("24 条钉钉在职档案缺少公司工号", issues)
		self.assertEqual(module._dingtalk_roster_initial_import_source_issues({
			"sync_log": "SYNC-2",
			"status": "已完成",
			"records_received": 1,
			"snapshot_row_count": 1,
			"employee_codes": {"4018"},
			"missing_employee_code_count": 0,
			"duplicate_employee_codes": [],
		}), [])

	def test_initial_roster_import_rejects_stale_preview_before_writing(self):
		module = load_module()
		module._require_dingtalk_employee_import_approver = lambda: None
		module._require_sync_company = lambda company: company
		module._build_dingtalk_roster_initial_import_preview = lambda _company: {
			"can_import": True, "sync_log": "SYNC-2", "preview_token": "current", "issues": []
		}
		module.frappe.db = types.SimpleNamespace(sql=lambda *_args: None)
		module.frappe.throw = lambda message: (_ for _ in ()).throw(ValueError(message))
		module._upsert_dingtalk_employee_values = lambda *_args: self.fail("stale preview reached Employee write")
		with self.assertRaisesRegex(ValueError, "重新预检"):
			module.apply_dingtalk_roster_initial_import("永新", "SYNC-2", "stale")

	def test_initial_roster_job_rolls_back_all_employee_writes_on_failure(self):
		module = load_module()
		events = []
		module.frappe.db = types.SimpleNamespace(
			sql=lambda *_args: events.append("lock"),
			rollback=lambda: events.append("rollback"),
			commit=lambda: events.append("commit"),
		)
		module.frappe.get_doc = lambda *_args: object()
		module._require_dingtalk_roster_initial_import_preview = lambda *_args: {"can_import": True}
		def fail_after_write(*_args):
			events.append("write")
			raise ValueError("bad row")

		module._apply_dingtalk_roster_initial_import = fail_after_write
		module._finish_sync_log = lambda _log, status, **_kwargs: events.append(status)
		with self.assertRaisesRegex(ValueError, "bad row"):
			module.run_queued_dingtalk_roster_initial_import("永新", "SYNC-2", "token", "OP-1", "reviewer")
		self.assertEqual(events, ["lock", "write", "rollback", "失败", "commit"])

	def test_sync_operation_distinguishes_created_updated_and_attachment_only(self):
		module = load_module()

		self.assertEqual(module._dingtalk_sync_operation({"status": "已创建"}, {"downloaded": 1}), "新建员工")
		self.assertEqual(
			module._dingtalk_sync_operation({"status": "已更新", "filled_fields": ["gender"]}, {"downloaded": 1}),
			"补全资料及附件",
		)
		self.assertEqual(
			module._dingtalk_sync_operation({"status": "已更新", "filled_fields": []}, {"attachments": [{"file_name": "a.jpg"}]}),
			"同步附件",
		)

	def test_roster_select_fields_prefer_human_label_over_internal_code(self):
		module = load_module()
		fields = [
			{
				"fieldCode": "sys03-highestEdu",
				"fieldValueList": [{"label": "大专", "value": "3"}],
			}
		]

		self.assertEqual(module._roster_field_value(fields, "sys03-highestEdu"), "大专")

	def test_employee_select_values_are_normalised_to_hrms_options(self):
		module = load_module()
		select = types.SimpleNamespace(fieldtype="Select")

		self.assertEqual(module._normalise_dingtalk_employee_value("gender", "男", select), "Male")
		self.assertEqual(module._normalise_dingtalk_employee_value("custom_marital_status_text", "未婚", select), "未")
		self.assertEqual(module._normalise_dingtalk_employee_value("custom_education_level", "初中及以下", select), "初中")
		self.assertEqual(module._normalise_dingtalk_employee_value("custom_education_level", "小学", select), "小学")
		self.assertEqual(module._normalise_dingtalk_employee_value("employment_type", "全职", select), "Full-time")
		self.assertIsNone(module._normalise_dingtalk_employee_value("emergency_phone_number", "0", select))
		self.assertEqual(module._normalise_dingtalk_employee_value("department", "设备组", select), "设备课")
		self.assertEqual(module._normalise_dingtalk_employee_value("designation", "网管", select), "网管员")

	def test_actual_department_overrides_multi_membership_department(self):
		module = load_module()

		self.assertEqual(
			module.DINGTALK_EMPLOYEE_FIELD_MAP["97ba8623-e5bf-4af2-9f05-a392063ce646"],
			("department",),
		)

	def test_existing_employee_import_only_fills_blank_fields(self):
		module = load_module()

		fillable, preserved = module._dingtalk_existing_employee_import_plan(
			{
				"company": "永新",
				"status": "Active",
				"department": "品保课",
				"designation": "作业员",
				"relation": "配偶",
			},
			{"department": "连续课", "designation": "作业员", "relation": ""},
		)

		self.assertEqual(fillable, {"relation": "配偶"})
		self.assertEqual(preserved, ["department"])

	def test_comparison_ignores_phone_format_and_protects_employee_code(self):
		module = load_module()
		meta = {
			"cell_number": types.SimpleNamespace(label="手机号码", fieldtype="Data", options=""),
			"department": types.SimpleNamespace(label="部门", fieldtype="Link", options="Department"),
			"custom_employee_code": types.SimpleNamespace(label="工号", fieldtype="Data", options=""),
		}

		differences = module._dingtalk_employee_field_differences(
			{"cell_number": "+86-18287355486", "department": "品保课", "custom_employee_code": "9999"},
			{"cell_number": "18287355486", "department": "连续课", "custom_employee_code": "260506"},
			meta_fields=meta,
		)

		self.assertEqual([item["fieldname"] for item in differences], ["department"])

	def test_unchanged_employee_fields_do_not_enter_delta(self):
		module = load_module()

		self.assertEqual(
			module._changed_dingtalk_employee_fields(
				{"company": "永新", "status": "Active", "gender": "Male", "custom_education_level": "大专"},
				{"company": "永新", "status": "Active", "gender": "Male", "custom_education_level": "大专"},
			),
			[],
		)
		self.assertEqual(
			module._changed_dingtalk_employee_fields(
				{"company": "永新", "gender": "Female"},
				{"company": "永新", "gender": "Male"},
			),
			["gender"],
		)

	def test_directory_endpoints_are_rate_limited_and_qps_errors_are_detected(self):
		module = load_module()

		self.assertGreaterEqual(module._dingtalk_request_interval(module.DINGTALK_DEPARTMENT_LIST_PATH), 0.1)
		self.assertGreaterEqual(module._dingtalk_request_interval(module.DINGTALK_DEPARTMENT_USERS_PATH), 0.1)
		self.assertEqual(module._dingtalk_request_interval("/attendance/list"), 0.0)
		self.assertEqual(module._dingtalk_error_details({"errcode": 88, "errmsg": "subcode=90002 qps"}), ("88", "subcode=90002 qps"))
		self.assertTrue(module._is_dingtalk_rate_limit("88", "subcode=90002 qps"))

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
