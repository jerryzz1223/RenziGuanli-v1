import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("organization_scope", Path(__file__).parents[1] / "hrms/utils/organization_scope.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OrganizationScopeTest(unittest.TestCase):
	def test_merge_is_inherited_only_within_same_department_branch(self):
		def node(dept, parent="", aliases=()):
			return {"config": {"department": dept, "roster_department_alias_labels": aliases}, "parent": parent}
		graph = {"root": node("D"), "merge": node("D", "root", ["业务"]),
			"child": node("D", "merge"), "sibling": node("D", "root"), "other": node("X", "merge")}
		scopes = module.department_scopes(graph, [{"name": "B", "department_name": "业务"}])
		self.assertEqual(scopes["child"], {"D", "B"})
		self.assertEqual(scopes["sibling"], {"D"})
		self.assertEqual(scopes["other"], {"X"})

	def test_ambiguous_missing_aliases_and_cycles_do_not_expand_scope(self):
		graph = {"A": {"config": {"department": "D", "roster_department_alias_labels": ["重复", "不存在"]}, "parent": "A"}}
		departments = [{"name": x, "department_name": "重复"} for x in ("B", "C")]
		self.assertEqual(module.department_scopes(graph, departments)["A"], {"D"})
