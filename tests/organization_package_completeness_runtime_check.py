"""Rollback-only regression: source grades, legacy files, merged roster scope."""
import io
from unittest.mock import patch

import frappe
from openpyxl import load_workbook

from hrms.api import organization_package as package
from hrms.api.organization_roster_sync import reconcile


def run():
	company = "永新"
	before = package.target_state(company)
	try:
		content = package.workbook_bytes(company, before)
		data = package.read_content(content)
		assert all(row["template_source_vacancies"].isdigit() for row in data["组织层级"]), "generated nodes must export canonical vacancy counts"
		plan = package.prepare(company, data)
		assert not plan["errors"], plan["errors"]
		assert plan["completeness"]["source_grade_nodes"] == 17, plan["completeness"]
		assert plan["completeness"]["grade_definitions"] == 0
		assert plan["completeness"]["unbound_references"] == 19
		assert {r["source_grade_tags"] for r in data["组织层级"] if r["source_grade_tags"]} == {"直线级", "间师级", "文师级"}
		assert all(r["source_grade_status"] == "待确认" and r["source_grade_reference"] for r in data["组织层级"] if r["source_grade_tags"])
		url = package.save_private(content, "组织配置回归测试", company)["file_url"]
		package.apply_configuration(company, url, plan["fingerprint"], auto_sync=0)
		exported = package.read_content(package.workbook_bytes(company))
		assert data == exported, "export/import/export lost configuration fields"
		# A target with no legacy draft must retain the portable evidence too.
		with patch("hrms.api.organization_source_grades.source_grade_evidence", return_value={}):
			assert package.read_content(package.workbook_bytes(company)) == data
		# Legacy v1 has no source-grade columns: preserve already imported values.
		book = load_workbook(io.BytesIO(content))
		book["说明"]["B1"] = "HRMS-ORGANIZATION-1"
		book["组织层级"].delete_cols(27, 3)
		stream = io.BytesIO(); book.save(stream); book.close()
		legacy = package.read_content(stream.getvalue())
		legacy_plan = package.prepare(company, legacy)
		assert not legacy_plan["errors"] and legacy_plan["completeness"]["source_grade_nodes"] == 17
		print("PASS: 17 source-grade bindings, 3 assigned labels, pending status/provenance, exact round trip, no legacy dependency, v1 preservation")
		# Simulate the target roster storing this person in the explicitly merged department.
		emp = frappe.get_all("Employee", filters={"company": company, "custom_employee_code": "260501"}, fields=["name"])[0]
		frappe.db.set_value("Employee", emp.name, "department", "业务组", update_modified=False)
		merged = package.prepare(company, data)
		assert not merged["errors"], merged["errors"]
		package.apply_configuration(company, url, merged["fingerprint"], auto_sync=0)
		reconcile(company)
		nodes = package.chart_module()._get_manual_organization_records(company)["nodes"]
		business = next(n for n in nodes if n.node_code == "MANUAL-547A0B646B")
		assert emp.name in business.manual_config["assigned_employees"]
		assert not next(b for b in business.manual_config["template_bindings"] if b.get("employee") == emp.name).get("issue")
		package.chart_module().save_manual_organization_node("线", node_name=business.name, company=company,
			parent_node=business.parent_node, department=business.manual_config["department"],
			display_name=business.display_name, assigned_employees=business.manual_config["assigned_employees"])
		assert not package.prepare(company, package.read_content(package.workbook_bytes(company)))["errors"]
		frappe.db.set_value("Employee", emp.name, "department", "行政课", update_modified=False)
		rejected = package.prepare(company, data)
		assert any("行政课" in e and "总办室" in e and "业务组" in e for e in rejected["errors"]), rejected["errors"]
		print("PASS: explicit merged-department import and automatic sync retain person; unrelated department rejected with actual/allowed labels")
	finally:
		frappe.db.rollback()
	assert package.target_state(company) == before, "rollback did not restore source data"
	print("PASS: all business data rolled back")


if __name__ == "__main__":
	frappe.init(site="hrms.localhost", sites_path="/home/frappe/frappe-bench/sites")
	frappe.connect(); frappe.set_user("Administrator")
	try: run()
	finally: frappe.destroy()
