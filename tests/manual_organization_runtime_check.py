"""Run with bench Python from sites; all fixture nodes are rolled back."""
import json
import frappe


def run():
	from hrms.hr.page.organizational_chart import organizational_chart as chart
	from hrms.api.organization_roster import get_candidates
	company = "永新"
	before = frappe.db.count("Organization Node")
	try:
		base = frappe.get_list("Department", filters={"company": company, "disabled": 0, "department_name": ["like", "%课"]}, fields=["name", "department_name"], limit_page_length=1)[0]
		candidate = frappe.get_list("Employee", filters={"company": company, "status": "Active", "department": base.name}, fields=["name", "department", "designation"], limit_page_length=1)[0]
		assert candidate.designation, "fixture employee must have a roster designation"
		for args in (
			{"node_kind": "课", "company": company, "display_name": "无部门课-不保留"},
			{"node_kind": "岗位", "company": company, "department": base.name, "display_name": "无岗位节点-不保留"},
		):
			try:
				chart.save_manual_organization_node(**args)
			except frappe.ValidationError:
				pass
			else:
				raise AssertionError("missing business link accepted")
		root = chart.save_manual_organization_node("课", company=company, department=base.name, display_name="验证框架-不保留")
		roster_names = {row.name for row in get_candidates(company, base.name)["employees"]}
		for kind in chart.ROSTER_UNIT_KINDS:
			unit = frappe._dict(name="test-unit", parent_node=None, display_name="验证自动成员", planned_headcount=len(roster_names) + 2, vacancy_count=0,
				manual_config={"node_kind": kind, "department": base.name, "roster_department": "STALE-PARENT-DEPARTMENT", "assigned_employees": ["REMOVED-LEGACY-MEMBER"]})
			unit_card = chart._build_manual_organization_tree(company, {"nodes": [unit], "version": None})["children"][0]
			assert unit_card["current_headcount"] == len(roster_names), (kind, unit_card)
			assert unit_card["vacancy_count"] == 2
			assert unit_card["lines"] == []
		# Simulate a saved legacy picker, including a removed employee. Reading
		# and editing the unit must not turn these members into role holders.
		root_doc = frappe.get_doc("Organization Node", root["name"])
		legacy_config = json.loads(root_doc.source_text)
		legacy_config["assigned_employees"] = [candidate.name, "REMOVED-LEGACY-MEMBER"]
		root_doc.source_text = json.dumps(legacy_config)
		root_doc.save()
		root_detail = chart._get_manual_organization_node_detail("organization_node:" + root["name"], "organization_section", company, "")
		assert root_detail["role_lines"] == [], root_detail["role_lines"]
		assert len(root_detail["employees"]) == len(roster_names)
		assert root_detail["metrics"]["current_headcount"] == len(roster_names)
		chart.save_manual_organization_node("课", company=company, node_name=root["name"], department=base.name)
		assert json.loads(frappe.get_doc("Organization Node", root["name"]).source_text)["assigned_employees"] == []
		# No parent allocation is required for a downstream employee leaf.
		leaf = chart.save_manual_organization_node("员工", company=company, employee=candidate.name, parent_node=root["name"])
		assert leaf["name"]
		root_detail = chart._get_manual_organization_node_detail("organization_node:" + root["name"], "organization_section", company, "")
		assert root_detail["metrics"]["current_headcount"] == len(roster_names), "leaf references must not double-count unit members"
		vacant = chart.save_manual_organization_node("岗位", company=company, department=base.name, designation=candidate.designation, display_name="验证空岗位-不保留", role_title="验证课长", parent_node=root["name"], planned_headcount=2)
		assert json.loads(frappe.get_doc("Organization Node", vacant["name"]).source_text)["role_title"] == "验证课长"
		try:
			chart.save_manual_organization_node("课", company=company, node_name=root["name"], department=base.name, display_name="验证框架", parent_node=vacant["name"])
		except frappe.ValidationError:
			pass
		else:
			raise AssertionError("cycle accepted")
		master_before = frappe.db.get_value("Employee", candidate.name, ["department", "designation", "reports_to"])
		chart.save_manual_organization_node("岗位", company=company, node_name=vacant["name"], designation=candidate.designation, display_name="验证空岗位", role_title="验证课长", assignment_mode="自动", department=base.name, primary_employee=candidate.name, parent_node=root["name"], planned_headcount=2)
		detail = chart._get_manual_organization_node_detail("organization_node:" + vacant["name"], "organization_position", company, "")
		assert any("验证课长（代理）" in line for line in detail["role_lines"]), detail["role_lines"]
		assert frappe.db.get_value("Employee", candidate.name, ["department", "designation", "reports_to"]) == master_before
		assert detail["metrics"]["vacancy_count"] == 1
		chart.save_manual_organization_node("岗位", company=company, node_name=vacant["name"], designation=candidate.designation, display_name="验证代理岗位", role_title="验证课长", department=base.name, proxy_employee=candidate.name, parent_node=root["name"])
		assert frappe.get_doc("Organization Node", vacant["name"]).parent_node == root["name"]
		manual = chart._get_manual_organization_records(company)
		result = chart._build_manual_organization_tree(company, manual)
		assert result["node_type"] == "company"
		print("PASS: automatic roster membership for all four unit kinds, legacy member suppression, direct child selection without preallocation, deduplicated counts, required links, acting roles, reparent, cycle rejection, roster unchanged")
	finally:
		frappe.db.rollback()
	assert frappe.db.count("Organization Node") == before
	print("PASS: rollback removed all test fixtures")


if __name__ == "__main__":
	frappe.init(site="hrms.localhost", sites_path="/home/frappe/frappe-bench/sites")
	frappe.connect()
	frappe.set_user("Administrator")
	try:
		run()
	finally:
		frappe.destroy()
