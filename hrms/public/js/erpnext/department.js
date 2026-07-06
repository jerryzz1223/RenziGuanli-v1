// Copyright (c) 2022, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Department", {
	refresh: function (frm) {
		frm.set_query("payroll_cost_center", function () {
			return {
				filters: {
					company: frm.doc.company,
					is_group: 0,
				},
			};
		});

		frm.add_custom_button(__("快速编辑字段"), function () {
			frappe.set_route("List", "Department");
			frappe.after_ajax(() => {
				frappe.show_alert({
					message: __("请在部门列表勾选该部门后使用“快速编辑”。"),
					indicator: "blue",
				});
			});
		});
	},

	after_delete: function () {
		frappe.set_route("List", "Department");
	},
});
