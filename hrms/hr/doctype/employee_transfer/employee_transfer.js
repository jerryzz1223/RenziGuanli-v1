// Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

{% include 'hrms/hr/employee_property_update.js' %}
{% include 'hrms/hr/employee_business_code_selector.js' %}

frappe.ui.form.on('Employee Transfer', {
	setup(frm) {
		window.hrmsEmployeeBusinessCodeSelector.setup(frm);
	},

	refresh(frm) {
		window.hrmsEmployeeBusinessCodeSelector.refresh(frm);
	},

	employee(frm) {
		frm.trigger("clear_property_table");
		window.hrmsEmployeeBusinessCodeSelector.employee_selected(frm);
	},

	employee_code_display(frm) {
		window.hrmsEmployeeBusinessCodeSelector.resolve_employee(frm);
	},
});
