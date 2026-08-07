function redirect_legacy_employee_archive() {
	frappe.set_route("List", "Employee");
}

frappe.pages["employee-archive"].on_page_load = function () {
	redirect_legacy_employee_archive();
};

frappe.pages["employee-archive"].on_page_show = function () {
	redirect_legacy_employee_archive();
};
