frappe.ui.form.on("Cross Department Support Capability", {
	refresh(frm) {
		if (!frm.is_new()) {
			frm.add_custom_button(__("查看可派名单"), () => {
				frappe.set_route("cross-department-support", frm.doc.support_department, frm.doc.support_designation);
			});
		}
	},
});
