// Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

{% include 'hrms/hr/employee_property_update.js' %}

frappe.ui.form.on('Employee Transfer', {
	refresh(frm) {
		sync_employee_code_display(frm);
	},

	employee(frm) {
		frm.trigger("clear_property_table");
		sync_employee_code_display(frm);
	},
});

function sync_employee_code_display(frm) {
	const has_employee = Boolean(frm.doc.employee);
	frm.toggle_display("employee", !has_employee);
	frm.toggle_display("employee_code_display", has_employee);

	if (!has_employee) return;

	frm.set_df_property("employee_code_display", "label", __("员工工号"));
	load_employee_code_display(frm);
	add_change_employee_action(frm);
}

function load_employee_code_display(frm) {
	frappe.db
		.get_value("Employee", frm.doc.employee, ["custom_employee_code", "employee_number"])
		.then(({ message }) => {
			const employee_code_display = message?.custom_employee_code || message?.employee_number || "";
			if (employee_code_display && frm.doc.employee_code_display !== employee_code_display) {
				frm.set_value("employee_code_display", employee_code_display);
			}
		});
}

function add_change_employee_action(frm) {
	if (frm.__hrms_change_employee_action_ready) return;
	frm.__hrms_change_employee_action_ready = true;

	frm.add_custom_button(__("更换员工"), () => {
		frm.set_value("employee", "");
		frm.set_value("employee_code_display", "");
		frm.toggle_display("employee", true);
		frm.toggle_display("employee_code_display", false);
		frm.get_field("employee").set_focus();
	});
}
