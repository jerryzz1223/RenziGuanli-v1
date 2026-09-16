frappe.pages["employee-talk-form"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("员工谈话表"), single_column: true });
	wrapper.employee_talk_form = window.HRMSEmployeeFormSubmitPage.mount(page, "employee_talk");
};

frappe.pages["employee-talk-form"].on_page_show = function (wrapper) {
	wrapper.employee_talk_form?.show();
};
