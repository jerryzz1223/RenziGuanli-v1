frappe.pages["employee-duty-change"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("员工职务调动申请表"), single_column: true });
	wrapper.employee_duty_change = window.HRMSEmployeeFormSubmitPage.mount(page, "employee_transfer_application");
};

frappe.pages["employee-duty-change"].on_page_show = function (wrapper) {
	wrapper.employee_duty_change?.show();
};
