"""Real Frappe DB test with fake DingTalk sources; all DB changes roll back."""
import json
from unittest.mock import patch

import frappe


def run():
	from hrms.api import organization_dingtalk_linkage as api
	from hrms.api.organization_package import chart_module, version_options
	company = "TEST-DING-" + frappe.generate_hash(length=8)
	previous_user = frappe.session.user
	tokens, files = [], []
	frappe.set_user("Administrator")
	try:
		# Fixture company does not need chart-of-accounts/payment/default department
		# setup; that site's unrelated accounting fixtures may have dangling links.
		from erpnext.setup.doctype.company.company import Company
		with patch.object(Company, "on_update", return_value=None):
			frappe.get_doc({"doctype": "Company", "company_name": company,
				"abbr": "TD" + frappe.generate_hash(length=5), "default_currency": "CNY", "country": "China"}).insert()
		ctx = {"company": company, "corp_id": "fixture-corp", "connection": "fixture-connection"}
		def snapshot(rows):
			token = frappe.generate_hash(length=40)
			tokens.append(token)
			job = {**ctx, "user": "Administrator", "status": "ready", "rows": rows,
				"snapshot_hash": api.digest(rows), "pulled_at": "2026-11-04 12:00:00"}
			frappe.cache().set_value(api.key(token), job, expires_in_sec=1800)
			return token
		rows = [{"external_id": "2", "department_name": "试验事业部", "parent_id": "1"},
			{"external_id": "3", "department_name": "试验团队", "parent_id": "2"}]
		# The site's legacy chart entry point normalizes every company to Yongxin.
		# Keep this isolated fixture outside that business company throughout tests.
		with patch.object(api, "context", return_value=ctx), patch.object(chart_module(), "_normalize_yongxin_company", side_effect=lambda value: value):
			responses = {1: [{"dept_id": 2, "name": "试验事业部", "parent_id": 1}],
				2: [{"dept_id": 3, "name": "试验团队", "parent_id": 2}], 3: []}
			with patch.object(frappe, "enqueue"), patch.object(api.integration, "_require_api_sync_enabled"), patch.object(
				api.integration, "_dingtalk_api_request", side_effect=lambda *args, **kwargs: {"result": responses[kwargs["json_body"]["dept_id"]]}):
				token = api.queue_pull(company)["token"]
				tokens.append(token)
				assert api.pull_status(company, token)["status"] == "queued"
				api.run_pull(token)
				assert api.pull_status(company, token)["status"] == "ready"
				assert len(api.setup_rows(company, token)["rows"]) == 2
			assert not api.state(company)["nodes"]
			print("PASS: queued pull, recursive source validation and preview leave chart unchanged")
			preview = api.preview(company, token)
			assert preview["initial"]
			result = api.apply(company, token, preview["fingerprint"], '{"2":"source","3":"source"}', "首次建立试验")
			files.append(result["audit_file"])
			first = api.state(company)
			assert len(first["nodes"]) == 2
			tree = chart_module().get_hybrid_tree(company)
			assert tree["root"]["children"][0]["node_type"] == "organization_department"
			assert tree["root"]["children"][0]["children"][0]["name"] == "试验团队"
			maps = first["options"]["dingtalk_department_maps"]
			parent, child = maps["2"]["node"], maps["3"]["node"]
			assert frappe.db.get_value("Organization Node", child, "parent_node") == parent
			assert api.apply(company, token, preview["fingerprint"], '{"2":"source"}', "重试")["duplicate"]
			assert len(api.state(company)["nodes"]) == 2
			print("PASS: first build creates editable nodes and departments; parent hierarchy and retry idempotence")

			# Use the real manual-edit API, preserving business department identity.
			child_doc = frappe.get_doc("Organization Node", child)
			cfg = json.loads(child_doc.source_text)
			chart_module().save_manual_organization_node("部门", display_name="人工加工团队", department=cfg["department"],
				parent_node=None, planned_headcount=7, company=company, node_name=child)
			manual = frappe.get_doc("Organization Node", child)
			assert manual.display_name == "人工加工团队" and not manual.parent_node
			assert manual.planned_headcount == 7
			print("PASS: normal manual-edit API accepts imported generic department; name, placement and staffing editable")

			rows2 = [dict(rows[0], department_name="钉钉事业部新名"), dict(rows[1], department_name="钉钉团队新名"),
				{"external_id": "4", "department_name": "试验新部门", "parent_id": "2"}]
			token2 = snapshot(rows2)
			preview2 = api.preview(company, token2)
			assert next(r for r in preview2["rows"] if r["external_id"] == "3")["manual_changes"]
			result = api.apply(company, token2, preview2["fingerprint"], '{"2":"source","3":"keep","4":"source"}', "同步但保留人工加工")
			files.append(result["audit_file"])
			manual.reload()
			assert manual.display_name == "人工加工团队" and not manual.parent_node and manual.planned_headcount == 7
			assert len(api.state(company)["nodes"]) == 3
			assert frappe.db.get_value("Organization Node", parent, "display_name") == "钉钉事业部新名"
			print("PASS: subsequent sync updates selected nodes and adds departments while preserving manual name, parent and staffing")

			token3 = snapshot(rows2)
			preview3 = api.preview(company, token3)
			manual.display_name = "预览后人工修改"
			manual.save()
			try:
				api.apply(company, token3, preview3["fingerprint"], '{"3":"source"}', "失效预览试验")
				raise AssertionError("stale preview was accepted")
			except frappe.ValidationError:
				pass
			preview3 = api.preview(company, token3)
			result = api.apply(company, token3, preview3["fingerprint"], '{"3":"source"}', "明确采用来源覆盖人工名称与上级")
			files.append(result["audit_file"])
			manual.reload()
			assert manual.display_name == "钉钉团队新名" and manual.parent_node == parent and manual.planned_headcount == 7
			print("PASS: stale preview rejected; explicit source choice updates name/parent and preserves staffing")

			# A failure after writes must restore the complete pre-application state.
			token4 = snapshot([dict(rows[0], department_name="回滚名称")])
			preview4 = api.preview(company, token4)
			before = api.state(company)
			with patch("frappe.utils.file_manager.save_file", side_effect=RuntimeError("fixture audit failure")):
				try:
					api.apply(company, token4, preview4["fingerprint"], '{"2":"source"}', "失败回滚试验")
					raise AssertionError("failed audit accepted")
				except RuntimeError:
					pass
			assert api.state(company) == before
			assert preview4["missing_source"]
			print("PASS: missing sources retained; mid-application audit failure rolls back organization changes")
			assert not frappe.db.exists("Employee", {"company": company})
			for url in files:
				assert frappe.db.get_value("File", {"file_url": url}, "is_private")
			print("PASS: no employee master writes; audit files private")
	finally:
		frappe.db.rollback()
		for token in tokens:
			frappe.cache().delete_value(api.key(token))
		# File content is outside SQL transactions; delete only this test's files.
		from pathlib import Path
		for url in files:
			path = Path(frappe.get_site_path(url.lstrip("/")))
			if path.is_file() and path.name.startswith("organization-dingtalk-"):
				path.unlink()
		frappe.set_user(previous_user)
	assert not frappe.db.exists("Company", company)
	print("PASS: test company, departments, nodes and mappings rolled back; cached fixtures and audit files removed")
