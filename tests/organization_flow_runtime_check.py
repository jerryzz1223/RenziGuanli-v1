"""Local Frappe regression; every business change is rolled back."""
from copy import deepcopy
from unittest.mock import patch
import frappe


def run():
	from hrms.api import employee_field_template as roster
	from hrms.api.organization_package import target_state, workbook_bytes, read_content, prepare
	from hrms.api.organization_flow import reference_report, get_department_flow
	from scripts.merge_empty_qe_organization import run as merge_qe
	company = "永新"
	before = target_state(company)
	name = "流程回归部门" + frappe.generate_hash(length=8)
	try:
		resolved, error = roster._resolve_roster_department(name, company)
		assert resolved == name and not error and not frappe.db.exists("Department", name)
		counts = {"部门": 0}
		resolved, error = roster._resolve_roster_department(name, company, create=True, base_records=counts)
		assert resolved == name and not error and counts["部门"] == 1
		roster._resolve_roster_department(name, company, create=True, base_records=counts)
		assert counts["部门"] == 1
		frappe.db.set_value("Department", name, "disabled", 1)
		frappe.clear_document_cache("Department", name)
		assert "已停用" in roster._resolve_roster_department(name, company)[1]
		frappe.db.rollback()
		assert not frappe.db.exists("Department", name)

		# An invalid employee row must not leave the newly recognized department behind.
		result = {"failed": 0, "skipped": 0, "errors": [], "failed_rows": [], "warnings": []}
		planned = [{"row_index": 2, "row": [], "action": "insert", "existing": None,
			"values": {"company": company, "department": name}}]
		with patch.object(roster, "_build_employee_roster_import_plan", return_value=(deepcopy(result), planned, {"company", "department"})), patch.object(frappe.db, "commit"):
			out = roster.import_employee_roster("test")
		assert out["failed"] == 1 and out["base_records"]["部门"] == 0
		assert not frappe.db.exists("Department", name), "failed employee left an orphan department"
		frappe.db.rollback()
		people = [e for e in before["employees"] if e.custom_employee_code in {"260501", "3013"}]
		assert len(people) == 2
		planned = [{"row_index": i + 2, "row": [], "action": "update", "existing": e.name,
			"values": {"company": company, "department": name}} for i, e in enumerate(people)]
		with patch.object(roster, "_build_employee_roster_import_plan", return_value=(deepcopy(result), planned, {"company", "department"})), patch.object(frappe.db, "commit"):
			out = roster.import_employee_roster("test")
		assert not out["failed"] and out["updated"] == 2 and out["base_records"]["部门"] == 1, out
		assert all(frappe.db.get_value("Employee", e.name, "department") == name for e in people)
		frappe.db.rollback()

		references = reference_report(before)
		assert len(references) == 19
		assert sum(r["status"] == "仅找到同名非在职档案" for r in references) == 16
		assert sum(not r["candidates"] for r in references) == 2
		assert reference_report(before) == references and target_state(company) == before
		assert any(r["source_name"] == "林俊松" and r["candidates"][0]["code"] == "1" for r in references)

		merged = merge_qe(company)
		had_duplicate = len([n for n in before["manual"]["nodes"] if n.display_name == "QE组"]) > 1
		assert merged["changed"] == had_duplicate
		assert not merge_qe(company)["changed"], "merge must be idempotent"
		after = target_state(company)
		assert before["employees"] == after["employees"] and before["departments"] == after["departments"]
		assert len([n for n in after["manual"]["nodes"] if n.display_name == "QE组"]) == 1
		qe = next(r for r in get_department_flow(company)["departments"] if r["label"] == "QE组")
		assert len(qe["mappings"]) == 1 and qe["mappings"][0]["merged"]
		plan = prepare(company, read_content(workbook_bytes(company)))
		assert not plan["errors"], plan["errors"]
		# Cross-server import: target still has an empty standalone department node.
		from hrms.api.organization_package import save_private, apply_configuration
		from hrms.api.organization_roster_sync import reconcile
		import json
		content = workbook_bytes(company)
		target = frappe.get_doc("Organization Node", "MANUAL-4D06EB8A01")
		cfg = json.loads(target.source_text)
		cfg["roster_department_alias_labels"] = []
		target.source_text = json.dumps(cfg, ensure_ascii=False)
		target.save()
		frappe.db.set_value("Organization Node", "MANUAL-DFBE9CB1CB", "confirmation_status", "已确认")
		plan = prepare(company, read_content(content))
		assert not plan["errors"] and plan["merged_empty_count"] == 1, plan["errors"]
		frappe.db.set_value("Organization Node", "MANUAL-DFBE9CB1CB", "planned_headcount", 1)
		blocked = prepare(company, read_content(content))
		assert blocked["errors"] and not blocked["merged_empty_count"], "occupied plan must block automatic merge"
		frappe.db.set_value("Organization Node", "MANUAL-DFBE9CB1CB", "planned_headcount", 0)
		plan = prepare(company, read_content(content))
		url = save_private(content, "组织流程回滚验证", company)["file_url"]
		applied = apply_configuration(company, url, plan["fingerprint"], auto_sync=1)
		assert applied["merged_empty_count"] == 1
		reconcile(company)
		assert frappe.db.get_value("Organization Node", "MANUAL-DFBE9CB1CB", "confirmation_status") == "不导入"
		assert not prepare(company, read_content(content))["errors"]
		assert target_state(company)["employees"] == before["employees"]
		print("PASS: read-only department preview; create once; disabled guard; failed-row rollback; 19 reference diagnostics; QE merge and repeated sync; portable configuration")
	finally:
		frappe.db.rollback()
	assert target_state(company) == before
	print("PASS: business data restored")
