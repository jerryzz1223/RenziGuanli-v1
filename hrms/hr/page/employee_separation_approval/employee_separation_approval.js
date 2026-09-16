function open_employee_separation_list(view) {
	window.hrmsSeparationListView = view;
	frappe.route_options = { docstatus: 1, boarding_status: "Pending" };
	window.location.replace("/desk/employee-separation/view/list?docstatus=1&boarding_status=Pending");
}

function show_employee_separation_approvals() {
	open_employee_separation_list("approval");
}

frappe.pages["employee-separation-approval"].on_page_load = show_employee_separation_approvals;
frappe.pages["employee-separation-approval"].on_page_show = show_employee_separation_approvals;
