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

async function show_separation_application_drafts(listview) {
	const filter_area = listview?.filter_area;
	if (!filter_area?.clear_filters || !filter_area?.set) return;
	const preserved_filters = (filter_area.get?.() || []).filter(
		(filter) => !["docstatus", "boarding_status"].includes(filter?.[1]),
	);
	preserved_filters.push(["Employee Separation", "docstatus", "=", 0]);
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
		"applied_on",
		"approved_by",
		"approved_on",
		"departed_on",
	],
	filters: [],
	async onload(listview) {
		const route_filters = new URLSearchParams(window.location.search);
		const query_view = route_filters.get("view");
		const application_view = query_view === "application"
			|| route_filters.get("docstatus") === "0"
			|| (query_view !== "approval" && window.hrmsSeparationListView === "application");
		listview.page.set_title(application_view ? __("离职申请") : __("离职审批"));
		const apply_view_filters = () => application_view
			? show_separation_application_drafts(listview)
			: show_submitted_pending_separations(listview);
		await apply_view_filters();
		// Frappe can apply stale route filters after list onload. Re-apply the
		// selected view once the route options have settled.
		setTimeout(() => apply_view_filters(), 250);
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
