// Copyright (c) 2016, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Employee", {
	refresh: function (frm) {
		apply_employee_field_template(frm);
		setup_personnel_employee_detail(frm);

		frm.set_query("payroll_cost_center", function () {
			return {
				filters: {
					company: frm.doc.company,
					is_group: 0,
				},
			};
		});

		// filter advance account based on salary currency
		if (frm.doc.salary_currency) {
			frm.set_query("employee_advance_account", function () {
				return {
					filters: {
						root_type: "Asset",
						is_group: 0,
						company: frm.doc.company,
						account_currency: frm.doc.salary_currency,
						account_type: "Receivable",
					},
				};
			});
		}
		frm.set_df_property("holiday_list", "hidden", 1);

		// hide naming series field based on hr settings
		frappe.db.get_single_value("HR Settings", "emp_created_by").then((value) => {
			frm.toggle_display("naming_series", value === "Naming Series");
		});
	},

	date_of_birth(frm) {
		frm.call({
			method: "hrms.overrides.employee_master.get_retirement_date",
			args: {
				date_of_birth: frm.doc.date_of_birth,
			},
		}).then((r) => {
			if (r && r.message) frm.set_value("date_of_retirement", r.message);
		});
	},
});

function apply_employee_field_template(frm) {
	frappe
		.call("hrms.api.employee_field_template.get_employee_field_template")
		.then((r) => {
			const template = r.message;
			if (!template || !template.enabled || !Array.isArray(template.fields)) return;

			const required_fields = new Set(
				(frm.meta.fields || []).filter((field) => field.reqd).map((field) => field.fieldname),
			);
			const always_visible_fields = new Set([
				"employee_name",
				"company",
				"gender",
				"date_of_birth",
				"date_of_joining",
				"status",
			]);

			template.fields.forEach((field) => {
				if (!field.fieldname || !frm.fields_dict[field.fieldname]) return;
				if (required_fields.has(field.fieldname) || always_visible_fields.has(field.fieldname)) return;

				frm.toggle_display(field.fieldname, Boolean(field.enabled));
			});
		});
}

function setup_personnel_employee_detail(frm) {
	if (frm.is_new()) return;

	// Mirrors the personnel detail concepts with native Frappe actions:
	// 概览 / 在职信息 / 个人信息 / 联系信息 / 工资社保 / 合同信息 / 材料附件 / 背景调查 / 更多.
	frm.page.add_inner_button(__("员工对比"), function () {
		frappe.set_route("List", "Employee", {
			status: frm.doc.status || "Active",
			department: frm.doc.department || undefined,
		});
	});

	frm.page.add_inner_button(__("人事异动"), function () {
		frappe.new_doc("Employee Transfer", {
			employee: frm.doc.name,
			employee_name: frm.doc.employee_name,
			company: frm.doc.company,
		});
	});
}
