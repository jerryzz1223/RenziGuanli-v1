"""Real DB, rollback-only coverage of roster-only initialization and migration."""
from unittest.mock import patch

import frappe


def run():
	from hrms.api import organization_package as package
	from hrms.api.organization_flow import initialize_from_roster
	from hrms.api.organization_roster_sync import reconcile
	from hrms.setup import flatten_yongxin_roster_department_parents

	company = "永新"
	chart = package.chart_module()
	frappe.db.sql("select name from tabCompany where name=%s for update", company)
	before = package.target_state(company)
	departments = frappe.get_all("Department", fields=["name", "parent_department", "company"], order_by="name")
	content = package.workbook_bytes(company)
	data = package.read_content(content)
	try:
		# Verify cleanup is reversible, idempotent, and does not change chart or employees.
		with patch("frappe.utils.file_manager.save_file", return_value=frappe._dict(file_url="/private/files/test-backup.json")) as backup:
			result = flatten_yongxin_roster_department_parents()
			assert result["updated"] == sum(d.company == company and d.parent_department != "All Departments" for d in departments)
			assert backup.call_count == bool(result["updated"])
			assert not flatten_yongxin_roster_department_parents()["updated"]
		assert package.target_state(company) == before
		frappe.db.rollback()

		# Hide the existing manual version only inside this rolled-back transaction.
		frappe.db.set_value("Organization Structure Version", before["manual"]["version"], "source_reference", "rollback-only-roster-test")
		assert not chart._get_manual_organization_records(company)["nodes"]
		created = initialize_from_roster(company)
		assert created["nodes"] > 0
		units = [n for n in chart._get_manual_organization_records(company)["nodes"] if chart.whole_department(n.manual_config)]
		assert units and all(not n.parent_node and n.manual_config["reporting_scope_pending"] for n in units)
		assert any(n.manual_config.get("department") == "QE组" for n in units), "legacy QE parent must not become a reporting line"
		assert not reconcile(company)["changed"], "repeated sync must not duplicate nodes"
		try:
			initialize_from_roster(company)
		except frappe.ValidationError:
			pass
		else:
			raise AssertionError("reinitialization must not overwrite an existing tree")
		unit = next(n for n in units if n.manual_config.get("department") == "连续课")
		manager = chart.save_manual_organization_node("分管", company=company, display_name="测试分管")
		chart.save_manual_organization_node("课", company=company, node_name=unit.name, department="连续课", parent_node=manager["name"], display_name="连续课")
		reconcile(company)
		assert frappe.db.get_value("Organization Node", unit.name, "parent_node") == manager["name"]
		assert package.target_state(company)["employees"] == before["employees"]
		assert frappe.get_all("Department", fields=["name", "parent_department", "company"], order_by="name") == departments
		frappe.db.rollback()
		print("PASS: roster-only initialization ignores legacy parents; manual parent survives sync; repeat initialization blocked; roster unchanged")

		# Alternative: import the already-correct source config on a roster-only server.
		frappe.db.set_value("Organization Structure Version", before["manual"]["version"], "source_reference", "rollback-only-import-test")
		plan = package.prepare(company, data)
		assert not plan["errors"], plan["errors"]
		with patch.object(package, "read_package", return_value=data), patch.object(package, "save_private", return_value={"file_url": "/private/files/test-backup.xlsx"}):
			result = package.apply_configuration(company, "test", plan["fingerprint"])
			assert result["created"] == len(before["manual"]["nodes"])
			repeated = package.prepare(company, data)
			assert not repeated["errors"] and repeated["create_count"] == 0, repeated["errors"]
			package.apply_configuration(company, "test", repeated["fingerprint"])
		assert len(chart._get_manual_organization_records(company)["nodes"]) == len(before["manual"]["nodes"])
		assert package.target_state(company)["employees"] == before["employees"]
		assert frappe.get_all("Department", fields=["name", "parent_department", "company"], order_by="name") == departments
		print("PASS: full configuration imports on roster-only target; same file reimports without new nodes; Employee and Department unchanged")
	finally:
		frappe.db.rollback()
	assert package.target_state(company) == before
	print("PASS: all database changes rolled back")


if __name__ == "__main__":
	frappe.init(site="hrms.localhost", sites_path="/home/frappe/frappe-bench/sites")
	frappe.connect()
	frappe.set_user("Administrator")
	try:
		run()
	finally:
		frappe.destroy()
