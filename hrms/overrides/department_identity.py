"""Company-scoped Department identity with clean business labels.

``Department.department_name`` remains the user-facing name.  The document
primary key includes the Company abbreviation so two companies can both own a
department such as "Human Resources" without link ambiguity.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cstr

from erpnext.setup.doctype.department.department import Department


def get_business_department_name(value: str) -> str:
	"""Return a clean, user-facing Department label or raise a clear error."""
	department_name = cstr(value).strip()
	if not department_name:
		frappe.throw(_("部门名称不能为空。"))
	if len(department_name) > 120:
		frappe.throw(_("部门名称不能超过 120 个字符。"))
	return department_name


def get_department_document_name(department_name: str, company: str = "") -> str:
	"""Build the stable, company-scoped Link value for a Department."""
	business_name = get_business_department_name(department_name)
	company = cstr(company).strip()
	if not company:
		return business_name
	abbr = cstr(frappe.db.get_value("Company", company, "abbr")).strip()
	if not abbr:
		frappe.throw(_("公司 {0} 缺少简称，无法生成稳定的部门编码。").format(company))
	suffix = f" - {abbr}"
	if business_name.endswith(suffix):
		business_name = business_name[: -len(suffix)].strip()
	return f"{business_name}{suffix}"


def validate_department_name_available(department_name: str, company: str = "", current_name: str = ""):
	"""Validate uniqueness inside one company and return the stable Link value."""
	company = cstr(company).strip()
	target_name = get_department_document_name(department_name, company)
	suffix = f" - {cstr(frappe.db.get_value('Company', company, 'abbr')).strip()}" if company else ""
	business_name = get_business_department_name(department_name)
	if suffix and business_name.endswith(suffix):
		business_name = business_name[: -len(suffix)].strip()

	existing = frappe.db.get_value(
		"Department",
		{"company": company, "department_name": business_name},
		["name", "company"],
		as_dict=True,
	)
	if existing and existing.name != current_name:
		frappe.throw(_("公司“{0}”已存在部门“{1}”。").format(company or _("未设置公司"), business_name))

	occupied = frappe.db.get_value("Department", target_name, ["name", "company"], as_dict=True)
	if occupied and occupied.name != current_name:
		frappe.throw(_("部门编码“{0}”已被公司“{1}”使用。").format(target_name, occupied.company or _("未设置公司")))
	return target_name


class DepartmentIdentity(Department):
	"""Keep the visible label clean while making the primary key company-safe."""

	def autoname(self):
		target_name = validate_department_name_available(
			self.department_name,
			company=cstr(self.company),
			current_name=cstr(self.name),
		)
		company_abbr = cstr(frappe.db.get_value("Company", self.company, "abbr")).strip() if self.company else ""
		suffix = f" - {company_abbr}" if company_abbr else ""
		if suffix and cstr(self.department_name).strip().endswith(suffix):
			self.department_name = cstr(self.department_name).strip()[: -len(suffix)].strip()
		self.name = target_name

	def before_rename(self, old, new, merge=False):
		return validate_department_name_available(new, company=cstr(self.company), current_name=cstr(old))
