"""Real Frappe API and export tests; all writes rolled back."""
import copy
import io
import json
import frappe
from openpyxl import load_workbook
from hrms.api import organization_assignment_review as review, organization_package as package
from hrms.api.organization_roster_sync import reconcile
from hrms.api.organization_template import reconcile_bindings


def run():
	from inspect import signature, Parameter
	assert all(p.annotation != Parameter.empty for p in signature(review.save_review).parameters.values())
	chart = package.chart_module()
	fields = ["name", "employee_name", "department", "designation", "status"]
	before = frappe.get_all("Employee", fields=fields, order_by="name")
	def fails(fn, text):
		try: fn()
		except frappe.ValidationError as exc: assert text in str(exc), str(exc)
		else: raise AssertionError("expected validation: " + text)
	def cards():
		root = chart._build_manual_organization_tree("永新", chart._get_manual_organization_records("永新"))
		def walk(node):
			yield node
			for child in node.get("children", []): yield from walk(child)
		return {n["node_id"]: n for n in walk(root)}
	try:
		from scripts.review_organization_source_roles import run as correct
		correct()
		assert correct()["changed"] == 0
		continuous = review.get_review("永新", "MANUAL-4518FDF821")
		assert len(continuous["rows"]) == 2 and all(r["leader"] and r["assignment_type"] != "代理人" for r in continuous["rows"])
		assert continuous["source_cell"] == "J13"
		assert cards()["organization_node:MANUAL-4518FDF821"]["assignment_issues"]
		assert any("课长（代）：李旭" == line for line in cards()["organization_node:MANUAL-4518FDF821"]["lines"])
		print("PASS: J13 two holders remain pending; acting post is not a proxy")
		node = "MANUAL-2CB928C171"  # Source DL18, confirmed 王传瑞 in two branches.
		view = review.get_review("永新", node)
		assert view["rows"][0]["assignment_type"] == "待确认"
		assert {p["name"] for p in view["related_assignments"][0]["positions"]} >= {"试验组", "客服组"}
		rows = [{"employee": "1302", "role": "组长", "assignment_type": "正式", "leader": 1, "reference_index": 0},
			{"employee": "1302", "role": "培训负责人", "assignment_type": "兼任"},
			{"employee": "43", "role": "协调员", "assignment_type": "兼任", "display_only": 1}]
		fails(lambda: review.save_review("永新", node, view["modified"], rows + [rows[0]]), "重复")
		wrong = copy.deepcopy(rows); wrong[2]["display_only"] = 0
		fails(lambda: review.save_review("永新", node, view["modified"], wrong), "不属于本部门")
		result = review.save_review("永新", node, view["modified"], rows)
		assert result["assigned"] == 1
		second = review.get_review("永新", "MANUAL-D6887876B4")
		second_rows = copy.deepcopy(second["rows"])
		assert second_rows[0]["assignment_type"] == "待确认"
		second_rows[0]["assignment_type"] = "正式"
		fails(lambda: review.save_review("永新", second["node_name"], second["modified"], second_rows), "正式职位不唯一")
		second_rows[0]["assignment_type"] = "待确认"
		pending = review.save_review("永新", second["node_name"], second["modified"], second_rows)
		assert pending["assigned"] == 1 and pending["pending"] == 1
		print("PASS: 王传瑞 keeps both placements; second confirmed formal post blocked; pending duty still counts once")
		fails(lambda: review.save_review("永新", node, view["modified"], rows), "记录已变化")
		reconcile("永新")
		card = cards()["organization_node:" + node]
		assert card["current_headcount"] >= 1
		assert any("组长（正式）、培训负责人（兼）：王传瑞" == line for line in card["lines"]), card["lines"]
		assert "协调员（兼）：杨玉婷" in card["lines"]
		cfg = chart._manual_node_config(frappe.get_doc("Organization Node", node).source_text)
		assert cfg["assigned_employees"] == ["1302"] and cfg["assignment_rules_manual"]
		assert all(b["manual_confirmed"] for b in cfg["template_bindings"])
		file = package.export_configuration("永新")
		data = package.read_package(file["file_url"])
		plan = package.prepare("永新", data)
		assert not plan["errors"], plan["errors"]
		bad = copy.deepcopy(data)
		target_id = next(n.manual_config.get("portable_id") or n.node_code for n in chart._get_manual_organization_records("永新")["nodes"] if n.name == second["node_name"])
		for row in bad["人员任职"]:
			if row["node"] == target_id and row["type"] == "原表人员" and row["code"] == "1302": row.update(manual_confirmed="1", assignment_type="正式")
		assert any("正式职位不唯一" in e for e in package.prepare("永新", bad)["errors"])
		assert any(row.get("assignment_type") == "待确认" and row["node"] == target_id for row in data["人员任职"])
		package.apply_configuration("永新", file["file_url"], plan["fingerprint"])
		reconcile("永新")
		assert cards()["organization_node:" + node]["lines"] == card["lines"]
		cfg = chart._manual_node_config(frappe.get_doc("Organization Node", node).source_text)
		assert cfg["assignment_rules_manual"] and all(b["manual_confirmed"] for b in cfg["template_bindings"])
		# Structural edits preserve individual duties.
		chart.save_manual_organization_node(cfg["node_kind"], company="永新", node_name=node, department=cfg["department"], parent_node=frappe.db.get_value("Organization Node",node,"parent_node"), display_name="试验组", roster_subset=1, assigned_employees=cfg["assigned_employees"], primary_employee=cfg["primary_employee"])
		assert chart._manual_node_config(frappe.get_doc("Organization Node",node).source_text)["template_bindings"] == cfg["template_bindings"]
		print("PASS: same person with multiple duties, cross-department display excluded from members, XLSX and structural edits preserve manual decisions")
		staff = chart._get_active_employees("永新")
		unknown = reconcile_bindings({"department": "品保课", "template_bindings": [{"source_name": "王传瑞", "role": "组长"}]}, staff)
		assert unknown["assigned_employees"] == []
		frappe.db.set_value("Employee", "1302", "status", "Left")
		reconcile("永新")
		cfg = chart._manual_node_config(frappe.get_doc("Organization Node",node).source_text)
		assert not cfg["assigned_employees"] and cfg["primary_employee"] is None
		assert all(b.get("issue") for b in cfg["template_bindings"] if b.get("employee") == "1302")
		assert any(i["node_name"] == node for i in review.assignment_issues(chart._get_manual_organization_records("永新")["nodes"], chart._get_active_employees("永新")))
		print("PASS: no name-based replacement; leaving employees retain unresolved references and lose active allocation")
	finally:
		frappe.db.rollback()
		assert frappe.get_all("Employee", fields=fields, order_by="name") == before
		print("PASS: all writes rolled back")
