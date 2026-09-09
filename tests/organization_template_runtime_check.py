"""Restore and exercise the source-linked groups in a rolled-back transaction."""
import json
import frappe


def run():
	from scripts.restore_organization_template import run as restore
	from hrms.api.organization_roster_sync import reconcile
	from hrms.hr.page.organizational_chart import organizational_chart as chart
	before = frappe.get_all("Employee", fields=["name", "employee_name", "department", "designation", "status"], order_by="name")
	node_count = frappe.db.count("Organization Node")
	try:
		result = restore(apply=True, commit=False)
		assert result["groups_and_roles"] == 97
		assert reconcile("永新")["changed"] == 0
		manual = chart._get_manual_organization_records("永新")
		template = {n.manual_config["template_source_cell"]: n for n in manual["nodes"] if n.manual_config.get("template_source_cell")}
		assert len(template) == 97
		assert template["X18"].manual_config["department"] == "连续课"
		assert template["DG23"].parent_node == template["DG21"].name
		assert template["BW23"].manual_config["department"] == "工程课"
		assert "王晶" in [b["source_name"] for b in template["BM18"].manual_config["template_bindings"] if "代" in b["role"]]
		assert any(b["source_name"] == "马勇" and b.get("employee") for b in template["H23"].manual_config["template_bindings"])
		def cards():
			root = chart._build_manual_organization_tree("永新", chart._get_manual_organization_records("永新"))
			def walk(n):
				yield n
				for c in n.get("children", []): yield from walk(c)
			return root, list(walk(root))
		root, all_cards = cards()
		shown = {p["employee"] for c in all_cards for p in c.get("people", []) if p.get("matched_employee")}
		active = {e.name for e in before if e.status == "Active"}
		assert shown == active, (len(shown), len(active), sorted(active-shown))
		assert root["current_headcount"] == len(active)
		quality = next(c for c in all_cards if c.get("name") == "品管课")
		assert "课长：穆敏敏" in quality["lines"], quality["lines"]
		assert any("组长（代）：牟俊" in c["lines"] for c in all_cards if c.get("template_source_cell") == "M18")
		assert next(e for e in before if e.employee_name == "穆敏敏").designation == "副理"
		unit = next(n for n in manual["nodes"] if chart.whole_department(n.manual_config) and n.manual_config.get("department") == "环安课")
		cfg = chart._manual_node_config(frappe.get_doc("Organization Node", unit.name).source_text)
		chart.save_manual_organization_node("课", node_name=unit.name, company="永新", department="环安课", parent_node=unit.parent_node,
			primary_employee=cfg["primary_employee"], proxy_employee=cfg["proxy_employee"], roster_auto_sync=1)
		assert reconcile("永新")["changed"] == 0
		for cell in ("C18", "H18", "AN18"):
			node = template[cell]
			card = next(c for c in all_cards if c["node_id"] == "organization_node:" + node.name)
			detail = chart._get_manual_organization_node_detail(card["node_id"], card["node_type"], "永新", "")
			assert len(detail["employees"]) == card["current_headcount"]
		# Stable identity after rename; departures removed without moving other staff.
		member = template["H23"].manual_config["assigned_employees"][0]
		frappe.db.set_value("Employee", member, "employee_name", "姓名变更验证")
		reconcile("永新")
		assert any(p.get("employee") == member and p["employee_name"] == "姓名变更验证" for c in cards()[1] for p in c.get("people", []))
		frappe.db.set_value("Employee", member, {"department": "设备课", "designation": "作业员"})
		reconcile("永新")
		config = chart._manual_node_config(frappe.get_doc("Organization Node", template["H23"].name).source_text)
		assert member not in config["assigned_employees"]
		assert any(c.get("department") == "设备课" and any(p.get("employee") == member for p in c.get("people", [])) for c in cards()[1])
		frappe.db.set_value("Employee", member, "status", "Left")
		reconcile("永新")
		assert all(p.get("employee") != member for c in cards()[1] for p in c.get("people", []) if p.get("matched_employee"))
		# Manual group membership must survive subsequent automatic synchronization.
		node = template["H23"]
		chart.save_manual_organization_node("岗位", node_name=node.name, company="永新", department="连续课", parent_node=node.parent_node,
			display_name="手动分组验证", roster_subset=1, roster_auto_sync=0, assigned_employees=[])
		reconcile("永新")
		assert chart._manual_node_config(frappe.get_doc("Organization Node", node.name).source_text)["assigned_employees"] == []
		print("PASS: 97 original branches, source connectors, acting roles, all active IDs shown, group totals, rename/transfer/exit, manual override, idempotence")
	finally:
		frappe.db.rollback()
	assert frappe.db.count("Organization Node") == node_count
	assert frappe.get_all("Employee", fields=["name", "employee_name", "department", "designation", "status"], order_by="name") == before
	print("PASS: fixtures rolled back; Employee master data unchanged")


if __name__ == "__main__":
	frappe.init(site="hrms.localhost", sites_path="/home/frappe/frappe-bench/sites")
	frappe.connect(); frappe.set_user("Administrator")
	try: run()
	finally: frappe.destroy()
