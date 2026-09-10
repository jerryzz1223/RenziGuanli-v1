"""Explain roster sources and chart mappings without inventing employee identities."""
from collections import Counter
import json

import frappe


@frappe.whitelist(methods=["POST"])
def initialize_from_roster(company: str):
	"""Explicit first-time scaffolding for a site that only has an employee roster."""
	from hrms.api.organization_package import authorize, chart_module, version_options
	from hrms.api.organization_roster_sync import reconcile

	authorize(company)
	frappe.db.sql("select name from tabCompany where name=%s for update", company)
	chart = chart_module()
	if chart._get_manual_organization_records(company)["nodes"]:
		frappe.throw("当前公司已有组织配置，请直接编辑节点或导入配置；无需重新初始化。")
	if not frappe.db.exists("Employee", {"company": company, "status": "Active"}):
		frappe.throw("请先导入当前公司的在职花名册。")
	version = chart._ensure_manual_organization_version(company)
	result = reconcile(company)
	doc = frappe.get_doc("Organization Structure Version", version)
	doc.notes = json.dumps({**version_options(version), "roster_auto_sync_enabled": True}, ensure_ascii=False)
	doc.save()
	return {**result, "nodes": len(chart._get_manual_organization_records(company)["nodes"])}


def reference_report(state):
	rows = []
	for node in state["manual"]["nodes"]:
		for index, binding in enumerate(node.manual_config.get("template_bindings", [])):
			if binding.get("employee") or binding.get("source_code"):
				continue
			matches = [e for e in state["employees"] if e.employee_name == binding.get("source_name")]
			status = "未找到同名档案" if not matches else "存在同名在职档案，待确认身份或兼任" if any(e.status == "Active" for e in matches) else "仅找到同名非在职档案"
			rows.append({"node": node.name, "node_name": node.display_name, "reference_index": index,
				"source_name": binding.get("source_name"), "role": binding.get("role"), "status": status,
				"candidates": [{"employee": e.name, "code": e.custom_employee_code or "", "name": e.employee_name,
					"department": e.department, "status": e.status} for e in matches]})
	return rows


@frappe.whitelist()
def get_reference_report(company: str):
	from hrms.api.organization_package import authorize, target_state
	authorize(company)
	return reference_report(target_state(company))


@frappe.whitelist()
def get_department_flow(company: str):
	from hrms.api.organization_package import authorize, target_state, chart_module
	authorize(company)
	state = target_state(company)
	nodes = state["manual"]["nodes"]
	by_id = {n.name: n for n in nodes}
	def path(node):
		parts, seen = [], set()
		while node and node.name not in seen:
			seen.add(node.name)
			parts.append(node.display_name)
			node = by_id.get(node.parent_node)
		return " / ".join([company, *reversed(parts)])
	active = Counter(e.department for e in state["employees"] if e.status == "Active")
	all_staff = Counter(e.department for e in state["employees"])
	rows = []
	for dept in state["departments"]:
		mapped = [n for n in nodes if (chart_module().whole_department(n.manual_config) and n.manual_config.get("department") == dept.name)
			or dept.department_name in n.manual_config.get("roster_department_alias_labels", [])]
		rows.append({"department": dept.name, "label": dept.department_name, "active": active[dept.name],
			"roster_count": all_staff[dept.name], "mappings": [{"node": n.name, "path": path(n),
				"pending": bool(n.manual_config.get("reporting_scope_pending")),
				"merged": dept.department_name in n.manual_config.get("roster_department_alias_labels", [])} for n in mapped]})
	return {"company": company, "departments": rows}
