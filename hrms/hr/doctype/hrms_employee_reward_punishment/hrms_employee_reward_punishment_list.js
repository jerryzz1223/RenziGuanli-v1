/* global frappe, __ */

frappe.listview_settings["HRMS Employee Reward Punishment"] = {
	has_indicator_for_draft: 1,
	onload(listview) {
		listview.page.add_inner_button(__("奖惩规则"), () => frappe.set_route("List", "HRMS Reward Punishment Rule"));
	},
	get_indicator(doc) {
		const colors = { "草稿": "grey", "待审核": "orange", "已生效": "green", "已驳回": "red", "已撤销": "grey" };
		return [__(doc.status), colors[doc.status] || "grey", `status,=,${doc.status}`];
	},
};
