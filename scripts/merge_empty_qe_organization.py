"""Merge the verified empty QE chart duplicate; retain Department and a backup."""
import json
import frappe


def run(company="永新"):
	from hrms.api.organization_package import authorize, export_configuration, chart_module
	from hrms.api.organization_roster_sync import reconcile
	authorize(company)
	frappe.db.sql("select name from tabCompany where name=%s for update", company)
	nodes = chart_module()._get_manual_organization_records(company)["nodes"]
	targets = [n for n in nodes if n.display_name == "QE组" and n.manual_config.get("template_source_cell") == "CP18"]
	if len(targets) != 1:
		frappe.throw("未找到唯一的原表 QE 组，未合并。")
	target = targets[0]
	sources = [n for n in nodes if n.name != target.name and n.display_name == "QE组" and chart_module().whole_department(n.manual_config)]
	if not sources and "QE组" in target.manual_config.get("roster_department_alias_labels", []):
		return {"changed": False}
	if len(sources) != 1:
		frappe.throw("待合并 QE 组不唯一，未合并。")
	source = sources[0]
	department = frappe.get_doc("Department", source.manual_config["department"])
	if department.company != company or department.department_name != "QE组" or source.parent_node != target.parent_node:
		frappe.throw("部门或上级与待修复记录不一致，未合并。")
	cfg = source.manual_config
	if (source.planned_headcount or cfg.get("planned_headcount_set") or cfg.get("template_bindings")
		or any(cfg.get(k) for k in ("employee", "primary_employee", "proxy_employee", "manager_employee", "assigned_employees"))
		or any(n.parent_node == source.name for n in nodes)
		or frappe.db.exists("Employee", {"company": company, "department": department.name, "status": "Active"})):
		frappe.throw("该 QE 组已有编制、任职、人员或下级，不能按空节点合并。")
	backup = export_configuration(company)
	doc = frappe.get_doc("Organization Node", source.name)
	doc.confirmation_status = "不导入"
	doc.save()
	doc = frappe.get_doc("Organization Node", target.name)
	cfg = chart_module()._manual_node_config(doc.source_text)
	cfg["roster_department_alias_labels"] = list(dict.fromkeys([*cfg.get("roster_department_alias_labels", []), "QE组"]))
	doc.source_text = json.dumps(cfg, ensure_ascii=False, sort_keys=True)
	doc.save()
	sync = reconcile(company)
	return {"changed": True, "target": target.name, "retired_duplicate": source.name,
		"backup": backup["file_url"], "sync_changes": sync["changed"]}
