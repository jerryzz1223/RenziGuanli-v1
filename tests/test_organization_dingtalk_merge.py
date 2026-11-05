import importlib.util
import json
import sys
import types
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import Mock, patch


def load():
	frappe = types.ModuleType("frappe")
	frappe.whitelist = lambda **kwargs: lambda fn: fn
	utils = types.ModuleType("frappe.utils")
	utils.now_datetime = lambda: "2026-11-04"
	integration = types.ModuleType("hrms.api.dingtalk_integration")
	package = types.ModuleType("hrms.api.organization_package")
	package.authorize = Mock()
	package.chart_module = Mock()
	package.version_options = Mock()
	api = types.ModuleType("hrms.api")
	api.dingtalk_integration = integration
	with patch.dict(sys.modules, {"frappe": frappe, "frappe.utils": utils, "hrms": types.ModuleType("hrms"),
		"hrms.api": api, "hrms.api.dingtalk_integration": integration, "hrms.api.organization_package": package}):
		spec = importlib.util.spec_from_file_location("linkage", Path(__file__).resolve().parents[1] / "hrms/api/organization_dingtalk_linkage.py")
		module = importlib.util.module_from_spec(spec)
		spec.loader.exec_module(module)
	return module


def node(name, label, parent=None):
	return {"name": name, "display_name": label, "parent_node": parent, "confirmation_status": "已确认",
		"source_text": json.dumps({"manual_organization": True, "node_kind": "部门", "department": "D-" + name})}


class MergeTests(unittest.TestCase):
	def setUp(self):
		self.api = load()
		self.source = {"connection": "C", "rows": [
			{"external_id": "2", "department_name": "生产", "parent_id": "1"},
			{"external_id": "3", "department_name": "一组", "parent_id": "2"}]}
		self.current = {"nodes": [], "departments": [], "options": {}}

	def test_first_import_parent_order_and_default_keep(self):
		self.source["rows"].reverse()
		plan = self.api.build_plan(self.source, self.current)
		self.assertTrue(plan["initial"])
		self.assertEqual([r["external_id"] for r in plan["rows"]], ["2", "3"])
		self.assertTrue(all(r["decision"] == "keep" for r in plan["rows"]))

	def test_manual_changes_are_reported_and_input_is_unchanged(self):
		self.current.update(nodes=[node("A", "人工名称")], departments=[{"name": "D-A", "department_name": "生产"}],
			options={"dingtalk_organization_connection": "C", "dingtalk_department_maps": {
				"2": {"node": "A", "baseline": {"display_name": "生产", "parent_node": None}}}})
		before = deepcopy(self.current)
		plan = self.api.build_plan(self.source, self.current)
		self.assertTrue(plan["rows"][0]["manual_changes"])
		self.assertEqual(plan["rows"][0]["node"], "A")
		self.assertEqual(self.current, before)

	def test_missing_source_is_reported_without_delete(self):
		self.current["options"] = {"dingtalk_organization_connection": "C", "dingtalk_department_maps": {"99": {"node": "X"}}}
		self.assertEqual(self.api.build_plan(self.source, self.current)["missing_source"], ["99"])

	def test_duplicate_ids_missing_parents_cycles_and_empty_sources_rejected(self):
		for rows in ([], self.source["rows"] * 2,
			[{"external_id": "2", "department_name": "A", "parent_id": "99"}],
			[{"external_id": "2", "department_name": "A", "parent_id": "3"}, {"external_id": "3", "department_name": "B", "parent_id": "2"}]):
			with self.assertRaises(ValueError): self.api.validate_source(rows)

	def test_new_parent_must_be_selected(self):
		rows = self.api.build_plan(self.source, self.current)["rows"]
		with self.assertRaises(ValueError): self.api.validate_final_graph(self.current, rows, {"3": "source"})
		graph = self.api.validate_final_graph(self.current, rows, {"2": "source", "3": "source"})
		self.assertEqual(graph["new:3"], "new:2")

	def test_partial_merge_cycle_with_manual_edges_rejected(self):
		current = {"nodes": [node("A", "A", "B"), node("B", "B")]}
		rows = [{"external_id": "2", "node": "A", "parent_id": "1"}, {"external_id": "3", "node": "B", "parent_id": "2"}]
		with self.assertRaises(ValueError): self.api.validate_final_graph(current, rows, {"3": "source"})
		self.api.validate_final_graph(current, rows, {"2": "source", "3": "source"})

	def test_other_company_target_or_other_connection_rejected(self):
		with self.assertRaises(ValueError): self.api.build_plan(self.source, self.current, {"2": "foreign"})
		self.current["options"] = {"dingtalk_organization_connection": "OTHER", "dingtalk_department_maps": {"2": {"node": "A"}}}
		with self.assertRaises(ValueError): self.api.build_plan(self.source, self.current)

	def test_duplicate_source_name_cannot_share_one_department(self):
		self.source["rows"][1]["department_name"] = "生产"
		self.current["departments"] = [{"name": "D", "department_name": "生产"}]
		with self.assertRaises(ValueError): self.api.build_plan(self.source, self.current)

	def test_unknown_or_repeated_binding_rejected(self):
		with self.assertRaises(ValueError): self.api.build_plan(self.source, self.current, {"99": "X"})
		self.current.update(nodes=[node("A", "A")], departments=[{"name": "D-A", "department_name": "A"}])
		with self.assertRaises(ValueError): self.api.build_plan(self.source, self.current, {"2": "A", "3": "A"})

	def test_explicit_new_suppresses_name_candidate(self):
		self.current.update(nodes=[node("A", "生产")], departments=[{"name": "D-A", "department_name": "生产"}])
		self.assertEqual(self.api.build_plan(self.source, self.current)["rows"][0]["node"], "A")
		self.assertFalse(self.api.build_plan(self.source, self.current, {"2": "__new__"})["rows"][0]["node"])

	def test_failed_response_shape_is_not_treated_as_empty_branch(self):
		self.api.integration._dingtalk_api_request = Mock(return_value={})
		self.api.integration.DINGTALK_DEPARTMENT_LIST_PATH = "/fixture"
		with self.assertRaises(ValueError): self.api.pull_source()

	def test_source_hash_is_stable_but_changes_when_local_data_changes(self):
		self.assertEqual(self.api.digest(self.current), self.api.digest(deepcopy(self.current)))
		before = self.api.digest(self.current)
		self.current["nodes"].append(node("A", "A"))
		self.assertNotEqual(before, self.api.digest(self.current))


if __name__ == "__main__": unittest.main()
