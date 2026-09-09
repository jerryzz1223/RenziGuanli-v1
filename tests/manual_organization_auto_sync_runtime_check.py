"""Rollback-only integration coverage of continuing roster synchronization."""
import json
import frappe


def run():
	from hrms.api.organization_roster_sync import reconcile, roster_changed
	from hrms.hr.page.organizational_chart import organizational_chart as chart
	before = frappe.db.count("Organization Node")
	original = frappe.get_all("Employee", fields=["name", "department", "designation", "status"], order_by="name")
	try:
		reconcile("永新")
		assert reconcile("永新")["changed"] == 0
		dept = frappe.get_doc({"doctype": "Department", "department_name": "自动同步验证课", "company": "永新", "parent_department": "All Departments"}).insert()
		position = frappe.get_doc({"doctype": "Designation", "designation_name": "自动同步验证岗位"}).insert()
		employee = frappe.get_doc({"doctype": "Employee", "custom_employee_code": "9999090901", "first_name": "自动同步验证", "employee_name": "自动同步验证", "gender": "Male", "date_of_birth": "1990-01-01", "date_of_joining": "2026-09-01", "company": "永新", "department": dept.name, "designation": position.name, "status": "Active"}).insert()
		def nodes():
			return chart._get_manual_organization_records("永新")["nodes"]
		def bucket(department, designation):
			return next(n for n in nodes() if n.manual_config.get("node_kind") == "岗位" and n.manual_config.get("department") == department and n.manual_config.get("designation") == designation and n.manual_config.get("roster_auto_sync"))
		reconcile("永新")
		new = bucket(dept.name, position.name)
		assert new.manual_config["assigned_employees"] == [employee.name]
		assert reconcile("永新")["changed"] == 0
		# Transfer and role change, including source changes made by bulk SQL imports.
		frappe.db.set_value("Employee", employee.name, {"department": "连续课", "designation": "作业员"})
		reconcile("永新")
		assert employee.name not in bucket(dept.name, position.name).manual_config["assigned_employees"]
		assert employee.name in bucket("连续课", "作业员").manual_config["assigned_employees"]
		frappe.db.set_value("Employee", employee.name, "status", "Left")
		reconcile("永新")
		assert employee.name not in bucket("连续课", "作业员").manual_config["assigned_employees"]
		frappe.db.set_value("Employee", employee.name, {"status": "Active", "department": dept.name, "designation": position.name})
		reconcile("永新")
		new = bucket(dept.name, position.name)
		unit = next(n for n in nodes() if n.manual_config.get("node_kind") == "课" and n.manual_config.get("department") == dept.name)
		# Name/parent changes survive automatic membership refreshes.
		chart.save_manual_organization_node("岗位", node_name=new.name, company="永新", department=dept.name, designation=position.name,
			display_name="人工保留的名称", parent_node=None, assigned_employees=[employee.name], roster_auto_sync=1)
		reconcile("永新")
		updated = next(n for n in nodes() if n.name == new.name)
		assert updated.display_name == "人工保留的名称" and not updated.parent_node
		# Explicit manual membership remains empty; the employee is flagged, not silently re-added.
		chart.save_manual_organization_node("岗位", node_name=new.name, company="永新", department=dept.name, designation=position.name,
			display_name="人工保留的名称", assigned_employees=[], roster_auto_sync=0)
		result = reconcile("永新")
		assert any(i.get("employee") == employee.name and i["reason"] == "岗位为手动维护，待分配" for i in result["issues"])
		assert next(n for n in nodes() if n.name == new.name).manual_config["assigned_employees"] == []
		chart.save_manual_organization_node("岗位", node_name=new.name, company="永新", department=dept.name, designation=position.name, roster_auto_sync=1)
		reconcile("永新")
		assert employee.name in bucket(dept.name, position.name).manual_config["assigned_employees"]
		# A repeated title is not a unique destination. Keep established placement,
		# but a new/unassigned identity must wait for an explicit choice.
		duplicate = chart.save_manual_organization_node("岗位", company="永新", department=dept.name, designation=position.name,
			display_name="同名岗位另一组", parent_node=unit.name, assigned_employees=[], roster_auto_sync=1)
		result = reconcile("永新")
		assert any("同名岗位" in i["reason"] for i in result["issues"])
		assert next(n for n in nodes() if n.name == new.name).manual_config["assigned_employees"] == [employee.name]
		assert next(n for n in nodes() if n.name == duplicate["name"]).manual_config["assigned_employees"] == []
		chart.save_manual_organization_node("岗位", node_name=new.name, company="永新", department=dept.name, designation=position.name, assigned_employees=[], roster_auto_sync=1)
		reconcile("永新")
		assert all(employee.name not in n.manual_config.get("assigned_employees", []) for n in nodes() if n.name in {new.name, duplicate["name"]})
		frappe.db.set_value("Organization Node", duplicate["name"], "confirmation_status", "不导入")
		reconcile("永新")
		frappe.db.set_value("Employee", employee.name, "designation", None)
		assert any(i.get("employee") == employee.name and i["reason"] == "待完善职位" for i in reconcile("永新")["issues"])
		frappe.db.set_value("Employee", employee.name, "department", None)
		assert any(i.get("employee") == employee.name and i["reason"] == "待完善部门" for i in reconcile("永新")["issues"])
		# Automatic manager references are removed when their roster job no longer matches.
		frappe.db.set_value("Employee", "653", "status", "Left")
		reconcile("永新")
		continuous = next(n for n in nodes() if n.manual_config.get("department") == "连续课" and n.manual_config.get("node_kind") == "课")
		assert continuous.manual_config["primary_employee"] != "653"
		assert continuous.manual_config["proxy_employee"] is None
		assert any(b.get("employee") == "653" and b.get("issue") for b in continuous.manual_config["template_bindings"])
		# All existing Employee values, except the explicit test mutation above, are untouched.
		current = frappe.get_all("Employee", filters={"name": ["!=", employee.name]}, fields=["name", "department", "designation", "status"], order_by="name")
		for row in current:
			if row.name == "653": row.status = next(r.status for r in original if r.name == "653")
		assert current == original
		print("PASS: new employee/department/position, transfer, role change, exit, re-entry, manual names/parents/membership, missing fields, leader removal, idempotence, source integrity")
	finally:
		frappe.db.rollback()
	assert frappe.db.count("Organization Node") == before
	print("PASS: all automatic-sync fixtures rolled back")


if __name__ == "__main__":
	frappe.init(site="hrms.localhost", sites_path="/home/frappe/frappe-bench/sites")
	frappe.connect()
	frappe.set_user("Administrator")
	try: run()
	finally: frappe.destroy()
