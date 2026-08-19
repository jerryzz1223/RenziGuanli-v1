// Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

{% include 'hrms/hr/employee_property_update.js' %}
{% include 'hrms/hr/employee_business_code_selector.js' %}

frappe.ui.form.on('Employee Promotion', {
	setup(frm) {
		window.hrmsEmployeeBusinessCodeSelector.setup(frm);
	},

	refresh(frm) {
		window.hrmsEmployeeBusinessCodeSelector.refresh(frm);
		configure_confirmation_interview(frm);
	},

	employee(frm) {
		frm.trigger("clear_property_table");
		window.hrmsEmployeeBusinessCodeSelector.employee_selected(frm);
	},

	employee_code_display(frm) {
		window.hrmsEmployeeBusinessCodeSelector.resolve_employee(frm);
	},

	custom_confirmation_result(frm) {
		configure_confirmation_interview(frm);
	},
});

function configure_confirmation_interview(frm) {
	const is_confirmation_interview = Boolean(
		frm.doc.custom_is_confirmation_interview ||
		frm.doc.custom_confirmation_result ||
		(frm.doc.promotion_details || []).some((detail) =>
			["custom_is_confirmed", "final_confirmation_date"].includes(detail.fieldname),
		),
	);

	[
		"confirmation_interview_section",
		"custom_confirmation_interview_date",
		"custom_confirmation_interviewer",
		"custom_confirmation_interview_notes",
		"custom_confirmation_result",
	].forEach((fieldname) => frm.toggle_display(fieldname, is_confirmation_interview));

	if (!is_confirmation_interview) return;

	["custom_confirmation_interview_date", "custom_confirmation_interview_notes", "custom_confirmation_result"].forEach(
		(fieldname) => frm.set_df_property(fieldname, "reqd", 1),
	);

	if (frm.doc.custom_confirmation_result !== "转正不通过") return;
	if ((frm.doc.promotion_details || []).length) {
		frm.clear_table("promotion_details");
		frm.refresh_field("promotion_details");
		frappe.show_alert({ message: __("转正不通过不会修改员工档案"), indicator: "blue" });
	}
}
