frappe.ui.form.on("Cross Department Support Capability", {
	refresh(frm) {
		["qualification_status", "is_active", "column_break_support", "qualified_on", "valid_from", "valid_until", "remarks", "import_validation_note"].forEach((fieldname) => {
			frm.toggle_display(fieldname, false);
		});

		if (frm.is_new()) {
			frm.page.set_title(__("新建支援"));
		}

		if (!frm.is_new()) {
			frm.add_custom_button(__("查看可派名单"), () => {
				frappe.set_route("cross-department-support", frm.doc.support_department, frm.doc.support_designation);
			});
		}
	},
});
