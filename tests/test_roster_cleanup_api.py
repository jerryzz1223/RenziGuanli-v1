"""Verify roster clearing deletes every company Employee atomically."""

import ast
from collections import OrderedDict
from contextlib import nullcontext
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "hrms/api/data_operations.py"
MODULES = ("attendance", "payroll", "form_intake", "personnel_changes", "dingtalk", "employees")


class RosterCleanupTests(unittest.TestCase):
	def setUp(self):
		# A-2 is already hidden from the visible roster.
		self.employees = {"A-1": ["A", 0], "A-2": ["A", 1], "B-1": ["B", 0]}
		self.education = {"A-1": "初中及以下", "B-1": "初中及以下"}
		self.attendance = {"A-check": "A", "B-check": "B"}
		self.blockers = []
		self.submitted_warnings = []
		self.fail_on = None
		self.saved = {}
		self.savepoints = []
		self.db = SimpleNamespace(
			exists=lambda doctype, name: doctype == "Company" and name in {"A", "B"},
			count=lambda doctype, filters=None: sum(
				owner == filters["company"] if filters else True
				for owner, _excluded in self.employees.values()
			),
			sql=lambda _query, as_list=False: [(company,) for company in sorted({owner for owner, _excluded in self.employees.values()})],
			get_value=lambda doctype, name, field: self.employees[name][0] if field == "company" else self.education.get(name),
			set_value=self.set_value,
			savepoint=self.savepoint, rollback=self.rollback,
		)
		self.frappe = SimpleNamespace(
			in_test=False, session=SimpleNamespace(user="Administrator"),
			PermissionError=PermissionError,
			get_roles=lambda user: ["System Manager"],
			get_doc=self.get_doc, delete_doc=self.delete_doc,
			throw=lambda message, *args: (_ for _ in ()).throw(ValueError(message)),
			db=self.db,
		)
		tree = ast.parse(SOURCE.read_text())
		names = {
			"_require_system_manager", "_require_company", "_plan_token", "_selected_records",
			"_roster_cleanup_plan", "_prepare_promotion_employee_for_cleanup",
			"preview_company_roster_cleanup", "execute_company_roster_cleanup",
			"preview_all_employee_roster_cleanup", "execute_all_employee_roster_cleanup",
		}
		functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
		for function in functions:
			function.decorator_list = []
		self.api = {
			"frappe": self.frappe, "_": lambda text: text, "OrderedDict": OrderedDict,
			"hashlib": hashlib, "json": json, "ROSTER_CLEANUP_MODULES": MODULES,
			"nullcontext": nullcontext, "legacy_migration": nullcontext,
			"CLEANUP_RECORD_LABELS": {"Employee": "员工主档", "HRMS Attendance Exception": "考勤异常"},
			"BULK_CLEANUP_DOCTYPES": {"HRMS Attendance Exception"},
			"_records_by_module": self.records_by_module,
			"_attached_file_names": lambda records: [],
			"_submitted_personnel_warnings": lambda records: self.submitted_warnings,
			"_employee_link_blockers": lambda company, records: self.blockers,
			"_bulk_delete_cleanup_docs": self.bulk_delete,
		}
		exec(compile(ast.Module(body=functions, type_ignores=[]), str(SOURCE), "exec"), self.api)

	def records_by_module(self, company, module_keys):
		self.assertEqual(set(module_keys), set(MODULES))
		return OrderedDict((module, OrderedDict(
			[("HRMS Attendance Exception", [name for name, owner in self.attendance.items() if owner == company])]
			if module == "attendance" else
			[("Employee", [name for name, (owner, _excluded) in self.employees.items() if owner == company])]
			if module == "employees" else []
		)) for module in MODULES)

	def savepoint(self, name):
		self.saved[name] = (dict(self.attendance), {key: row[:] for key, row in self.employees.items()})
		self.savepoints.append(name)

	def rollback(self, save_point):
		self.assertIn(save_point, self.saved)
		self.attendance, self.employees = self.saved[save_point]

	def bulk_delete(self, doctype, names):
		self.assertEqual(doctype, "HRMS Attendance Exception")
		for name in names:
			self.attendance.pop(name)
		return len(names)

	def get_doc(self, doctype, name):
		self.assertEqual(doctype, "Employee")
		self.assertIn(name, self.employees)
		return SimpleNamespace(flags=SimpleNamespace(), docstatus=0)

	def delete_doc(self, doctype, name, ignore_permissions=False, delete_permanently=False):
		self.assertEqual(doctype, "Employee")
		self.assertTrue(ignore_permissions)
		self.assertTrue(delete_permanently)
		if name == self.fail_on:
			raise RuntimeError("simulated delete failure")
		self.employees.pop(name)

	def set_value(self, doctype, name, field, value, update_modified=False):
		self.assertEqual((doctype, field, value, update_modified), ("Employee", "custom_education_level", "初中", False))
		self.education[name] = value

	def test_preview_and_execution_delete_hidden_and_visible_employees(self):
		preview = self.api["preview_company_roster_cleanup"]("A")
		self.assertEqual((preview["count"], preview["employee_count"]), (3, 2))
		self.assertEqual(len(preview["plan_token"]), 64)
		result = self.api["execute_company_roster_cleanup"]("A", preview["confirmation_text"], preview["plan_token"])
		self.assertEqual(result["employee_count"], 2)
		self.assertEqual(self.employees, {"B-1": ["B", 0]})
		self.assertEqual(self.attendance, {"B-check": "B"})
		self.assertFalse(self.frappe.in_test)

	def test_button_endpoint_clears_all_companies_in_one_confirmed_plan(self):
		preview = self.api["preview_all_employee_roster_cleanup"]()
		self.assertEqual((preview["employee_count"], preview["count"]), (3, 5))
		self.assertEqual([item["company"] for item in preview["companies"]], ["A", "B"])
		result = self.api["execute_all_employee_roster_cleanup"](preview["confirmation_text"], preview["plan_token"])
		self.assertEqual((result["employee_count"], result["count"]), (3, 5))
		self.assertEqual(self.employees, {})
		self.assertEqual(self.attendance, {})

	def test_all_company_failure_restores_the_first_company(self):
		preview = self.api["preview_all_employee_roster_cleanup"]()
		self.fail_on = "B-1"
		with self.assertRaisesRegex(RuntimeError, "simulated delete failure"):
			self.api["execute_all_employee_roster_cleanup"](preview["confirmation_text"], preview["plan_token"])
		self.assertEqual(set(self.employees), {"A-1", "A-2", "B-1"})
		self.assertEqual(set(self.attendance), {"A-check", "B-check"})

	def test_wrong_confirmation_and_stale_token_do_not_write(self):
		preview = self.api["preview_company_roster_cleanup"]("A")
		with self.assertRaisesRegex(ValueError, "确认文本不匹配"):
			self.api["execute_company_roster_cleanup"]("A", "wrong", preview["plan_token"])
		self.employees["A-3"] = ["A", 0]
		with self.assertRaisesRegex(ValueError, "花名册已变化"):
			self.api["execute_company_roster_cleanup"]("A", preview["confirmation_text"], preview["plan_token"])
		self.assertEqual(self.savepoints, [])

	def test_external_link_blocks_deletion(self):
		self.blockers = [{"doctype": "Salary Slip", "count": 1, "label": "工资单"}]
		preview = self.api["preview_company_roster_cleanup"]("A")
		self.assertEqual(preview["linked_blockers"], self.blockers)
		with self.assertRaisesRegex(ValueError, "未纳入清理范围"):
			self.api["execute_company_roster_cleanup"]("A", preview["confirmation_text"], preview["plan_token"])
		self.assertEqual(self.savepoints, [])

	def test_submitted_personnel_documents_are_disclosed_in_preview(self):
		self.submitted_warnings = [{"doctype": "Employee Promotion", "count": 1, "label": "员工晋升"}]
		preview = self.api["preview_company_roster_cleanup"]("A")
		self.assertEqual(preview["warnings"], self.submitted_warnings)
		self.assertEqual(preview["blockers"], [])

	def test_legacy_education_is_normalized_only_for_same_company_promotion(self):
		prepare = self.api["_prepare_promotion_employee_for_cleanup"]
		prepare("A", SimpleNamespace(employee="A-1"))
		self.assertEqual(self.education["A-1"], "初中")
		with self.assertRaisesRegex(ValueError, "不属于当前公司"):
			prepare("A", SimpleNamespace(employee="B-1"))
		self.assertEqual(self.education["B-1"], "初中及以下")

	def test_failure_rolls_back_business_data_and_employees(self):
		preview = self.api["preview_company_roster_cleanup"]("A")
		self.fail_on = "A-2"
		with self.assertRaisesRegex(RuntimeError, "simulated delete failure"):
			self.api["execute_company_roster_cleanup"]("A", preview["confirmation_text"], preview["plan_token"])
		self.assertIn("A-1", self.employees)
		self.assertIn("A-2", self.employees)
		self.assertIn("A-check", self.attendance)
		self.assertFalse(self.frappe.in_test)


if __name__ == "__main__":
	unittest.main()
