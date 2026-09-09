"""Transaction-only integration checks for the unified organization navigator."""
import json
import frappe


def run():
	from hrms.hr.page.organizational_chart import organizational_chart as chart
	company = "永新"
	before = frappe.db.count("Organization Node")
	master_before = frappe.get_all("Employee", fields=["name", "department", "designation", "reports_to"], order_by="name")
	try:
		base = frappe.get_list("Department", filters={"company": company, "disabled": 0, "department_name": ["like", "%课"]}, pluck="name", limit_page_length=1)[0]
		manager = frappe.get_list("Employee", filters={"company": company, "status": "Active"}, pluck="name", limit_page_length=1)[0]
		management = chart.save_manual_organization_node("管理层", company=company, display_name="验证管理层", manager_employee=manager, role_title="总经理", assignment_mode="正式")
		scope = chart.save_manual_organization_node("分管", company=company, display_name="验证分管", parent_node=management["name"], manager_employee=manager, role_title="负责人", assignment_mode="正式")
		unit = chart.save_manual_organization_node("课", company=company, display_name="验证课", department=base, parent_node=scope["name"], planned_headcount=0, planned_headcount_set=0)
		try:
			chart.save_manual_organization_node("课", company=company, display_name="重复课", department=base, parent_node=scope["name"])
		except frappe.ValidationError: pass
		else: raise AssertionError("duplicate department accepted")
		def cards():
			tree = chart.get_hybrid_tree(company, "manual")
			result = {}
			def walk(node):
				result[node["node_id"]] = node
				for child in node.get("children", []): walk(child)
			walk(tree["root"])
			return result
		read = cards()
		unit_id = "organization_node:" + unit["name"]
		assert read[unit_id]["has_staffing_plan"] is False
		assert read["organization_node:" + scope["name"]]["current_headcount"] == read[unit_id]["current_headcount"]
		chart.save_manual_organization_node("课", company=company, node_name=unit["name"], display_name="验证课", department=base, parent_node=management["name"], planned_headcount=0, planned_headcount_set=1)
		assert cards()[unit_id]["has_staffing_plan"] is True
		detail = chart._get_manual_organization_node_detail(unit_id, "organization_section", company, "")
		assert detail["relationships"]["parent"]["name"] == management["name"]
		management_detail = chart._get_manual_organization_node_detail("organization_node:" + management["name"], "organization_management", company, "")
		assert any("总经理：" in line for line in management_detail["role_lines"])
		proxy = frappe.get_list("Employee", filters={"company": company, "status": "Active", "name": ["!=", manager]}, pluck="name", limit_page_length=1)[0]
		chart.save_manual_organization_node("管理层", company=company, node_name=management["name"], display_name="验证管理层", manager_employee=manager, proxy_employee=proxy, leadership_from_roster=1)
		management_card = cards()["organization_node:" + management["name"]]
		assert any("代理人：" in line for line in management_card["lines"])
		assert management_card["current_headcount"] == cards()[unit_id]["current_headcount"]
		management_detail = chart._get_manual_organization_node_detail("organization_node:" + management["name"], "organization_management", company, "")
		assert management_detail["role_lines"] == management_card["lines"]
		try:
			chart.save_manual_organization_node("管理层", company=company, node_name=management["name"], display_name="循环", parent_node=unit["name"])
		except frappe.ValidationError: pass
		else: raise AssertionError("cycle accepted")
		try:
			chart.save_manual_organization_node("分管", company=company, display_name="重复代理", manager_employee=manager, proxy_employee=manager)
		except frappe.ValidationError: pass
		else: raise AssertionError("same primary/proxy accepted")
		assert frappe.get_all("Employee", fields=["name", "department", "designation", "reports_to"], order_by="name") == master_before
		print("PASS: management roles, shared parent edits, deduplicated scope totals, staffing unknown/zero, cycles, proxy validation, unchanged employee master")
	finally:
		frappe.db.rollback()
	assert frappe.db.count("Organization Node") == before
	print("PASS: rolled back all navigator fixtures")


if __name__ == "__main__":
	frappe.init(site="hrms.localhost", sites_path="/home/frappe/frappe-bench/sites")
	frappe.connect()
	frappe.set_user("Administrator")
	try: run()
	finally: frappe.destroy()
