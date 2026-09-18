"""Announcement document and its submission numbering rule."""

import html
import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime


class HRMSAnnouncement(Document):
	def validate(self):
		self.subject = (self.subject or "").strip()
		self.content = _normalise_content(self.content)
		self.receiving_units = _normalise_recipient_names(self.receiving_units)
		self.cc_units = _normalise_recipient_names(self.cc_units)
		self.issuer_name = (self.issuer_name or "").strip()
		self.approver_name = (self.approver_name or "").strip()
		if not self.subject:
			frappe.throw(_("请填写公告主旨。"))
		if not self.receiving_units:
			frappe.throw(_("请填写收文单位。"))
		if not self.issuing_unit:
			frappe.throw(_("请选择发文单位。"))
		if not self.issuer_name:
			frappe.throw(_("请填写发文者。"))
		self.company = frappe.db.get_value("Department", self.issuing_unit, "company") or self.company
		self.issuer_user = _resolve_user(self.issuer_name) or self.issuer_user

	def prepare_submission(self):
		"""Assign the business submission state without Frappe docstatus."""
		if self.announcement_number:
			return
		submitted_on = now_datetime()
		year = submitted_on.year
		month = submitted_on.month
		row = frappe.db.sql(
			"""
			SELECT sequence FROM `tabHRMS Announcement`
			WHERE announcement_year=%s AND announcement_month=%s
			ORDER BY sequence DESC LIMIT 1 FOR UPDATE
			""",
			(year, month),
			as_dict=True,
		)
		sequence = int(row[0].sequence or 0) + 1 if row else 1
		self.announcement_year = year
		self.announcement_month = month
		self.sequence = sequence
		self.announcement_number = format_announcement_number(year, month, sequence)
		self.status = "待审核"
		self.submitted_by = frappe.session.user
		self.submitted_on = submitted_on
		self.db_set(
			{
				"announcement_year": year,
				"announcement_month": month,
				"sequence": sequence,
				"announcement_number": self.announcement_number,
				"status": self.status,
				"submitted_by": self.submitted_by,
				"submitted_on": self.submitted_on,
			}
		)


def _resolve_user(value):
	value = str(value or "").strip()
	if not value:
		return None
	if frappe.db.exists("User", value):
		return value
	return frappe.db.get_value("User", {"full_name": value, "enabled": 1}, "name")


def _normalise_content(value):
	"""Keep rich text, but treat an empty editor shell as an empty body."""
	content = str(value or "").strip()
	if not content:
		return ""
	text = re.sub(r"<[^>]+>", "", content)
	text = re.sub(r"&(?:nbsp|#160);", " ", text, flags=re.IGNORECASE)
	if not html.unescape(text).strip() and not re.search(r"<(?:img|video|audio|svg)\b", content, flags=re.IGNORECASE):
		return ""
	return content


def _normalise_recipient_names(value):
	"""Match exact department/user names while preserving unmatched manual text."""
	parts = [part.strip() for part in re.split(r"[、,，;；\n]+", str(value or "")) if part.strip()]
	matched = []
	for part in parts:
		canonical = (
			frappe.db.get_value("Department", {"department_name": part}, "department_name")
			or frappe.db.get_value("Department", part, "department_name")
			or frappe.db.get_value("User", {"full_name": part, "enabled": 1}, "full_name")
			or part
		)
		matched.append(canonical)
	return "、".join(dict.fromkeys(matched))


def format_announcement_number(year, month, sequence):
	"""Format the business-facing number: YXSR + YY + MM + monthly sequence."""
	return f"YXSR{int(year) % 100:02d}{int(month):02d}{int(sequence):02d}"
