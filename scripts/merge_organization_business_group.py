"""Merge only the verified empty business-group duplicate; preserve HR departments."""
import json
import frappe


def run(company="永新"):
	from hrms.api.organization_package import authorize, export_configuration, chart_module
	from hrms.api.organization_roster_sync import reconcile
	authorize(company)
	frappe.db.sql("select name from tabCompany where name=%s for update", company)
	nodes = chart_module()._get_manual_organization_records(company)["nodes"]
	targets = [n for n in nodes if n.display_name == "业务组" and n.manual_config.get("template_source_cell") == "CS18"]
	if len(targets) != 1: frappe.throw("未找到唯一的原表业务组，未合并。")
	target = targets[0]
	parents = {n.name: n for n in nodes}
	if not target.parent_node or parents[target.parent_node].display_name != "总办室": frappe.throw("原表业务组不在总办室下，未合并。")
	sources = [n for n in nodes if n.name != target.name and n.display_name == "业务组" and chart_module().whole_department(n.manual_config)]
	if not sources and "业务组" in target.manual_config.get("roster_department_alias_labels", []): return {"changed": False}
	if len(sources) != 1: frappe.throw("待合并业务组不唯一，未合并。")
	source = sources[0]
	department = frappe.get_doc("Department", source.manual_config["department"])
	if department.department_name != "业务组" or department.company != company or source.parent_node:
		frappe.throw("待合并业务组的部门或上级与预期不同。")
	if any(n.parent_node == source.name for n in nodes) or frappe.db.exists("Employee", {"company": company, "department": department.name, "status": "Active"}):
		frappe.throw("业务组已有人员或下级，请先逐项处理后合并。")
	backup = export_configuration(company)
	doc = frappe.get_doc("Organization Node", source.name)
	doc.confirmation_status = "不导入"
	doc.save()
	doc = frappe.get_doc("Organization Node", target.name)
	config = chart_module()._manual_node_config(doc.source_text)
	config["roster_department_alias_labels"] = list(dict.fromkeys([*config.get("roster_department_alias_labels", []), department.department_name]))
	doc.source_text = json.dumps(config, ensure_ascii=False, sort_keys=True)
	doc.save()
	result = reconcile(company)
	return {"changed": True, "target": target.name, "archived_duplicate": source.name, "backup": backup, "sync_changes": result["changed"]}
