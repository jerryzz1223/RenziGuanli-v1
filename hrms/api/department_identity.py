"""Safe tools for normalising legacy Department document names."""

from __future__ import annotations

from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import cstr

from hrms.overrides.department_identity import get_department_document_name, validate_department_name_available


CONFIRMATION_TEXT = "确认规范部门名称"


def _require_department_name_admin():
	frappe.only_for("System Manager")


def _get_company(company: str) -> str:
	company = cstr(company).strip()
	if not company:
		frappe.throw(_("请选择公司。"))
	if not frappe.db.exists("Company", company):
		frappe.throw(_("公司 {0} 不存在。").format(company))
	return company


def _get_normalisation_plan(company: str) -> dict:
	company = _get_company(company)
	departments = frappe.get_all(
		"Department",
		filters={"company": company},
		fields=["name", "department_name", "parent_department", "lft"],
		order_by="lft desc",
		limit_page_length=0,
	)

	changes = []
	target_sources = defaultdict(list)
	for department in departments:
		target_name = get_department_document_name(department.department_name, company)
		if department.name == target_name:
			continue
		row = {
			"name": department.name,
			"department_name": department.department_name,
			"target_name": target_name,
			"parent_department": department.parent_department,
			"lft": department.lft or 0,
		}
		changes.append(row)
		target_sources[target_name].append(row)

	conflicts = []
	for target_name, rows in target_sources.items():
		if len(rows) > 1:
			conflicts.append(
				{
					"type": "duplicate_target",
					"target_name": target_name,
					"message": _("本公司有多个部门都要改为“{0}”。").format(target_name),
					"sources": [row["name"] for row in rows],
				}
			)

		occupied = frappe.db.get_value("Department", target_name, ["name", "company"], as_dict=True)
		if occupied and occupied.name not in {row["name"] for row in rows}:
			conflicts.append(
				{
					"type": "name_taken",
					"target_name": target_name,
					"message": _("目标名称“{0}”已被公司“{1}”的部门占用。").format(
						target_name, occupied.company or _("未设置公司")
					),
					"sources": [row["name"] for row in rows],
				}
			)

	source_names = [row["name"] for row in changes]
	employee_count = frappe.db.count("Employee", {"department": ["in", source_names]}) if source_names else 0
	child_count = frappe.db.count("Department", {"parent_department": ["in", source_names]}) if source_names else 0

	return {
		"company": company,
		"total_departments": len(departments),
		"rename_count": len(changes),
		"unchanged_count": len(departments) - len(changes),
		"can_execute": not conflicts,
		"confirmation_text": CONFIRMATION_TEXT,
		"changes": changes,
		"conflicts": conflicts,
		"linked_records": {
			"employees": employee_count,
			"child_departments": child_count,
		},
		"note": _(
			"执行时会使用系统的正式重命名机制更新所有 Link 关联；不会创建新部门，也不会修改员工所属公司。"
		),
	}


@frappe.whitelist()
def preview_department_name_normalisation(company: str):
	"""Return a read-only preflight for removing legacy company suffixes."""
	_require_department_name_admin()
	return _get_normalisation_plan(company)


def rename_department_document(department: str, new_name: str = "") -> str:
	"""Rename one Department through Frappe so every Link field is updated."""
	if not department or not frappe.db.exists("Department", department):
		frappe.throw(_("部门不存在。"))
	doc = frappe.get_doc("Department", department)
	doc.check_permission("write")
	target_name = validate_department_name_available(new_name or doc.department_name, doc.company, doc.name)
	if target_name == doc.name:
		return doc.name

	return frappe.rename_doc(
		"Department",
		doc.name,
		target_name,
		force=True,
		show_alert=False,
		rebuild_search=False,
	)


@frappe.whitelist()
def rename_department_to_business_name(department: str, confirmation: str = ""):
	"""Rename one legacy Department after an explicit confirmation."""
	_require_department_name_admin()
	if cstr(confirmation).strip() != CONFIRMATION_TEXT:
		frappe.throw(_("请准确输入“{0}”后再执行。").format(CONFIRMATION_TEXT))
	new_name = rename_department_document(department)
	frappe.clear_cache(doctype="Department")
	return {"name": new_name, "message": _("部门正式名称已更新。")}


@frappe.whitelist()
def normalise_department_names(company: str, confirmation: str = ""):
	"""Rename all safe legacy departments in one company, or abort without writes."""
	_require_department_name_admin()
	if cstr(confirmation).strip() != CONFIRMATION_TEXT:
		frappe.throw(_("请准确输入“{0}”后再执行。").format(CONFIRMATION_TEXT))

	plan = _get_normalisation_plan(company)
	if plan["conflicts"]:
		frappe.throw(_("预检发现同名冲突，未执行任何更改。请先处理冲突后再试。"))

	renamed = []
	for row in plan["changes"]:
		new_name = rename_department_document(row["name"], row["target_name"])
		renamed.append({"old_name": row["name"], "new_name": new_name})

	frappe.clear_cache(doctype="Department")
	return {
		"company": plan["company"],
		"renamed": renamed,
		"renamed_count": len(renamed),
		"message": _("已完成 {0} 个部门的正式名称规范化。所有关联字段已由系统同步更新。").format(len(renamed)),
	}
