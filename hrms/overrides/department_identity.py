"""Department identity based on the business name only.

Department links are shown throughout the HR workspace, so their document
names must remain readable business names.  Company ownership stays on the
``company`` field; it must not be appended to a department name such as
``连续课 - 11``.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cstr

from erpnext.setup.doctype.department.department import Department


def _legacy_company_suffix(company: str) -> str:
	company = cstr(company).strip()
	abbr = cstr(frappe.db.get_value("Company", company, "abbr")).strip() if company else ""
	return f" - {abbr}" if abbr else ""


def get_business_department_name(value: str, company: str = "") -> str:
	"""Return a clean, user-facing Department label or raise a clear error."""
	department_name = cstr(value).strip()
	legacy_suffix = _legacy_company_suffix(company)
	if legacy_suffix and department_name.endswith(legacy_suffix):
		department_name = department_name[: -len(legacy_suffix)].strip()
	if not department_name:
		frappe.throw(_("部门名称不能为空。"))
	if len(department_name) > 120:
		frappe.throw(_("部门名称不能超过 120 个字符。"))
	return department_name


def get_department_document_name(department_name: str, company: str = "") -> str:
	"""Build the stable Department Link value without a company suffix."""
	return get_business_department_name(department_name, company)


def validate_department_name_available(department_name: str, company: str = "", current_name: str = ""):
	"""Validate a globally unique business-name Link value."""
	company = cstr(company).strip()
	target_name = get_department_document_name(department_name, company)
	occupied = frappe.db.get_value("Department", target_name, ["name", "company"], as_dict=True)
	if occupied and occupied.name != current_name:
		frappe.throw(_("部门名称“{0}”已被公司“{1}”使用。请先区分业务名称，部门名称不再附加公司编号。").format(target_name, occupied.company or _("未设置公司")))
	return target_name


class DepartmentIdentity(Department):
	"""Keep both the visible label and Link value free from company suffixes."""

	def autoname(self):
		target_name = validate_department_name_available(
			self.department_name,
			company=cstr(self.company),
			current_name=cstr(self.name),
		)
		self.department_name = get_business_department_name(self.department_name, self.company)
		self.name = target_name

	def before_rename(self, old, new, merge=False):
		return validate_department_name_available(new, company=cstr(self.company), current_name=cstr(old))
