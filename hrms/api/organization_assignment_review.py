"""Explicit, per-person organization duties; never infer a proxy from job mismatch."""
import json
from collections import defaultdict

import frappe
from frappe.utils import cstr, cint, now

from hrms.utils.organization_roles import base_role, whole_department, chart_assigned_employees, binding_assignment_type, confirmed_formal_bindings, ASSIGNMENT_TYPES


def assignment_issues(nodes, staff):
	people = {e.name: e for e in staff}
	issues = []
	placements = placement_index(nodes)
	template_departments = {n.manual_config.get("department") for n in nodes if n.manual_config.get("template_source_cell")}
	for node in nodes:
		cfg = node.manual_config
		reasons = []
		bindings = cfg.get("template_bindings", [])
		for binding in bindings:
			if binding.get("issue"):
				reasons.append(f"{binding.get('source_name') or '原表人员'}：{binding['issue']}")
		for binding in bindings:
			person = people.get(binding.get("employee"))
			title = base_role(binding.get("role"))
			if person and not binding.get("manual_confirmed") and not binding.get("issue") and binding.get("slot") != "proxy" and title not in {"", "员工", "任职人", "负责人", "代理人"}:
				source_title = binding.get("source_role") or binding.get("role", "")
				if base_role(source_title) == source_title and not base_role(person.designation).endswith(title):
					reasons.append(f"{person.employee_name}：原表职务为{title}，花名册主职为{person.designation or '未填写'}，任职性质需手动确认")
		for employee in set(b.get("employee") for b in bindings if b.get("employee")):
			positions = placements.get(employee, [])
			formal = [p for p in positions if p["formal"]]
			pending_here = any(p["node_name"] == node.name and p["assignment_type"] == "待确认" for p in positions)
			if len(positions) > 1 and not formal:
				reasons.append(f"{people[employee].employee_name if employee in people else employee}有多处任职，唯一正式职位尚未人工确认：" + "、".join(dict.fromkeys(p["name"] for p in positions)))
			elif pending_here and (len(positions) > 1 or any(b.get("employee") == employee and b.get("assignment_type") == "待确认" for b in bindings)):
				reasons.append(f"{people[employee].employee_name if employee in people else employee}：此处任职性质待确认" + (f"；正式职位已确认在{formal[0]['name']}" if len(formal) == 1 else ""))
			if len(formal) > 1: reasons.append(f"员工 {employee} 存在多个已确认正式职位，需要人工纠正")
		primary = [b for b in bindings if b.get("slot") == "primary"]
		if len(primary) > 1 and not all(b.get("manual_confirmed") for b in primary):
			reasons.append("同一负责人栏列有多人，需逐人确认正式、代理任职或兼任；不能自动选一人")
		if cfg.get("assignment_mode") == "自动" and not bindings:
			for key in filter(None, [cfg.get("primary_employee"), cfg.get("manager_employee"), *chart_assigned_employees(cfg)]):
				person = people.get(key)
				title = cfg.get("role_title") or cfg.get("designation")
				if person and title and base_role(title) != base_role(person.designation):
					reasons.append(f"{person.employee_name}：图中职务与花名册主职不同，任职性质需手动确认")
		if cfg.get("roster_auto_sync") and not cfg.get("roster_subset") and cfg.get("node_kind") == "岗位" and cfg.get("department") in template_departments and cfg.get("assigned_employees"):
			reasons.append("仅按花名册职位归集；具体组线或直属岗位归属需手动确认")
		for key in filter(None, [cfg.get("primary_employee"), cfg.get("manager_employee"), cfg.get("proxy_employee"), *chart_assigned_employees(cfg)]):
			person = people.get(key)
			if not person:
				reasons.append(f"任职记录 {key} 已离职或不可用，需人工处理")
		if reasons:
			issues.append({"node_name": node.name, "node_id": f"organization_node:{node.name}", "name": node.display_name,
				"department": cfg.get("department"), "source_cell": cfg.get("template_source_cell") or cfg.get("template_leadership_cell", ""), "reasons": list(dict.fromkeys(reasons))})
	return issues


def get_node(company, node_name, write=False):
	from hrms.api.organization_package import chart_module
	frappe.get_doc("Company", company).check_permission("read")
	doc = frappe.get_doc("Organization Node", node_name, for_update=write)
	doc.check_permission("write" if write else "read")
	if doc.structure_version != chart_module()._get_manual_organization_version(company) or doc.confirmation_status != "已确认":
		frappe.throw("请选择当前公司的有效组织节点。")
	return doc, chart_module()._manual_node_config(doc.source_text)


def placement_index(nodes):
	placements = defaultdict(list)
	for node in nodes:
		for binding in node.manual_config.get("template_bindings", []):
			if binding.get("employee") and not binding.get("issue"):
				placements[binding["employee"]].append({"node_name": node.name, "node_id": f"organization_node:{node.name}",
					"name": node.display_name, "role": binding.get("role", ""), "assignment_type": binding_assignment_type(binding),
					"formal": bool(binding.get("manual_confirmed") and binding_assignment_type(binding) == "正式")})
	return placements


