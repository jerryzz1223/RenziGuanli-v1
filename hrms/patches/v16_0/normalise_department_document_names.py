"""Remove legacy company suffixes from Department document names safely."""

from collections import defaultdict

import frappe

from hrms.overrides.department_identity import get_department_document_name


def _rename_plan():
	departments = frappe.get_all(
		"Department",
		fields=["name", "department_name", "company", "lft"],
		order_by="lft desc",
		limit_page_length=0,
	)
	changes = [
		{"name": row.name, "target_name": get_department_document_name(row.department_name, row.company)}
		for row in departments
		if row.name != get_department_document_name(row.department_name, row.company)
	]
	sources_by_target = defaultdict(list)
	for row in changes:
		sources_by_target[row["target_name"]].append(row["name"])
	conflicts = [target for target, sources in sources_by_target.items() if len(sources) > 1]
	source_names = {row["name"] for row in changes}
	for target in sources_by_target:
		occupied = frappe.db.get_value("Department", target, ["name"], as_dict=True)
		if occupied and occupied.name not in source_names:
			conflicts.append(target)
	if conflicts:
		frappe.throw("部门名称去除公司后缀已中止：存在重复业务名称 " + "、".join(sorted(set(conflicts))))
	return changes


def execute():
	if not frappe.db.exists("DocType", "Department"):
		return
	changes = _rename_plan()
	for row in changes:
		frappe.rename_doc("Department", row["name"], row["target_name"], force=True, show_alert=False, rebuild_search=False)
	frappe.clear_cache(doctype="Department")
	if changes:
		print("已去除部门公司后缀并同步关联字段：{0} 个部门。".format(len(changes)))
