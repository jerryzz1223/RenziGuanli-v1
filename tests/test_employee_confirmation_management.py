"""Exercise candidate precedence, permissions, pagination and draft side effects."""
import importlib.util
from datetime import date
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import Mock, patch


class Row(dict):
	__getattr__ = dict.__getitem__


class ConfirmationTests(unittest.TestCase):
	def setUp(self):
		self.employee = Row(name="EMP-1", employee_name="测试员工", status="Active", company="测试公司", department="生产部", custom_work_nature="在职·试用期", custom_is_confirmed="否", final_confirmation_date="2026-11-01")
		self.employee.check_permission = Mock()
		self.insert = Mock()
		self.created = []
		def get_doc(*args):
			if len(args) == 2:
				return self.employee
			self.created.append(args[0])
			return SimpleNamespace(name="CONF-1", insert=self.insert)
		def reject(message):
			raise ValueError(message)
		self.frappe = SimpleNamespace(whitelist=lambda: lambda fn: fn, _=lambda s: s, has_permission=Mock(), get_meta=lambda _: SimpleNamespace(has_field=lambda _: True), get_list=Mock(return_value=[self.employee]), get_doc=get_doc, throw=reject)
		utils = SimpleNamespace(cint=lambda n: int(n or 0), getdate=lambda n: date.fromisoformat(str(n)), nowdate=lambda: "2026-10-30")
		patcher = patch.dict(sys.modules, {"frappe": self.frappe, "frappe.utils": utils})
		patcher.start()
		self.addCleanup(patcher.stop)
		spec = importlib.util.spec_from_file_location("employee_confirmation", Path(__file__).resolve().parents[1] / "hrms/api/employee_confirmation.py")
		self.module = importlib.util.module_from_spec(spec)
		spec.loader.exec_module(self.module)

	def test_candidate_precedence_and_inactive_exclusion(self):
		cases = [
			({"status": "Left"}, False),
			({"custom_work_nature": "在职·正式"}, False),
			({"custom_work_nature": "待离职"}, False),
			({"custom_work_nature": "", "custom_is_confirmed": "是"}, False),
			({"custom_work_nature": "", "custom_is_confirmed": "", "final_confirmation_date": "2026-11-01"}, True),
			({"custom_work_nature": "", "custom_is_confirmed": "", "final_confirmation_date": "2026-10-30"}, False),
			({"custom_work_nature": "", "custom_is_confirmed": "否"}, True),
			({"custom_work_nature": "", "custom_is_confirmed": "", "employment_type": "Probation"}, True),
		]
		for updates, expected in cases:
			with self.subTest(updates=updates):
				self.assertEqual(self.module.is_pending_confirmation({**self.employee, **updates}), expected)

	def test_permission_scoped_search_and_paging(self):
		self.frappe.get_list.return_value = [Row(self.employee, name=f"EMP-{i}") for i in range(25)]
		result = self.module.get_candidates(company="测试公司", search="生产部", start=20)
		self.assertEqual(result["total"], 25)
		self.assertEqual(len(result["rows"]), 5)
		self.frappe.has_permission.assert_called_once_with("Employee", "read", throw=True)
		self.assertEqual(self.frappe.get_list.call_args.kwargs["filters"], {"status": "Active", "company": "测试公司"})
		self.assertEqual(self.module.get_candidates(search="不存在")["total"], 0)
		self.frappe.has_permission.side_effect = PermissionError
		with self.assertRaises(PermissionError):
			self.module.get_candidates()

	def create(self, result="转正通过", notes="已完成面谈"):
		return self.module.create_draft("EMP-1", "2026-10-30", "2026-10-30", notes, result)

	def test_pass_creates_draft_with_confirmation_history_without_submitting(self):
		self.assertEqual(self.create(), "CONF-1")
		self.frappe.has_permission.assert_called_with("Employee Promotion", "create", throw=True)
		self.employee.check_permission.assert_called_once_with("read")
		self.insert.assert_called_once_with()
		payload = self.created[0]
		self.assertEqual(payload["custom_is_confirmation_interview"], 1)
		self.assertEqual([row["new"] for row in payload["promotion_details"]], ["是", "2026-10-30"])
		self.assertNotIn("docstatus", payload)
		self.assertEqual(self.employee.custom_is_confirmed, "否")

	def test_rejection_and_invalid_inputs(self):
		self.create(result="转正不通过")
		self.assertEqual(self.created[0]["promotion_details"], [])
		for kwargs in [{"result": "无效"}, {"notes": "  "}]:
			with self.assertRaises(ValueError):
				self.create(**kwargs)
		self.employee["status"] = "Left"
		with self.assertRaises(ValueError):
			self.create()
		self.assertEqual(len(self.created), 1)


if __name__ == "__main__":
	unittest.main()
