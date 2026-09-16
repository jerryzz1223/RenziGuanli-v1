function open_employee_separation_list(view) {
	window.hrmsSeparationListView = view;
	frappe.route_options = { docstatus: 0 };
	window.location.replace("/desk/employee-separation/view/list?docstatus=0");
}

function show_employee_separation_applications() {
	open_employee_separation_list("application");
}

frappe.pages["employee-separation-application"].on_page_load = show_employee_separation_applications;
frappe.pages["employee-separation-application"].on_page_show = show_employee_separation_applications;
