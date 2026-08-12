"""Keep attendance-batch status choices synchronized on every site upgrade.

The workflow writes ``结构异常`` when a monthly support workbook fails its
structural validation.  This is a workflow-level state, not a one-month data
fix, so the DocType metadata must be synchronized for every site.
"""

import frappe


DOCTYPE = "HRMS Attendance Import Batch"
STATUS_FIELD = "status"
REQUIRED_STATUS = "结构异常"


def execute():
	# Reload the app-owned DocType JSON first.  This updates sites that have
	# never had a custom status field override.
	frappe.reload_doc("hr", "doctype", "hrms_attendance_import_batch")

	# A Property Setter can override the JSON's Select options.  Preserve any
	# customer-added choices, but append the workflow state if an older override
	# omitted it.  This makes future monthly imports safe on upgraded sites too.
	property_setter_name = frappe.db.get_value(
		"Property Setter",
		{"doc_type": DOCTYPE, "field_name": STATUS_FIELD, "property": "options"},
		"name",
	)
	if property_setter_name:
		property_setter = frappe.get_doc("Property Setter", property_setter_name)
		options = [value for value in (property_setter.value or "").splitlines() if value]
		if REQUIRED_STATUS not in options:
			options.append(REQUIRED_STATUS)
			property_setter.value = "\n".join(options)
			property_setter.save(ignore_permissions=True)

	frappe.clear_cache(doctype=DOCTYPE)
