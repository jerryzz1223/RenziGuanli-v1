// Copyright (c) 2016, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Employee", {
	refresh: function (frm) {
		if (redirect_existing_employee_form_to_detail(frm)) return;
		remember_employee_list_return(frm);
		setup_employee_form_defaults(frm);
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

	before_save(frm) {
		prepare_employee_save_defaults(frm);
	},

	after_save(frm) {
		return_to_employee_roster_after_insert(frm);
	},
});

function redirect_existing_employee_form_to_detail(frm) {
	if (frm.is_new()) return false;
	if (frm.__hrms_return_to_employee_roster) return false;
	const route = frappe.get_route();
	if (route[0] !== "Form" || route[1] !== "Employee" || route[2] !== frm.doc.name) return false;
	if (frappe.route_options && frappe.route_options.hrms_allow_employee_form) return false;
	if (frm.__hrms_employee_detail_redirecting) return true;
	frm.__hrms_employee_detail_redirecting = true;
	frappe
		.call("hrms.api.employee_field_template.ensure_personnel_pages")
		.then(() => {
			frappe.set_route("employee-detail", frm.doc.name);
		})
		.catch(() => {
			frm.__hrms_employee_detail_redirecting = false;
			frappe.msgprint(__("员工档案详情页还未初始化，请先执行 bench migrate 或刷新后重试。"));
		});
	return true;
}

function remember_employee_list_return(frm) {
	if (!frm.is_new()) return;
	frm.__hrms_return_to_employee_roster = true;
}

function prepare_employee_save_defaults(frm) {
	if (
		frm.doc.create_user_automatically &&
		!frm.doc.company_email &&
		!frm.doc.personal_email &&
		!frm.doc.prefered_contact_email
	) {
		frm.set_value("create_user_automatically", 0);
	}

	if (frm.doc.create_user_permission && !frm.doc.user_id) {
		frm.set_value("create_user_permission", 0);
	}
}

function setup_employee_form_defaults(frm) {
	if (!frm.is_new()) return;

	if (frm.doc.create_user_automatically !== 0) {
		frm.set_value("create_user_automatically", 0);
	}
	if (frm.doc.create_user_permission !== 0) {
		frm.set_value("create_user_permission", 0);
	}
}

function return_to_employee_roster_after_insert(frm) {
	if (!frm.__hrms_return_to_employee_roster) return;
	frm.__hrms_return_to_employee_roster = false;
	setTimeout(() => {
		frappe.set_route("List", "Employee");
	}, 350);
}

const EMPLOYEE_FORM_CATEGORY_SECTIONS = [
	{ category: "个人信息", label: "基础信息" },
	{ category: "在职信息", label: "在职信息" },
	{ category: "联系信息", label: "联系信息" },
	{ category: "合同保险", label: "合同信息" },
	{ category: "工资社保", label: "工资社保" },
	{ category: "个税申报", label: "个税信息" },
	{ category: "附件", label: "附件" },
];

function apply_employee_field_template(frm) {
	frappe
		.call("hrms.api.employee_field_template.get_employee_field_template")
		.then((r) => {
			const template = r.message;
			if (!template || !template.enabled || !Array.isArray(template.fields)) return;

			const non_configurable_fieldtypes = new Set([
				"Section Break",
				"Column Break",
				"Tab Break",
				"HTML",
				"Button",
				"Fold",
				"Table",
				"Table MultiSelect",
			]);
			const configurable_template_fields = template.fields.filter((field) => field && field.fieldname);
			const managed_fieldnames = new Set(configurable_template_fields.map((field) => field.fieldname));
			const template_by_fieldname = Object.fromEntries(
				configurable_template_fields.map((field) => [field.fieldname, field]),
			);

			(frm.meta.fields || []).forEach((field) => {
				if (!field.fieldname || !frm.fields_dict[field.fieldname]) return;
				if (non_configurable_fieldtypes.has(field.fieldtype)) return;

				const configured_field = template_by_fieldname[field.fieldname];
				apply_configured_field_label(frm, field, configured_field);
				apply_configured_field_required(frm, field, configured_field);

				if (!managed_fieldnames.has(field.fieldname)) {
					frm.toggle_display(field.fieldname, false);
					return;
				}

				const visible = Boolean(configured_field.enabled && configured_field.form_visible !== 0);
				frm.toggle_display(field.fieldname, visible);
				if (!visible) {
					frm.set_df_property(field.fieldname, "reqd", false);
				}
			});

			setTimeout(() => group_employee_fields_by_template(frm, template), 100);
		});
}

function apply_configured_field_label(frm, field, configured_field) {
	if (!configured_field || !configured_field.field_label) return;
	frm.set_df_property(field.fieldname, "label", configured_field.field_label);
}

function apply_configured_field_required(frm, field, configured_field) {
	if (!configured_field || !frm.fields_dict[field.fieldname]) return;
	frm.set_df_property(field.fieldname, "reqd", Boolean(configured_field.required));
}

function group_employee_fields_by_template(frm, template) {
	const fields = (template.fields || []).filter(
		(field) => field.enabled && field.form_visible !== 0 && frm.fields_dict[field.fieldname],
	);
	if (!fields.length) return;

	const body = $(frm.wrapper).find(".form-layout, .form-page").first();
	if (!body.length) return;

	$(frm.wrapper).find(".hrms-employee-form-template-sections").remove();
	const container = $(`<div class="hrms-employee-form-template-sections"></div>`);
	body.prepend(container);

	const category_by_fieldname = Object.fromEntries(fields.map((field) => [field.fieldname, field.category]));
	const sections = {};
	EMPLOYEE_FORM_CATEGORY_SECTIONS.forEach((section) => {
		sections[section.category] = $(`
			<div class="section-head hrms-employee-form-section" data-employee-section="${section.category}">
				${__(section.label)}
			</div>
			<div class="row form-section visible-section hrms-employee-form-section-body"></div>
		`);
		container.append(sections[section.category]);
	});

	fields.forEach((field) => {
		const control = frm.fields_dict[field.fieldname];
		const wrapper = $(control.wrapper).closest(".frappe-control");
		const category = category_by_fieldname[field.fieldname] || "个人信息";
		const section = sections[category] || sections["个人信息"];
		const section_body = section.filter(".hrms-employee-form-section-body");
		if (wrapper.length && section_body.length) {
			section_body.append(wrapper);
		}
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
