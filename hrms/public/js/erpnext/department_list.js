// Department records remain employee references; their former list page is retired.
(function () {
	function open_organization_list(listview) {
		listview?.page?.main?.hide();
		frappe.set_route("organizational-chart", "list");
	}

	frappe.listview_settings["Department"] = {
		onload: open_organization_list,
		refresh: open_organization_list,
	};
})();