def formal_conflicts(nodes, employees=None):
	owners, conflicts = {}, []
	for node in nodes:
		for binding in confirmed_formal_bindings(node.manual_config):
			key = binding["employee"]
			if employees is not None and key not in employees: continue
			label = f"{node.display_name} / {binding.get('role') or '任职'}"
			if key in owners: conflicts.append(f"员工 {key} 的正式职位不唯一：{owners[key]}、{label}；请先将其他任职调整为兼任、代理任职或待确认")
			else: owners[key] = label
	return conflicts


@frappe.whitelist()
def get_review(company: str, node_name: str):
	from hrms.api.organization_roster import get_candidates
	doc, cfg = get_node(company, node_name)
	staff = get_candidates(company, allow_company=True)["employees"]
	people = {e.name: e for e in staff}
	bindings = list(cfg.get("template_bindings", []))
	if not bindings:
		primary = cfg.get("primary_employee") or cfg.get("manager_employee") or cfg.get("employee")
		for employee in dict.fromkeys(filter(None, [primary, *chart_assigned_employees(cfg), cfg.get("proxy_employee")])):
			person = people.get(employee)
			role = cfg.get("role_title") or cfg.get("designation") or "任职人"
			if cfg.get("assignment_mode") == "代理": role = base_role(role) + "（代）"
			bindings.append({"employee": employee, "source_name": person.employee_name if person else employee,
				"role": role, "slot": "proxy" if employee == cfg.get("proxy_employee") else "primary" if employee == primary else "",
				"display_only": employee == cfg.get("proxy_employee") and person and person.department != cfg.get("department")})
	rows = []
	for index, binding in enumerate(bindings):
		person = people.get(binding.get("employee"))
		rows.append({"reference_index": index, "source_name": binding.get("source_name", ""),
			"source_role": binding.get("source_role") or binding.get("role", ""),
			"employee": binding.get("employee") if person else "", "role": base_role(binding.get("role") or cfg.get("role_title") or "任职人"),
			"assignment_type": binding_assignment_type(binding, person.designation if person else ""), "leader": int(binding.get("slot") == "primary"),
			"display_only": int(bool(binding.get("display_only"))),
			"status": binding.get("issue") or ("人工已确认" if binding.get("manual_confirmed") else "待核对"),
			"roster_job": person.designation if person else "", "employee_name": person.employee_name if person else ""})
	from hrms.api.organization_package import chart_module
	placements = placement_index(chart_module()._get_manual_organization_records(company)["nodes"])
	related = [{"employee": row["employee"], "employee_name": row["employee_name"], "positions": placements.get(row["employee"], [])} for row in rows if row["employee"]]
	return {"node_name": doc.name, "name": doc.display_name, "modified": cstr(doc.modified), "rows": rows, "related_assignments": related,
		"department": cfg.get("department"), "source_cell": cfg.get("template_source_cell") or cfg.get("template_leadership_cell", ""),
		"candidates": [{"value": e.name, "label": f"{e.employee_name} · {e.custom_employee_code or e.name}",
			"designation": e.designation, "employee_name": e.employee_name, "description": f"{e.department or '未填部门'} / {e.designation or '未填职位'}"} for e in staff]}


