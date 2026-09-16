"""Shared business rule for employee-selectable and reportable departments."""

from __future__ import annotations


def _value(row, fieldname):
	if isinstance(row, dict):
		return row.get(fieldname)
	return getattr(row, fieldname, None)


def is_business_department(row) -> bool:
	"""Return false for organization groups, which are not employee departments."""
	if isinstance(row, str):
		name = row
	else:
		name = _value(row, "department_name") or _value(row, "name") or ""
	role = "" if isinstance(row, str) else str(_value(row, "hrms_org_role") or "").strip()
	node_type = "" if isinstance(row, str) else str(_value(row, "node_type") or "").strip().lower()
	return role != "组" and node_type != "team" and not str(name).strip().endswith("组")


def business_departments(rows):
	return [row for row in rows if is_business_department(row)]


def organization_report_from_tree(root, report_kinds=("室", "课")):
	"""Build report rows only from the standalone Organization Node tree."""
	rows = []

	def number(value):
		try:
			return int(value or 0)
		except (TypeError, ValueError):
			return 0

	def walk(node, parent_name="", level=0):
		kind = str(node.get("organization_node_type") or "").strip()
		name = str(node.get("name") or "").strip()
		if kind in report_kinds:
			planned = number(node.get("planned_headcount"))
			current = number(node.get("current_headcount"))
			vacancy = number(node.get("vacancy_count"))
			rows.append({
				"department": name,
				"parent_department": parent_name,
				"level": level,
				"planned_headcount": planned,
				"current_headcount": current,
				"vacancy_count": vacancy,
				"fulfillment_rate": (current / planned) if planned else None,
				"vacancy_notes": str(node.get("recruitment_plan") or node.get("notes") or "").strip(),
			})
		for child in node.get("children") or []:
			walk(child, name if kind in report_kinds else parent_name, level + 1)

	if root:
		walk(root)
	total_planned = sum(row["planned_headcount"] for row in rows)
	total_current = sum(row["current_headcount"] for row in rows)
	total_vacancy = sum(row["vacancy_count"] for row in rows)
	return {
		"rows": rows,
		"total": {
			"planned_headcount": total_planned,
			"current_headcount": total_current,
			"vacancy_count": total_vacancy,
			"fulfillment_rate": (total_current / total_planned) if total_planned else None,
		},
	}
