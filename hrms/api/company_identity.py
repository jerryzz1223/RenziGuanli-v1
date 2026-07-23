"""Safe company display-name administration for the HRMS desk.

``Company.name`` is a stable primary key in Frappe and is referenced by
employees, departments, attendance and payroll documents. This module only
updates the native ``company_name`` / ``abbr`` fields, so an administrator can
correct a user-facing company name without breaking those references.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cstr


def _require_company_admin():
	frappe.only_for("System Manager")


def _get_company(company: str):
	company = cstr(company).strip()
	if not company:
		frappe.throw(_("请选择需要管理的公司。"))
	return frappe.get_doc("Company", company)


@frappe.whitelist()
def get_company_identity(company: str):
	"""Return the editable, user-facing identity of one company."""
	_require_company_admin()
	doc = _get_company(company)
	return {
		"name": doc.name,
		"company_name": doc.company_name or doc.name,
		"abbr": doc.abbr,
		"country": doc.country,
		"note": _("公司编码用于关联部门、员工、考勤和薪资，修改显示名称不会影响既有数据。"),
	}


@frappe.whitelist()
def update_company_identity(company: str, company_name: str, abbr: str):
	"""Update only native display fields; never rename the linked company key."""
	_require_company_admin()
	doc = _get_company(company)
	company_name = cstr(company_name).strip()
	abbr = cstr(abbr).strip()

	if not company_name:
		frappe.throw(_("公司显示名称不能为空。"))
	if not abbr:
		frappe.throw(_("公司简称 / Abbr 不能为空。"))

	duplicate = frappe.db.exists("Company", {"company_name": company_name, "name": ["!=", doc.name]})
	if duplicate:
		frappe.throw(_("公司显示名称已被公司 {0} 使用，请换一个名称。").format(duplicate))

	doc.company_name = company_name
	doc.abbr = abbr
	doc.save()
	frappe.clear_cache(doctype="Company")

	return {
		"name": doc.name,
		"company_name": doc.company_name,
		"abbr": doc.abbr,
		"message": _("公司显示名称已更新；公司编码未变化，历史关联保持有效。"),
	}
