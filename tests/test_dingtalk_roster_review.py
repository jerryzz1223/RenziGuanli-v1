"""Review decisions and selected-file imports using isolated Frappe fixtures."""
import json
import types
import unittest
from unittest.mock import Mock

from test_dingtalk_roster_attachments import load_module
from test_dingtalk_roster_tasks import load_tasks


class Doc(dict):
	def __getattr__(self, name):
		return self.get(name)

	def __setattr__(self, name, value):
		self[name] = value

	def set(self, name, value):
		self[name] = value


class ReviewTests(unittest.TestCase):
	def setUp(self):
		self.api = a = load_module()
		a._require_dingtalk_employee_import_approver = Mock()
		a._require_sync_company = lambda c: c
		a.frappe.throw = Mock(side_effect=ValueError)
		a.frappe.db = types.SimpleNamespace(exists=Mock(return_value=True), sql=Mock(), get_value=Mock(return_value=a.DINGTALK_EMPLOYEE_ROSTER_SOURCE_TYPE))
		a.frappe.session = types.SimpleNamespace(user="reviewer")
		self.doc = Doc(name="I1", company="A", matched_employee="E1", source_record="R1", modified="v1", dingtalk_userid="U1", employee_name="员工", payload_json={}, attachments_json=[], save=Mock())
		self.employee = Doc(name="E1", company="A", custom_employee_code="42", employee_name="系统姓名", department="部门甲", modified="e1", flags=types.SimpleNamespace(), reload=Mock(), save=Mock(), meta=types.SimpleNamespace(get_valid_columns=lambda: ["employee_name", "department", "custom_employee_code"]))
		self.fields = [types.SimpleNamespace(fieldname=name, fieldtype=kind, label=name, options=options, read_only=0) for name, kind, options in [("employee_name", "Data", ""), ("department", "Link", "Department"), ("custom_employee_code", "Data", "")]]
		a.frappe.get_doc = Mock(side_effect=lambda doctype, name: self.employee if doctype == "Employee" else self.doc)
		a.frappe.get_meta = lambda _: types.SimpleNamespace(fields=self.fields)
		a._recompute_dingtalk_employee_import = Mock(return_value=({"custom_employee_code": "42", "employee_name": "钉钉姓名", "department": "部门乙"}, {}))
		a._normalize_dingtalk_roster_user = Mock(return_value={"roster_fields": {"extra": "未映射资料"}, "roster_field_labels": {"extra": "补充字段"}})
		self.tasks = load_tasks(a)

	def apply(self, fields, **kwargs):
		return self.api.apply_dingtalk_employee_comparison("I1", json.dumps(fields), "人工核对", expected_modified="e1", expected_import_modified="v1", **kwargs)

	def test_custom_value_and_keep_decision_apply_only_chosen_field(self):
		result = self.apply(["employee_name"], custom_values_json='{"employee_name":"自定义姓名"}', keep_fieldnames_json='["department"]')
		self.assertEqual(self.employee.employee_name, "自定义姓名")
		self.assertEqual(self.employee.department, "部门甲")
		self.assertEqual(result["review_status"], "已人工处理")
		self.assertIn("保留系统值：department", self.doc.approval_note)
		self.employee.save.assert_called_once()

	def test_keep_all_records_review_without_saving_employee(self):
		result = self.apply([], keep_fieldnames_json='["employee_name","department"]')
		self.assertEqual(result["review_status"], "已人工处理")
		self.employee.save.assert_not_called()
		self.doc.save.assert_called_once()

	def test_stale_employee_and_source_are_rejected(self):
		for target in [self.employee, self.doc]:
			old = target.modified
			target.modified = "new"
			with self.assertRaises(ValueError):
				self.apply(["employee_name"])
			target.modified = old
		self.employee.save.assert_not_called()

	def test_protected_unmapped_and_invalid_link_custom_values_are_rejected(self):
		for fields, custom in [(["status"], {"status": "Left"}), (["private_field"], {"private_field": "x"}), (["employee_name"], {"department": "x"})]:
			with self.assertRaises(ValueError):
				self.apply(fields, custom_values_json=json.dumps(custom))
		self.api.frappe.db.exists = Mock(side_effect=lambda doctype, *args: doctype != "Department")
		with self.assertRaises(ValueError):
			self.apply(["department"], custom_values_json='{"department":"不存在"}')
		self.employee.save.assert_not_called()

	def test_readonly_custom_field_is_rejected(self):
		self.fields[0].read_only = 1
		with self.assertRaises(ValueError):
			self.apply(["employee_name"], custom_values_json='{"employee_name":"任意"}')
		self.employee.save.assert_not_called()

	def test_detail_includes_all_source_fields_and_hides_remote_download_urls(self):
		self.doc.attachments_json = [{"file_name": "test.png", "is_image": True, "download_url": "https://signed.example.test/token"}]
		result = self.tasks.get_roster_employee_detail("I1", "A")
		self.assertEqual(result["source_fields"][0]["value"], "未映射资料")
		self.assertTrue(result["attachments"][0]["download_available"])
		self.assertNotIn("download_url", result["attachments"][0])
		self.assertEqual(result["employee_modified"], "e1")

	def test_company_and_source_scope_rejected_before_returning_detail(self):
		with self.assertRaises(ValueError):
			self.tasks.get_roster_employee_detail("I1", "B")
		self.api.frappe.db.get_value.return_value = "其他来源"
		with self.assertRaises(ValueError):
			self.tasks.get_roster_employee_detail("I1", "A")

	def test_selected_attachment_preserves_unselected_metadata(self):
		self.doc.attachments_json = [{"file_name": "a.png"}, {"file_name": "b.png"}]
		self.doc.reload = Mock()
		self.api.frappe.db.get_value.side_effect = [self.api.DINGTALK_EMPLOYEE_ROSTER_SOURCE_TYPE, "A"]
		self.api._import_dingtalk_attachments = Mock(return_value={"attachments": [{"file_name": "b.png", "sync_status": "已归档"}], "status": "已下载", "downloaded": 1})
		self.tasks.import_roster_employee_attachments("I1", "A", "[1]")
		stored = json.loads(self.doc.attachments_json)
		self.assertEqual(stored[0], {"file_name": "a.png"})
		self.assertEqual(stored[1]["sync_status"], "已归档")
		self.assertEqual(self.doc.attachment_status, "部分下载")

	def test_verify_download_does_not_save_or_create_files(self):
		self.doc.attachments_json = [{"file_name": "a.png"}]
		self.api._download_dingtalk_attachment = Mock(return_value=(b"image", ""))
		result = self.tasks.import_roster_employee_attachments("I1", "A", "[0]", 1)
		self.assertTrue(result["results"][0]["verified"])
		self.doc.save.assert_not_called()

	def test_invalid_attachment_indexes_rejected(self):
		self.doc.attachments_json = [{"file_name": "a"}]
		for indexes in ["[]", "[-1]", "[1]", '["0"]', '[true]']:
			with self.assertRaises(ValueError):
				self.tasks.import_roster_employee_attachments("I1", "A", indexes)


if __name__ == "__main__":
	unittest.main()
