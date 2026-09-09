"""User-authorized initial department/position allocation from the active roster.

Preview by default; --apply stores only Organization Nodes, with a private backup.
Existing placements and manual roles are retained. Repeated runs are no-ops.
"""
import json
from collections import defaultdict
from pathlib import Path

import frappe
from frappe.utils import now_datetime

MARKER = "roster-initial-allocation-20260909"


def run(apply=False, commit=True):
	from hrms.hr.page.organizational_chart import organizational_chart as chart
	frappe.only_for("System Manager")
	company = "永新"
	manual = chart._get_manual_organization_records(company)
	if any(n.manual_config.get("roster_initialization_complete") == MARKER for n in manual["nodes"]):
		return {"status": "already_applied"}
	departments = {d.name: d for d in frappe.get_list("Department", filters={"company": company, "disabled": 0}, fields=["name", "department_name", "parent_department"], limit_page_length=0)}
	employees = chart._get_active_employees(company)
	by_department = defaultdict(list)
	unresolved = []
	for employee in employees:
		if employee.department not in departments:
			unresolved.append(employee.name)
			continue
		by_department[employee.department].append(employee)
	units = {}
	for node in manual["nodes"]:
		if chart._manual_node_kind(node) in chart.ROSTER_UNIT_KINDS:
			department = node.manual_config.get("department")
			if department in units:
				frappe.throw(f"部门 {department} 有重复组织节点，未执行。")
			units[department] = node
	# Existing real role/person placements count as allocated; proxy references do not.
	placed = set()
	for node in manual["nodes"]:
		if chart._manual_node_kind(node) in {"岗位", "员工"}:
			config = node.manual_config
			placed.update(filter(None, [config.get("employee"), config.get("primary_employee"), *config.get("assigned_employees", [])]))
	plan = {"company": company, "active_people": len(employees), "unresolved_employee_ids": unresolved, "existing_placements": len(placed & {e.name for e in employees}), "departments": []}
	for name, dept in departments.items():
		groups = defaultdict(list)
		for employee in by_department[name]:
			if employee.name not in placed:
				groups[employee.designation or ""].append(employee.name)
		plan["departments"].append({"department": name, "create_unit": name not in units, "people": len(by_department[name]), "positions": dict(groups)})
	if not apply:
		return {"status": "preview", **plan}
	before = [frappe.get_doc("Organization Node", n.name).as_dict() for n in manual["nodes"]]
	backup = Path(frappe.get_site_path("private", "backups", f"organization-roster-initial-{now_datetime().strftime('%Y%m%d-%H%M%S-%f')}.json"))
	backup.parent.mkdir(parents=True, exist_ok=True)
	backup.write_text(frappe.as_json({"plan": plan, "before": before}), encoding="utf-8")
	backup.chmod(0o600)
	created = []
	def stamp(name, **values):
		doc = frappe.get_doc("Organization Node", name)
		config = chart._manual_node_config(doc.source_text)
		config.update(values)
		doc.source_text = json.dumps(config, ensure_ascii=False)
		doc.save()
		return doc
	def ensure_unit(name, visiting=None):
		if name in units:
			return units[name].name
		visiting = set(visiting or ())
		if name in visiting:
			frappe.throw("部门层级存在循环，未执行。")
		visiting.add(name)
		dept = departments[name]
		parent = ensure_unit(dept.parent_department, visiting) if dept.parent_department in departments else None
		kind = next((k for k in ("室", "课", "组", "线") if dept.department_name.endswith(k)), None)
		if not kind:
			frappe.throw(f"部门 {name} 无法确定组织类型，未执行。")
		saved = chart.save_manual_organization_node(kind, display_name=dept.department_name, department=name, parent_node=parent, company=company)
		units[name] = stamp(saved["name"], roster_initialization=MARKER, reporting_scope_pending=parent is None)
		created.append(saved["name"])
		return saved["name"]
	try:
		for item in plan["departments"]:
			name = item["department"]
			parent = ensure_unit(name)
			unit = frappe.get_doc("Organization Node", parent)
			config = chart._manual_node_config(unit.source_text)
			staff = {e.name: e for e in by_department[name]}
			primary = config.get("primary_employee") or config.get("responsible_person")
			title = {"课": "课长", "组": "组长", "线": "线长"}.get(config.get("node_kind"))
			updates = {}
			if not primary and title:
				candidates = [e.name for e in staff.values() if e.designation == title]
				if len(candidates) == 1:
					primary = candidates[0]
					updates["primary_employee"] = primary
			if primary in staff and not config.get("role_title"):
				updates["role_title"] = staff[primary].designation or ""
			if primary in staff and not config.get("proxy_employee"):
				role = config.get("role_title") or updates.get("role_title")
				proxies = [e.name for e in staff.values() if role and e.designation in {role + "（代）", role + "(代)"}]
				if len(proxies) == 1 and proxies[0] != primary:
					updates["proxy_employee"] = proxies[0]
			if updates:
				stamp(parent, **updates)
			for designation, names in item["positions"].items():
				if designation:
					saved = chart.save_manual_organization_node("岗位", display_name=designation, department=name, designation=designation,
						role_title=designation, assignment_mode="正式", assigned_employees=names, parent_node=parent, company=company, planned_headcount_set=0)
					created.append(saved["name"])
					stamp(saved["name"], roster_initialization=MARKER)
				else:
					for employee in names:
						saved = chart.save_manual_organization_node("员工", employee=employee, parent_node=parent, company=company)
						created.append(saved["name"])
						stamp(saved["name"], roster_initialization=MARKER)
		# Check complete one-time coverage by immutable Employee ID, not names or totals.
		after = chart._get_manual_organization_records(company)
		allocated = set()
		for node in after["nodes"]:
			if chart._manual_node_kind(node) in {"岗位", "员工"}:
				config = node.manual_config
				allocated.update(filter(None, [config.get("employee"), config.get("primary_employee"), *config.get("assigned_employees", [])]))
		assert {e.name for e in employees if e.name not in unresolved} <= allocated, "initial allocation incomplete"
		stamp(next(iter(units.values())).name, roster_initialization_complete=MARKER)
		backup.write_text(frappe.as_json({"plan": plan, "before": before, "created": created}), encoding="utf-8")
		if commit:
			frappe.db.commit()
		return {"status": "applied", "people": len(employees) - len(unresolved), "unresolved_people": len(unresolved), "departments": len(departments), "created_nodes": len(created), "backup": str(backup)}
	except Exception:
		frappe.db.rollback()
		raise


if __name__ == "__main__":
	import sys
	frappe.init(site="hrms.localhost", sites_path="/home/frappe/frappe-bench/sites")
	frappe.connect()
	frappe.set_user("Administrator")
	try:
		print(json.dumps(run(apply="--apply" in sys.argv), ensure_ascii=False))
	finally:
		frappe.destroy()
