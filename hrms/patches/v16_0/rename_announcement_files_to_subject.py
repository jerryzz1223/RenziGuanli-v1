"""Rename retained announcement files to the announcement subject suffix."""

import frappe

from hrms.api.announcement import _announcement_filename, _file_extension


def execute():
	for row in frappe.get_all(
		"HRMS Announcement",
		fields=["name", "announcement_number", "subject", "word_template", "excel_template", "signed_attachment"],
		limit_page_length=0,
	):
		if not row.announcement_number:
			continue
		for fieldname, default_extension in (
			("word_template", ".docx"),
			("excel_template", ".xlsx"),
			("signed_attachment", ""),
		):
			file_url = row.get(fieldname)
			if not file_url:
				continue
			file_name = frappe.db.get_value("File", {"file_url": file_url}, "name")
			if not file_name:
				continue
			file_doc = frappe.get_doc("File", file_name)
			extension = default_extension or _file_extension(file_doc.file_name or file_doc.file_url) or ".docx"
			desired_name = _announcement_filename(row, extension)
			if file_doc.file_name != desired_name:
				file_doc.db_set("file_name", desired_name, update_modified=False)
