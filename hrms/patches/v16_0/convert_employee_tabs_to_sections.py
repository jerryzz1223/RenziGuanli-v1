"""Remove the incompatible Employee Tab Break fieldtype overrides.

Frappe's Employee form uses Tab Breaks as part of its native column layout.
Changing their field types to Section Breaks compresses columns in the current
framework version.  The one-page presentation is therefore handled only by
CSS that shows each existing native tab pane; this patch restores the original
metadata and removes only the temporary Property Setters created for this
experiment.
"""

import frappe
EMPLOYEE_DOCTYPE = "Employee"
EMPLOYEE_TAB_FIELDNAMES = (
	"attendance_and_leave_details",
	"basic_details_tab",
	"connections_tab",
	"contact_details",
	"employment_details",
	"exit",
	"personal_details",
	"profile_tab",
	"salary_information",
)


def execute():
	if not frappe.db.exists("DocType", EMPLOYEE_DOCTYPE):
		return

	for fieldname in EMPLOYEE_TAB_FIELDNAMES:
		frappe.db.delete(
			"Property Setter",
			{
				"doc_type": EMPLOYEE_DOCTYPE,
				"field_name": fieldname,
				"property": "fieldtype",
				"value": "Section Break",
			},
		)

	frappe.clear_cache(doctype=EMPLOYEE_DOCTYPE)
