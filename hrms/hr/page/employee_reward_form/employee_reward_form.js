frappe.pages["employee-reward-form"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("奖惩提报单"), single_column: true });
	wrapper.employee_reward_form = window.HRMSEmployeeFormSubmitPage.mount(page, "reward_punishment_report");
};

frappe.pages["employee-reward-form"].on_page_show = function (wrapper) {
	wrapper.employee_reward_form?.show();
};
