"""Roster-linked presentation groups imported from an organization diagram.

Source names are resolved once to stable Employee IDs, within the exact department.
Unmatched references remain visible, but never count as active staff.
"""
from collections import defaultdict

from hrms.utils.organization_roles import chart_assigned_employees, display_role, binding_assignment_type


def reconcile_bindings(config, staff, allow_name_match=False):
	by_name = defaultdict(list)
	by_id = {e.name: e for e in staff}
	company_names = defaultdict(list)
	for person in staff:
		company_names[person.employee_name].append(person)
		if person.department == config.get("department"):
			by_name[person.employee_name].append(person)
	bindings, members = [], []
	for original in config.get("template_bindings", []):
		entry = dict(original)
		person = by_id.get(entry.get("employee"))
		if not entry.get("employee") and not entry.get("no_auto_match"):
			# Portable packages bind business codes, never a coincidentally equal name.
			if entry.get("source_code"):
				matches = [e for e in staff if str(e.get("custom_employee_code") or "").strip() == entry["source_code"]]
			elif allow_name_match:
				matches = (company_names if entry.get("display_only") else by_name).get(entry["source_name"], [])
			else:
				matches = []
			if len(matches) == 1:
				person = matches[0]
				entry["employee"] = person.name
			entry["issue"] = "同名待确认" if len(matches) > 1 else "未匹配本部门在职花名册"
		if person and (person.department == config.get("department") or entry.get("display_only") or config.get("node_kind") in {"管理层", "分管"}):
			if not entry.get("display_only"):
				members.append(person.name)
			entry.pop("issue", None)
		elif entry.get("employee"):
			entry["issue"] = "已离职或部门已变更"
		bindings.append(entry)
	return {"template_bindings": bindings, "assigned_employees": list(dict.fromkeys(members))}


def card_people(config, labels, active_ids):
	"""All allocated people, plus explicit unresolved source references, without truncation."""
	members = list(dict.fromkeys(chart_assigned_employees(config)))
	leadership = config.get("template_leadership") and config.get("roster_auto_sync")
	if leadership:
		members = list(dict.fromkeys(b.get("employee") for b in config.get("template_bindings", []) if not b.get("issue") and b.get("employee")))
	if not members and not config.get("template_bindings"):
		return []
	if not leadership:
		members = list(dict.fromkeys(filter(None, [config.get("primary_employee"), *members, config.get("proxy_employee")])))
	roles = defaultdict(list)
	for binding in config.get("template_bindings", []):
		if not binding.get("issue") and (config.get("roster_auto_sync") or binding.get("manual_confirmed") or config.get("assignment_rules_manual")):
			person = labels.get(binding.get("employee"))
			role = binding.get("role") or config.get("role_title") or "员工"
			role = display_role(role, person.designation if person else "", "正式" if binding.get("manual_confirmed") else "自动")
			if binding.get("manual_confirmed") and binding_assignment_type(binding) == "正式": role += "（正式）"
			elif binding.get("assignment_type") == "待确认": role += "（任职待确认）"
			roles[binding.get("employee")].append(role)
	if config.get("assignment_rules_manual"):
		members = list(dict.fromkeys([*members, *(b.get("employee") for b in config.get("template_bindings", []) if b.get("employee") and not b.get("issue"))]))
	if config.get("proxy_employee") and not leadership:
		roles[config["proxy_employee"]].append("代理人")
	people = []
	for employee in members:
		person = labels.get(employee)
		if not person or employee not in active_ids:
			continue
		role = "、".join(dict.fromkeys(roles.get(employee, []))) or display_role(config.get("role_title") or config.get("designation") or "员工", person.designation, config.get("assignment_mode") or "正式")
		people.append({"employee": employee, "employee_route": employee,
			"employee_name": person.employee_name, "employee_code": person.custom_employee_code,
			"designation": person.designation, "department": person.department,
			"role": role,
			"matched_employee": True})
	if config.get("roster_auto_sync") or config.get("assignment_rules_manual"):
		for binding in config.get("template_bindings", []):
			if binding.get("issue"):
				people.append({"name": binding["source_name"], "employee_name": binding["source_name"],
					"role": binding.get("role", ""), "matched_employee": False,
					"match_status": binding["issue"], "source_reference": True})
	return people
