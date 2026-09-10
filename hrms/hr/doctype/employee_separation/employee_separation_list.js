async function show_submitted_pending_separations(listview) {
	const filter_area = listview?.filter_area;
	if (!filter_area?.get || !filter_area?.clear_filters || !filter_area?.set) return;

	const preserved_filters = (filter_area.get() || []).filter(
		(filter) => !["docstatus", "boarding_status"].includes(filter?.[1]),
	);
	preserved_filters.push(
		["Employee Separation", "docstatus", "=", 1],
		["Employee Separation", "boarding_status", "=", "Pending"],
	);
	await filter_area.clear_filters();
	await filter_area.set(preserved_filters);
	listview.start = 0;
	listview.update_url_with_filters?.();
	return listview.refresh();
}

frappe.listview_settings["Employee Separation"] = {
	hide_name_column: true,
	add_fields: [
		"boarding_status",
		"employee_code_display",
		"employee_name",
		"department",
		"designation",
		"boarding_begins_on",
		"approved_by",
		"approved_on",
	],
	filters: [
		["docstatus", "=", 1],
		["boarding_status", "=", "Pending"],
	],
	async onload(listview) {
		listview.page.set_title(__("离职管理"));
		await show_submitted_pending_separations(listview);
	},
	get_indicator: function (doc) {
		const labels = {
			Pending: __("待审批"),
			"In Process": __("审批中"),
			Completed: __("审批通过"),
		};
		return [
			labels[doc.boarding_status] || __(doc.boarding_status),
			frappe.utils.guess_colour(doc.boarding_status),
			"boarding_status,=," + doc.boarding_status,
		];
	},
};