@frappe.whitelist(methods=["POST"])
def save_review(company: str, node_name: str, modified: str, rows: list[dict] | str):
	from hrms.api.organization_package import chart_module
	from hrms.api.organization_template import reconcile_bindings
	from hrms.api.organization_roster import get_candidates
	frappe.db.sql("select name from tabCompany where name=%s for update", company)
	frappe.db.sql("select name from `tabOrganization Structure Version` where company=%s and source_reference=%s for update", (company, chart_module()._manual_organization_reference(company)))
	doc, cfg = get_node(company, node_name, write=True)
	if cstr(doc.modified) != modified: frappe.throw("任职记录已变化，请重新打开核对窗口。")
	rows = frappe.parse_json(rows) if isinstance(rows, str) else rows
	if not isinstance(rows, list) or len(rows) > 1000: frappe.throw("任职记录格式不正确或超过 1000 行。")
	staff = get_candidates(company, allow_company=True)["employees"]
	people = {e.name: e for e in staff}
	old = cfg.get("template_bindings", [])
	from hrms.utils.organization_scope import department_scopes
	manual = chart_module()._get_manual_organization_records(company)
	scopes = department_scopes({n.name: {"config": n.manual_config, "parent": n.parent_node} for n in manual["nodes"]}, chart_module()._get_departments(company))
	allowed_departments = scopes.get(node_name, {cfg.get("department")})
	bindings, seen, source_rows = [], set(), set()
	for index, row in enumerate(rows, 1):
		if not isinstance(row, dict): frappe.throw("任职记录格式不正确。")
		employee = cstr(row.get("employee")).strip()
		kind = row.get("assignment_type")
		role = base_role(cstr(row.get("role")).strip())
		if kind not in ASSIGNMENT_TYPES or not role: frappe.throw(f"第 {index} 行请填写职务并选择任职性质。")
		leader, display_only = bool(cint(row.get("leader"))), bool(cint(row.get("display_only")))
		if kind == "代理人" and leader: frappe.throw(f"第 {index} 行代理人不能同时勾选负责人。")
		if whole_department(cfg) and not leader and kind != "代理人": frappe.throw(f"第 {index} 行：课室节点只维护负责人和代理人，普通员工请安排到下级组线或岗位。")
		person = people.get(employee)
		if employee and not person: frappe.throw(f"第 {index} 行请选择有权查看的当前公司在职员工。")
		if display_only and kind not in {"兼任", "代理人"}: frappe.throw(f"第 {index} 行：跨部门展示仅用于明确的兼任或代理人。")
		if person and cfg.get("department") and person.department not in allowed_departments and not display_only:
			frappe.throw(f"第 {index} 行员工不属于本部门；请核对，明确兼任或代理人后才能启用跨部门展示。")
		ref = row.get("reference_index")
		if ref not in (None, ""):
			if not cstr(ref).isdigit() or cint(ref) < 0: frappe.throw(f"第 {index} 行来源记录无效，请重新打开核对窗口。")
			if cint(ref) in source_rows: frappe.throw(f"第 {index} 行来源记录重复，请通过添加行维护其他任职。")
			source_rows.add(cint(ref))
		original = old[cint(ref)] if ref not in (None, "") and 0 <= cint(ref) < len(old) else {}
		binding = {**original, "employee": employee or None, "source_code": cstr(person.custom_employee_code).strip() if person else "",
			"source_name": original.get("source_name") or (person.employee_name if person else cstr(row.get("source_name")).strip()),
			"source_role": original.get("source_role") or original.get("role", ""),
			"role": role + ("（代）" if kind == "代理任职" else "（兼）" if kind == "兼任" else ""),
			"slot": "proxy" if kind == "代理人" else "primary" if leader else "", "display_only": display_only,
			"manual_confirmed": bool(employee) and kind != "待确认", "assignment_type": kind, "no_auto_match": True}
		if kind == "代理人": binding["role"] = "代理人" if role in {"代理人", "任职人"} else role.removesuffix("·代理人") + "·代理人"
		if not employee:
			if not binding["source_name"]: frappe.throw(f"第 {index} 行请选员工，或删除空行。")
			binding["issue"] = "尚未人工绑定员工"
		else: binding.pop("issue", None)
		key = (employee or binding["source_name"], binding["role"], binding["slot"])
		if key in seen: frappe.throw(f"第 {index} 行同一人员、职务和任职性质重复。")
		seen.add(key)
		bindings.append(binding)
	primaries = {b["employee"] for b in bindings if b.get("employee") and b["slot"] == "primary"}
	proxies = {b["employee"] for b in bindings if b.get("employee") and b["slot"] == "proxy"}
	if primaries & proxies: frappe.throw("同一节点的负责人和代理人不能是同一员工。")
	# Locking reads see the latest committed choices even if permission checks
	# opened an earlier repeatable-read snapshot in this request.
	others = frappe.db.sql("select name, display_name, source_text from `tabOrganization Node` where structure_version=%s and confirmation_status='已确认' and name!=%s for update", (doc.structure_version, node_name), as_dict=True)
	for other in others: other.manual_config = chart_module()._manual_node_config(other.source_text)
	conflicts = formal_conflicts([*others, frappe._dict(name=doc.name, display_name=doc.display_name, manual_config={"template_bindings": bindings})], employees={b["employee"] for b in confirmed_formal_bindings({"template_bindings": bindings})})
	if conflicts: frappe.throw("；".join(conflicts))
	cfg.update(template_bindings=bindings, assignment_rules_manual=bool(bindings), assignment_reviewed_by=frappe.session.user, assignment_reviewed_on=now())
	# Explicit identities remain fixed. Automatic refresh checks their status and
	# department; it cannot replace them with a same-name or same-title employee.
	cfg["roster_auto_sync"] = bool(cfg.get("roster_subset") or whole_department(cfg))
	if whole_department(cfg): cfg["template_leadership"] = True
	resolved = reconcile_bindings(cfg, staff, allowed_departments=allowed_departments)
	cfg.update(resolved)
	if whole_department(cfg) or cfg.get("node_kind") in {"管理层", "分管", "员工"}: cfg["assigned_employees"] = []
	cfg["primary_employee"] = next(iter(primaries)) if len(primaries) == 1 else None
	cfg["proxy_employee"] = next(iter(proxies)) if len(proxies) == 1 else None
	if cfg.get("node_kind") in {"管理层", "分管"}:
		cfg["manager_employee"] = cfg["primary_employee"]
		cfg["assigned_employees"] = []
	if cfg.get("node_kind") == "员工":
		if len(resolved["assigned_employees"]) != 1: frappe.throw("员工节点必须且只能绑定一名员工。")
		cfg["employee"] = resolved["assigned_employees"][0]
	doc.source_text = json.dumps(cfg, ensure_ascii=False, sort_keys=True)
	doc.save()
	return {"node_name": doc.name, "assigned": len(resolved["assigned_employees"]), "pending": sum(bool(b.get("issue")) or binding_assignment_type(b) == "待确认" for b in bindings)}
