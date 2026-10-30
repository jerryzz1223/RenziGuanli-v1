import importlib.util
import sys
import types
import unittest
from unittest.mock import Mock

from test_dingtalk_roster_attachments import ROOT, load_module


def load_tasks(integration):
	frappe = integration.frappe
	api = types.ModuleType("hrms.api")
	api.dingtalk_integration = integration
	modules = {"frappe": frappe, "hrms": types.ModuleType("hrms"), "hrms.api": api}
	saved = {name: sys.modules.get(name) for name in modules}
	sys.modules.update(modules)
	try:
		spec = importlib.util.spec_from_file_location("roster_tasks_test", ROOT / "hrms/api/dingtalk_roster_tasks.py")
		module = importlib.util.module_from_spec(spec)
		spec.loader.exec_module(module)
		return module
	finally:
		for name, value in saved.items():
			if value is None:
				sys.modules.pop(name, None)
			else:
				sys.modules[name] = value


class RosterTaskTests(unittest.TestCase):
	def setUp(self):
		self.api = load_module()
		self.log = types.SimpleNamespace(name="SYNC-1", company="Company A", sync_type="员工档案同步", status="已排队", save=Mock())
		self.api._require_dingtalk_employee_import_approver = Mock()
		self.api._require_api_sync_enabled = Mock(side_effect=lambda company: company)
		self.api._require_sync_company = Mock(side_effect=lambda company: company)
		self.api._new_sync_log = Mock(return_value=self.log)
		self.api._finish_sync_log = Mock()
		self.api.frappe.db = types.SimpleNamespace(sql=Mock(return_value=[]), commit=Mock(), rollback=Mock(), savepoint=Mock())
		self.api.frappe.enqueue = Mock()
		self.api.frappe.get_doc = Mock(return_value=self.log)
		self.api.frappe.throw = Mock(side_effect=ValueError)
		self.tasks = load_tasks(self.api)

	def test_queue_uses_long_worker_after_commit_without_fetching(self):
		self.api._sync_all_employee_rosters = Mock()
		result = self.tasks.queue_roster_comparison("Company A")
		self.assertEqual(result["sync_log"], "SYNC-1")
		kwargs = self.api.frappe.enqueue.call_args.kwargs
		self.assertTrue(kwargs["enqueue_after_commit"])
		self.assertEqual(kwargs["queue"], "long")
		self.assertEqual(kwargs["company"], "Company A")
		self.api._sync_all_employee_rosters.assert_not_called()
		self.api._require_dingtalk_employee_import_approver.assert_called_once()
		query, values = self.api.frappe.db.sql.call_args.args
		self.assertIn("AND error_message=%s", query, "do not reuse a new-employee approval task as a full pull")
		self.assertEqual(values[-1], self.tasks.FULL_ROSTER_TASK_MARKER)

	def test_existing_task_does_not_enqueue(self):
		self.api.frappe.db.sql.side_effect = [[], [self.log]]
		self.assertTrue(self.tasks.queue_roster_comparison("Company A")["duplicate"])
		self.api.frappe.enqueue.assert_not_called()
		self.api._new_sync_log.assert_not_called()

	def test_permission_denied_before_creating_task(self):
		self.api._require_dingtalk_employee_import_approver.side_effect = PermissionError("denied")
		with self.assertRaises(PermissionError):
			self.tasks.queue_roster_comparison("Company A")
		self.api.frappe.db.sql.assert_not_called()
		self.api.frappe.enqueue.assert_not_called()

	def test_disabled_api_does_not_enqueue(self):
		self.api._require_api_sync_enabled.side_effect = ValueError("disabled")
		with self.assertRaises(ValueError):
			self.tasks.queue_roster_comparison("Company A")
		self.api.frappe.enqueue.assert_not_called()

	def test_worker_reuses_log_and_commits_success(self):
		self.api._sync_all_employee_rosters = Mock(return_value={"received": 2})
		self.assertEqual(self.tasks.run_roster_comparison("Company A", "SYNC-1"), {"received": 2})
		self.api._sync_all_employee_rosters.assert_called_once_with("Company A", sync_log=self.log, include_directory=True)
		self.assertEqual(self.api.frappe.db.commit.call_count, 2)

	def test_completed_task_is_not_replayed_or_changed_if_configuration_changed(self):
		self.log.status = "已完成"
		self.api._require_api_sync_enabled.side_effect = ValueError("disabled")
		self.api._sync_all_employee_rosters = Mock()
		self.tasks.run_roster_comparison("Company A", "SYNC-1")
		self.api._sync_all_employee_rosters.assert_not_called()
		self.api._finish_sync_log.assert_not_called()

	def test_fatal_fetch_failure_rolls_back_and_persists_terminal_status(self):
		self.api._sync_all_employee_rosters = Mock(side_effect=ValueError("missing AgentId"))
		self.assertEqual(self.tasks.run_roster_comparison("Company A", "SYNC-1")["status"], "失败")
		self.api.frappe.db.rollback.assert_called_once_with()
		self.api._finish_sync_log.assert_called_once_with(self.log, "失败", failed=1, error_message="missing AgentId")
		self.assertEqual(self.api.frappe.db.commit.call_count, 2)

	def test_status_rejects_cross_company_or_wrong_task(self):
		for attribute, value in [("company", "Company B"), ("sync_type", "员工同步")]:
			old = getattr(self.log, attribute)
			setattr(self.log, attribute, value)
			with self.assertRaises(ValueError):
				self.tasks.get_roster_comparison_status("SYNC-1", "Company A")
			setattr(self.log, attribute, old)

	def test_status_contains_only_task_summary(self):
		self.log.records_received = 2
		self.log.records_failed = 1
		self.log.error_message = "read permission missing"
		self.log.finished_at = "2026-10-23"
		self.assertEqual(set(self.tasks.get_roster_comparison_status("SYNC-1", "Company A")),
			{"sync_log", "company", "status", "received", "failed", "error_message", "finished_at"})

	def test_initial_roster_fetch_failure_is_inside_log_error_handler(self):
		for name in ["_fetch_dingtalk_onjob_userids", "_fetch_dingtalk_preentry_details"]:
			self.api._finish_sync_log.reset_mock()
			self.api._fetch_dingtalk_onjob_userids = Mock(return_value=["u1"])
			self.api._fetch_dingtalk_preentry_details = Mock(return_value={})
			getattr(self.api, name).side_effect = ValueError("fetch failed")
			with self.assertRaises(ValueError):
				self.api._sync_all_employee_rosters("Company A", sync_log=self.log)
			self.assertEqual(self.api._finish_sync_log.call_args.args[1], "失败")
			self.api._new_sync_log.assert_not_called()

	def test_bad_row_rolls_back_its_partial_writes_then_continues(self):
		self.api._fetch_dingtalk_onjob_userids = Mock(return_value=["bad", "good"])
		self.api._fetch_dingtalk_preentry_details = Mock(return_value={"bad": {}, "good": {"employee_code": "2"}})
		# A failure after raw staging must not leave an incomplete row committed.
		self.api._fetch_dingtalk_preentry_details.return_value["bad"] = {"employee_code": "1"}
		self.api._stage_roster_user = Mock(side_effect=[ValueError("mapping failed"), (types.SimpleNamespace(import_status="无变更"), None)])
		self.api._settings_doc = Mock(return_value=types.SimpleNamespace(db_set=Mock()))
		result = self.api._sync_all_employee_rosters("Company A", sync_log=self.log)
		self.assertEqual((result["received"], result["failed"], result["unchanged"]), (2, 1, 1))
		self.api.frappe.db.rollback.assert_called_once_with(save_point="dingtalk_roster_row")
		self.assertEqual(self.api._finish_sync_log.call_args.args[1], "部分失败")


if __name__ == "__main__":
	unittest.main()
