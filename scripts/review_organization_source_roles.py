"""Idempotently remove the historic inferred 连续课 proxy; retain the source roles.

Only generated, unconfirmed bindings are corrected. Explicit manual decisions win.
The original workbook is read-only and every changed node is privately backed up.
"""
import json
from pathlib import Path
import frappe
from frappe.utils import now_datetime


def run(commit=False):
	from openpyxl import load_workbook
	from hrms.api.organization_package import chart_module
	from hrms.api.organization_roster_sync import reconcile
	from scripts.restore_organization_template import DEPARTMENT_CELLS, SOURCE_DOC
	frappe.only_for("System Manager")
	chart = chart_module()
	frappe.db.sql("select name from tabCompany where name=%s for update", "永新")
	manual = chart._get_manual_organization_records("永新")
	source = chart._resolve_yongxin_org_workbook()
	assert source.name == SOURCE_DOC
	book = load_workbook(source, data_only=True, read_only=True)
	try:
		sheet = book["26Q3组织架构图"]
		text = str(sheet["J13"].value)
		assert "刘洪州" in text and "李旭" in text and not text.split("代理人：", 1)[1].strip()
		changes = []
		for node in manual["nodes"]:
			cfg = dict(node.manual_config)
			if not cfg.get("template_leadership") or cfg.get("assignment_rules_manual") or cfg.get("template_source_document") != SOURCE_DOC: continue
			cell = DEPARTMENT_CELLS.get(cfg.get("department"))
			if not cell: continue
			cfg["template_leadership_cell"] = "ES18" if cfg["department"] == "量试组" else cell.replace("14", "13")
			if cfg["department"] == "连续课":
				cfg["template_bindings"] = [dict(b) for b in cfg.get("template_bindings", [])]
				for b in cfg["template_bindings"]:
					if b.get("source_name") in {"李旭", "刘洪州"} and not b.get("manual_confirmed"):
						b.update(slot="primary", role="课长", source_role="课长", display_only=False)
				cfg["proxy_employee"] = None
				cfg["primary_employee"] = None  # The source lists two holders; do not choose one.
			if cfg != node.manual_config: changes.append((node.name, cfg))
	finally: book.close()
	backup = None
	if changes:
		backup = Path(frappe.get_site_path("private", "backups", "organization-role-review-" + now_datetime().strftime("%Y%m%d-%H%M%S-%f") + ".json"))
		backup.parent.mkdir(parents=True, exist_ok=True)
		backup.write_text(frappe.as_json([frappe.get_doc("Organization Node", name).as_dict() for name, cfg in changes]), encoding="utf-8")
		backup.chmod(0o600)
		for name, cfg in changes:
			doc = frappe.get_doc("Organization Node", name)
			doc.source_text = json.dumps(cfg, ensure_ascii=False, sort_keys=True)
			doc.save()
	result = {"changed": len(changes), "backup": str(backup) if backup else None, "sync": reconcile("永新")}
	if commit: frappe.db.commit()
	return result
