"""Focused contract tests for the unified, read-only approval index."""

import ast
import json
from pathlib import Path
from types import SimpleNamespace
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "hrms/api/approval_center.py"


class Row(dict):
	__getattr__ = dict.get


class ApprovalCenterTests(unittest.TestCase):
	def setUp(self):
		self.rows = {
			"HRMS Announcement": [
				Row(name="A-1", status="审核通过", subject="已批准公告", reviewer_user="approver@example.com", reviewer_name="审批人甲", reviewed_on="2026-09-30 10:00:00", submitted_on="2026-09-29 10:00:00", creation="2026-09-29 09:00:00"),
				Row(name="A-2", status="审核驳回", subject="驳回公告", creation="2026-09-29 09:00:00"),
				Row(name="A-3", status="待审核", subject="待办公告", submitted_on="2026-09-30 09:00:00", creation="2026-09-30 08:00:00"),
			],
			"Workflow Action": [Row(name="W-1", user="approver@example.com", status="Open", reference_doctype="Expense Claim", reference_name="EXP-1", creation="2026-09-30 08:00:00")],
		}
		self.denied = set()
		self.frappe = SimpleNamespace(
			session=SimpleNamespace(user="approver@example.com"), PermissionError=PermissionError,
			get_roles=lambda user: ["HR Manager"],
			has_permission=lambda doctype, permission, name=None: doctype in self.rows and doctype not in self.denied or doctype == "Expense Claim" and doctype not in self.denied,
			get_list=self.get_list, get_all=lambda *args, **kwargs: [],
			throw=lambda message, *args: (_ for _ in ()).throw(ValueError(message)),
			whitelist=lambda: lambda function: function,
		)
		tree = ast.parse(SOURCE.read_text())
		selected = [node for node in tree.body if isinstance(node, (ast.Assign, ast.FunctionDef))]
		for node in selected:
			if isinstance(node, ast.FunctionDef):
				node.decorator_list = []
		self.api = {"frappe": self.frappe, "cint": int, "json": json, "has_hrms_capability": lambda key: True}
		exec(compile(ast.Module(body=selected, type_ignores=[]), str(SOURCE), "exec"), self.api)

	def get_list(self, doctype, filters, **kwargs):
		self.assertNotIn(doctype, self.denied)
		return [row for row in self.rows.get(doctype, []) if all(
			row.get(key) in value[1] if isinstance(value, list) and value[0] == "in" else row.get(key) == value
			for key, value in filters.items()
		)]

	def test_approved_contains_only_passing_records_and_real_reviewer(self):
		items = self.api["list_approvals"]("approved")["items"]
		self.assertEqual([item["name"] for item in items], ["A-1"])
		self.assertEqual(items[0]["approved_by_name"], "审批人甲")
		self.assertEqual(items[0]["approved_on"], "2026-09-30 10:00:00")
		self.assertEqual(items[0]["route"], ["announcement-approval-records", "A-1"])

	def test_pending_combines_business_and_workflow_tasks_with_read_check(self):
		items = self.api["list_approvals"]("pending")["items"]
		self.assertEqual({item["name"] for item in items}, {"A-3", "EXP-1"})
		self.assertEqual(next(item["route"] for item in items if item["name"] == "A-3"), ["announcement-approval", "A-3"])
		self.denied.add("Expense Claim")
		items = self.api["list_approvals"]("pending")["items"]
		self.assertEqual([item["name"] for item in items], ["A-3"])

	def test_monthly_final_history_keeps_only_approved_events_once(self):
		notes = json.dumps({"attendance_processing_center": {"monthly_final_approval_history": [
			{"action": "已批准", "snapshot_version": "v1", "operator": "manager@example.com", "occurred_on": "2026-09-29 12:00:00"},
			{"action": "已驳回", "snapshot_version": "v2", "operator": "manager@example.com", "occurred_on": "2026-09-30 12:00:00"},
		]}})
		self.rows["HRMS Attendance Import Batch"] = [
			Row(name=name, company="永新", attendance_month="2026-09", source_type="attendance_draft", notes=notes, creation="2026-09-29 09:00:00")
			for name in ("B-1", "B-2")
		]
		items = self.api["list_approvals"]("approved")["items"]
		monthly = [item for item in items if item["type"] == "月度考勤终稿"]
		self.assertEqual(len(monthly), 1)
		self.assertEqual(monthly[0]["approved_by"], "manager@example.com")
		self.assertEqual(monthly[0]["approved_on"], "2026-09-29 12:00:00")

	def test_approved_history_can_be_paged(self):
		self.rows["HRMS Announcement"] = [
			Row(name=f"A-{index}", status="审核通过", subject=f"公告 {index}", reviewer_user="manager@example.com", reviewer_name="审批人",
				 reviewed_on=f"2026-09-30 10:{index:02d}:00", creation="2026-09-29 09:00:00")
			for index in range(4)
		]
		first = self.api["list_approvals"]("approved", 2, 0)
		second = self.api["list_approvals"]("approved", 2, 2)
		self.assertEqual([item["name"] for item in first["items"]], ["A-3", "A-2"])
		self.assertTrue(first["has_more"])
		self.assertEqual([item["name"] for item in second["items"]], ["A-1", "A-0"])
		self.assertFalse(second["has_more"])


if __name__ == "__main__":
	unittest.main()
