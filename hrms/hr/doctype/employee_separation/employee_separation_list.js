frappe.listview_settings["Employee Separation"] = {
	hide_name_column: true,
	add_fields: [
		"boarding_status",
		"employee_code_display",
		"employee_name",
		"department",
		"designation",
		"boarding_begins_on",
	],
	filters: [["boarding_status", "=", "Pending"]],
	onload(listview) {
		listview.page.set_title(__("离职管理"));
	},
	get_indicator: function (doc) {
		const labels = {
			Pending: __("待处理"),
			"In Process": __("处理中"),
			Completed: __("已完成"),
		};
		return [
			labels[doc.boarding_status] || __(doc.boarding_status),
			frappe.utils.guess_colour(doc.boarding_status),
			"boarding_status,=," + doc.boarding_status,
		];
	},
};
