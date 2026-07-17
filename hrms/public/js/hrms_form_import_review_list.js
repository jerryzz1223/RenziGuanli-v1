/* global frappe, __ */

(function () {
	const existing = frappe.listview_settings["HRMS Form Import Row"] || {};
	const previousOnload = existing.onload;
	frappe.listview_settings["HRMS Form Import Row"] = {
		...existing,
		onload(listview) {
			previousOnload?.(listview);
			listview.page.add_inner_button(__("待人事审核"), () => {
				frappe.set_route("List", "HRMS Form Import Row", { review_status: "待审核" });
			});
			listview.page.add_inner_button(__("审批矩阵设置"), () => {
				frappe.set_route("List", "HRMS Form Approval Matrix");
			});
			listview.page.add_inner_button(__("正式业务记录"), () => {
				frappe.set_route("List", "HRMS Business Process Record");
			});
		},
	};
})();
