import sys
import types
import unittest
from unittest.mock import Mock, patch

import test_dingtalk_roster_tasks as task_tests


class FullEmployeeTests(unittest.TestCase):
	def setUp(self):
		task_tests.RosterTaskTests.setUp(self)

	def test_directory_traverses_nested_departments_and_deduplicates_all_pages(self):
		api = self.api
		calls = []
		def request(_method, path, **kwargs):
			body = kwargs["json_body"]
			calls.append((path, body))
			dept = body["dept_id"]
			if path == api.DINGTALK_DEPARTMENT_LIST_PATH:
				return {"result": [{"dept_id": 2}, {"dept_id": -7}] if dept == 1 else [{"dept_id": 3}] if dept == 2 else []}
			cursor = body["cursor"]
			if dept == 1:
				return {"result": {"list": [{"userid": "root", "name": "根部门员工", "job_number": "1"}], "has_more": False}}
			if dept == 2 and cursor == 0:
				return {"result": {"list": [{"userid": "existing", "name": "已有员工", "job_number": "2"}], "has_more": True, "next_cursor": 100}}
			if dept == 2:
				return {"result": {"list": [{"userid": "later", "name": "第二页员工", "job_number": "3"}], "has_more": False}}
			return {"result": {"list": [{"userid": "existing", "job_number": "2"}], "has_more": False}}
		api._dingtalk_api_request = Mock(side_effect=request)
		api._fetch_dingtalk_onjob_userids = Mock(return_value=["existing", "hrm-only"])
		hrm = {"existing": {"employee_code": "2", "roster_fields": {"sys00-confirmJoinTime": "2020-01-01"}}, "hrm-only": {"employee_code": "4"}}
		api._fetch_dingtalk_preentry_details = Mock(return_value=hrm.copy())
		ids, details = self.tasks.fetch_full_roster_users()
		self.assertEqual(set(ids), {"root", "existing", "later", "hrm-only"})
		self.assertEqual(len(ids), 4)
		self.assertEqual(details["existing"], hrm["existing"], "HRM details must win over basic directory fields")
		self.assertEqual(details["later"]["employee_code"], "3")
		self.assertEqual(details["root"]["employee_name"], "根部门员工")
		self.assertNotIn("sys00-confirmJoinTime", details["root"]["roster_fields"], "do not invent joining dates")
		self.assertTrue(details["root"]["raw"]["hrms_directory_only"])
		self.assertFalse(any(body["dept_id"] == -7 for _, body in calls))
		self.assertTrue(any(body.get("cursor") == 100 for _, body in calls))

	def test_empty_hrm_still_includes_directory_employee_without_preentry(self):
		api = self.api
		api._dingtalk_api_request = Mock(side_effect=[{"result": []}, {"result": {"list": [{"userid": "old", "name": "早已入职", "job_number": "88"}], "has_more": False}}])
		api._fetch_dingtalk_onjob_userids = Mock(return_value=[])
		api._fetch_dingtalk_preentry_details = Mock()
		ids, details = self.tasks.fetch_full_roster_users()
		self.assertEqual(ids, ["old"])
		self.assertEqual(details["old"]["employee_code"], "88")
		api._fetch_dingtalk_preentry_details.assert_not_called()

	def test_repeating_directory_cursor_fails_instead_of_claiming_complete(self):
		self.api._dingtalk_api_request = Mock(side_effect=[{"result": []}, {"result": {"list": [], "has_more": True, "next_cursor": 0}}])
		with self.assertRaises(ValueError):
			self.tasks.fetch_full_roster_users()

	def test_directory_permission_failure_is_not_silently_treated_as_empty(self):
		self.api._dingtalk_api_request = Mock(side_effect=PermissionError("directory unavailable"))
		with self.assertRaises(PermissionError):
			self.tasks.fetch_full_roster_users()

	def test_onjob_pages_include_all_employment_states_and_string_terminal_zero(self):
		self.api._dingtalk_api_request = Mock(side_effect=[{"result": {"data_list": ["one"], "next_cursor": "50"}}, {"result": {"data_list": ["two", "one"], "next_cursor": "0"}}])
		self.assertEqual(self.api._fetch_dingtalk_onjob_userids(), ["one", "two"])
		calls = self.api._dingtalk_api_request.call_args_list
		self.assertEqual([call.kwargs["json_body"]["offset"] for call in calls], [0, "50"])
		self.assertTrue(all(call.kwargs["json_body"]["status_list"] == "2,3,5,-1" for call in calls))

	def test_result_list_includes_unchanged_and_manual_comparison_and_paginates(self):
		rows = [{"employee_code": str(i), "import_status": "无变更" if i % 2 else "待人工比对"} for i in range(101)]
		self.api.frappe.get_all = Mock(side_effect=[["RAW-1"], rows])
		self.api.frappe.db.count = Mock(return_value=1350)
		self.log.records_received = 1350
		self.log.records_failed = 0
		self.log.error_message = ""
		result = self.tasks.list_roster_employees("Company A", "SYNC-1", start=1000)
		self.assertEqual(len(result["rows"]), 100)
		self.assertTrue(result["has_more"])
		self.assertEqual(result["next_start"], 1100)
		self.assertEqual(result["total"], 1350)
		kwargs = self.api.frappe.get_all.call_args.kwargs
		self.assertNotIn("import_status", kwargs["filters"])
		self.assertEqual(kwargs["filters"]["source_record"], ["in", ["RAW-1"]])
		self.assertEqual(kwargs["limit_start"], 1000)
		self.assertEqual(kwargs["limit_page_length"], 101)
		self.assertNotIn("payload_json", kwargs["fields"])

	def test_worker_pipeline_stages_existing_and_directory_only_employees(self):
		api = self.api
		api._dingtalk_api_request = Mock(side_effect=[
			{"result": []},
			{"result": {"list": [{"userid": "old", "name": "老员工", "job_number": "88"}], "has_more": False}},
		])
		api._fetch_dingtalk_onjob_userids = Mock(return_value=["matched"])
		api._fetch_dingtalk_preentry_details = Mock(return_value={"matched": {"employee_code": "99", "employee_name": "已匹配", "raw": {}}})
		api._stage_roster_user = Mock(side_effect=lambda user, *_args: (
			types.SimpleNamespace(import_status="无变更" if user["dingtalk_userid"] == "matched" else "待匹配"), None,
		))
		api._settings_doc = Mock(return_value=types.SimpleNamespace(db_set=Mock()))
		with patch.dict(sys.modules, {"hrms.api.dingtalk_roster_tasks": self.tasks}):
			result = self.tasks.run_roster_comparison("Company A", "SYNC-1")
		self.assertEqual(result["employee_count"], 2)
		self.assertEqual(result["unchanged"], 1)
		self.assertEqual(result["pending_match"], 1)
		self.assertEqual({call.args[0]["dingtalk_userid"] for call in api._stage_roster_user.call_args_list}, {"old", "matched"})
		self.assertEqual(api.frappe.db.commit.call_count, 2)

	def test_non_terminal_self_repeating_onjob_cursor_is_rejected(self):
		self.api._dingtalk_api_request = Mock(side_effect=[
			{"result": {"data_list": ["one"], "next_cursor": "50"}},
			{"result": {"data_list": ["two"], "next_cursor": 50}},
		])
		with self.assertRaises(ValueError):
			self.api._fetch_dingtalk_onjob_userids()


if __name__ == "__main__":
	unittest.main()
