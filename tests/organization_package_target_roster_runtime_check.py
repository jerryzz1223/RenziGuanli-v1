"""Exercise portable automatic roster rules with distinct source/target employees."""
from copy import deepcopy

import frappe

from hrms.api import organization_package as package


def run():
	def person(name, code, department="D", status="Active"):
		return frappe._dict(name=name, custom_employee_code=code, employee_name=name,
			department=department, designation="业务员", status=status)
	config = {"node_kind": "岗位", "department": "D", "designation": "业务员",
		"roster_auto_sync": True, "assignment_mode": "自动", "assigned_employees": ["LOCAL"]}
	state = {"manual": {"version": None, "nodes": [frappe._dict(name="AUTO", node_code="AUTO",
		parent_node=None, display_name="业务员", planned_headcount=0, manual_config=config)]},
		"employees": [person("LOCAL", "0001")], "departments": [frappe._dict(name="D", department_name="总办室")],
		"designations": ["业务员"], "grades": [], "options": {}, "source_grades": {}}
	data = package.read_content(package.workbook_bytes("永新", state))
	assert not data["人员任职"], "ordinary automatic members must not become fixed portable references"
	assert data["组织层级"][0]["template_source_vacancies"] == "0"
	target = deepcopy(state)
	target["manual"] = {"version": None, "nodes": []}
	target["employees"] = [person("TARGET", "0099"), person("OTHER", "0088", "OTHER"), person("LEFT", "0077", status="Left")]
	plan = package.prepare("永新", data, target)
	assert not plan["errors"], plan["errors"]
	assert plan["_plans"]["AUTO"]["config"]["assigned_employees"] == ["TARGET"]
	# Older files carry snapshots: an absent source member cannot block an automatic rule.
	ref = {key: "" for key in package.PERSON_COLUMNS.values()}
	ref.update(node="AUTO", type="岗位成员", code="0001", name="LOCAL", _row=2)
	legacy = deepcopy(data); legacy["人员任职"].append(ref)
	plan = package.prepare("永新", legacy, target)
	assert not plan["errors"] and plan["warnings"], plan["errors"]
	assert plan["_plans"]["AUTO"]["config"]["assigned_employees"] == ["TARGET"]
	# Explicit manual assignment remains strict, even if its row follows the snapshot.
	fixed = deepcopy(legacy)
	fixed["人员任职"].append({**ref, "type": "任职人", "_row": 3})
	assert any("0001" in error for error in package.prepare("永新", fixed, target)["errors"])
	manual = deepcopy(legacy); manual["组织层级"][0]["roster_auto_sync"] = "0"
	assert any("0001" in error for error in package.prepare("永新", manual, target)["errors"])
	# A fixed chart placement takes precedence over an automatic bucket.
	reserved = deepcopy(data)
	reserved["组织层级"].append({**data["组织层级"][0], "portable_id": "MANUAL", "roster_auto_sync": "0", "_row": 3})
	reserved["人员任职"].append({**ref, "node": "MANUAL", "code": "0099", "name": "TARGET"})
	plan = package.prepare("永新", reserved, target)
	assert not plan["errors"], plan["errors"]
	assert plan["_plans"]["AUTO"]["config"]["assigned_employees"] == []
	assert plan["_plans"]["MANUAL"]["config"]["assigned_employees"] == ["TARGET"]
	print("PASS: source/target employee IDs differ; automatic rules use target roster; legacy snapshots accepted; manual assignments remain strict; fixed placements win; zero vacancy round trip")


if __name__ == "__main__":
	frappe.init(site="hrms.localhost", sites_path="/home/frappe/frappe-bench/sites")
	frappe.connect(); frappe.set_user("Administrator")
	try: run()
	finally: frappe.db.rollback(); frappe.destroy()
