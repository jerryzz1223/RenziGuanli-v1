frappe.listview_settings["Cross Department Support Capability"] = {
	add_fields: ["qualification_status", "is_active", "valid_until"],
	get_indicator(doc) {
		if (doc.is_active && doc.qualification_status === "有效") return [__("可派"), "green", "is_active,=,1"];
		return [__("不可派"), "gray", "is_active,=,0"];
	},
};
