"""Run with bench Python from sites; all fixture nodes are rolled back."""
import json
import frappe


def run():
	from hrms.hr.page.organizational_chart import organizational_chart as chart
	from hrms.api.organization_roster import get_candidates
	company = "永新"
	before = frappe.db.count("Organization Node")
	try:
		root = chart.save_manual_organization_node("课", company=company, display_name="验证框架-不保留")
		child = chart.save_manual_organization_node("课", company=company, display_name="验证下级-不保留", parent_node=root["name"])
		vacant = chart.save_manual_organization_node("岗位", company=company, display_name="验证空岗位-不保留", role_title="验证课长", parent_node=child["name"], planned_headcount=2)
		assert json.loads(frappe.get_doc("Organization Node", vacant["name"]).source_text)["role_title"] == "验证课长"
		try:
			chart.save_manual_organization_node("课", company=company, node_name=root["name"], display_name="验证框架", parent_node=vacant["name"])
		except frappe.ValidationError:
			pass
		else:
			raise AssertionError("cycle accepted")
		candidate = frappe.get_list("Employee", filters={"company": company, "status": "Active", "department": ["is", "set"]}, fields=["name", "department", "designation"], limit_page_length=1)[0]
		master_before = frappe.db.get_value("Employee", candidate.name, ["department", "designation", "reports_to"])
		chart.save_manual_organization_node("岗位", company=company, node_name=vacant["name"], display_name="验证空岗位", role_title="验证课长", assignment_mode="自动", department=candidate.department, primary_employee=candidate.name, parent_node=child["name"], planned_headcount=2)
		detail = chart._get_manual_organization_node_detail("organization_node:" + vacant["name"], "organization_position", company, "")
		assert any("验证课长（代理）" in line for line in detail["role_lines"]), detail["role_lines"]
		assert frappe.db.get_value("Employee", candidate.name, ["department", "designation", "reports_to"]) == master_before
		chart.save_manual_organization_node("岗位", company=company, display_name="验证重复任职", role_title="验证组长", assignment_mode="代理", department=candidate.department, primary_employee=candidate.name, assigned_employees=[candidate.name], parent_node=child["name"])
		parent_detail = chart._get_manual_organization_node_detail("organization_node:" + child["name"], "organization_section", company, "")
		assert parent_detail["metrics"]["current_headcount"] == 1, "repeated references inflated headcount"
		assert detail["metrics"]["vacancy_count"] == 1
		chart.save_manual_organization_node("岗位", company=company, node_name=vacant["name"], display_name="验证代理岗位", role_title="验证课长", department=candidate.department, proxy_employee=candidate.name, parent_node=root["name"])
		assert frappe.get_doc("Organization Node", vacant["name"]).parent_node == root["name"]
		manual = chart._get_manual_organization_records(company)
		result = chart._build_manual_organization_tree(company, manual)
		assert result["node_type"] == "company"
		print("PASS: empty framework, nested departments, vacant title, acting assignment, standalone proxy, reparent, cycle rejection, roster unchanged, deduplicated counts, vacancy, tree rendering")
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
