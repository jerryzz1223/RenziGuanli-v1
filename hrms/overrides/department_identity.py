"""Department naming policy for the Yongxin HRMS site.

ERPNext normally appends the company abbreviation to ``Department.name``.
That is useful for a multi-company ERP, but it leaks technical identifiers
such as ``行政课 - 1D`` into the HR workspace.  This override makes the
business department name the document name instead.  A department name is
therefore unique across the site; the system does not silently add a suffix
when another company already uses the same name.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cstr

from erpnext.setup.doctype.department.department import Department


def get_business_department_name(value: str) -> str:
	"""Return a clean, user-facing Department name or raise a clear error."""
	department_name = cstr(value).strip()
	if not department_name:
		frappe.throw(_("部门名称不能为空。"))
	if len(department_name) > 140:
		frappe.throw(_("部门名称不能超过 140 个字符。"))
	return department_name


def validate_department_name_available(department_name: str, company: str = "", current_name: str = ""):
	"""Prevent hidden suffixes and explain cross-company name conflicts."""
	department_name = get_business_department_name(department_name)
	existing = frappe.db.get_value("Department", department_name, ["name", "company"], as_dict=True)
	if existing and existing.name != current_name:
		company_label = existing.company or _("未设置公司")
		frappe.throw(
			_(
				"部门名称“{0}”已被公司“{1}”使用。为保证链接字段一致，系统不会自动追加公司后缀；"
				"请使用不同的部门名称，或先处理同名的旧部门。"
			).format(department_name, company_label)
		)
	return department_name


class DepartmentIdentity(Department):
	"""Use ``department_name`` as the stable Frappe primary key."""

	def autoname(self):
		self.name = validate_department_name_available(
			self.department_name,
			company=cstr(self.company),
			current_name=cstr(self.name),
		)

	def before_rename(self, old, new, merge=False):
		# The ERPNext base class re-adds ``- Company Abbr`` here.  Returning the
		# plain business name is necessary for both bulk and single-record cleanup.
		return validate_department_name_available(new, company=cstr(self.company), current_name=cstr(old))
