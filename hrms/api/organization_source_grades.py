"""Carry original draft grade labels as source evidence, without ranking them."""
from collections import defaultdict

import frappe


def source_grade_evidence(company, nodes):
	versions = frappe.get_all("Organization Structure Version", filters={"company": company, "status": ["!=", "已归档"]},
		fields=["name", "source_file_name", "source_sheet"])
	versions = {v.name: v for v in versions if v.source_file_name and v.source_sheet}
	if not versions:
		return {}
	positions = frappe.get_all("Organization Position", filters={"structure_version": ["in", list(versions)], "confirmation_status": ["!=", "不导入"]},
		fields=["name", "structure_version", "source_sheet", "source_cell", "confirmation_status"])
	if not positions:
		return {}
	links = frappe.get_all("Organization Position Grade Tag", filters={"parent": ["in", [p.name for p in positions]], "parenttype": "Organization Position"}, fields=["parent", "grade_tag"], order_by="idx")
	tags = {t.name: t.tag_name for t in frappe.get_all("Grade Tag", filters={"enabled": 1}, fields=["name", "tag_name"])}
	by_position = defaultdict(list)
	for link in links:
		if link.grade_tag in tags:
			by_position[link.parent].append(tags[link.grade_tag])
	by_source = defaultdict(list)
	for position in positions:
		version = versions[position.structure_version]
		if position.source_sheet != version.source_sheet or not position.source_cell:
			continue
		by_source[(version.source_file_name, position.source_cell)].append((version, position))
	result = {}
	for node in nodes:
		cfg = node.manual_config
		if "source_grade_tags" in cfg:
			continue  # Imported/manual evidence, including an explicit empty value, wins.
		matches = by_source.get((cfg.get("template_source_document"), cfg.get("template_source_cell")), [])
		if len(matches) != 1:
			continue  # Do not guess across versions or worksheets sharing a cell address.
		version, position = matches[0]
		labels = list(dict.fromkeys(by_position[position.name]))
		if labels:
			result[node.name] = {"source_grade_tags": "\n".join(labels),
				"source_grade_reference": f"{version.source_file_name} / {version.source_sheet} / {position.source_cell} / {version.name}",
				"source_grade_status": position.confirmation_status or "待确认"}
	return result
