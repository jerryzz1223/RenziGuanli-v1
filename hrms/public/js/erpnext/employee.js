// Copyright (c) 2016, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Employee", {
	refresh: function (frm) {
		if (redirect_existing_employee_form_to_detail(frm)) return;
		remember_employee_list_return(frm);
		setup_employee_form_defaults(frm);
		setup_employee_gender_field(frm);
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

		// Naming Series creates Frappe's internal document name. The HR-facing
		// identifier is always the company work number plus employee name.
		frm.toggle_display("naming_series", false);
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
	if (consume_employee_form_edit_access(frm.doc.name)) return false;
	if (frm.__hrms_employee_detail_redirecting) return true;
	frm.__hrms_employee_detail_redirecting = true;
	// The page is created by migration. Do not wait for a server round-trip
	// here: doing so lets the native form render first and caused the old
	// "refresh once to enter employee detail" behaviour.
	frappe.set_route("employee-detail", frm.doc.name);
	return true;
}

const EMPLOYEE_FORM_EDIT_ACCESS_KEY = "hrms_allow_employee_form_name";

function mark_employee_form_edit_access(employee) {
	const name = String(employee || "");
	if (!name) return;
	window.__hrms_employee_form_edit_name = name;
	try {
		sessionStorage.setItem(EMPLOYEE_FORM_EDIT_ACCESS_KEY, name);
	} catch (error) {
		// Private browsing can block session storage; the in-memory marker still
		// covers the current Desk navigation.
	}
}

function is_employee_form_edit_access_allowed(employee) {
	const name = String(employee || "");
	if (!name) return false;
	if (window.__hrms_employee_form_edit_name === name) return true;
	try {
		return sessionStorage.getItem(EMPLOYEE_FORM_EDIT_ACCESS_KEY) === name;
	} catch (error) {
		return false;
	}
}

function consume_employee_form_edit_access(employee) {
	if (frappe.route_options && frappe.route_options.hrms_allow_employee_form) {
		frappe.route_options = null;
		return true;
	}
	if (!is_employee_form_edit_access_allowed(employee)) return false;

	window.__hrms_employee_form_edit_name = null;
	try {
		sessionStorage.removeItem(EMPLOYEE_FORM_EDIT_ACCESS_KEY);
	} catch (error) {
		// No action needed when session storage is unavailable.
	}
	return true;
}

function redirect_employee_form_route_to_detail() {
	const route = frappe.get_route();
	if (route[0] !== "Form" || route[1] !== "Employee" || !route[2]) return;
	// frappe.new_doc() first opens a temporary route such as
	// "new-employee-wefamctblb".  It is not an existing Employee name, so
	// redirecting it to the read-only detail page turns a normal create action
	// into a misleading “not found” error.
	if (is_new_employee_form_route(route[2])) return;
	if (is_employee_form_edit_access_allowed(route[2])) return;
	if (frappe.route_options && frappe.route_options.hrms_allow_employee_form) return;
	frappe.set_route("employee-detail", route[2]);
}

function is_new_employee_form_route(route_name) {
	return /^new-employee(?:-|$)/.test(String(route_name || ""));
}

function bind_employee_detail_route_redirect() {
	if (window.__hrms_employee_detail_route_redirect_bound || !frappe.router || typeof frappe.router.on !== "function") return;
	window.__hrms_employee_detail_route_redirect_bound = true;

	let timer;
	const schedule_redirect = () => {
		window.clearTimeout(timer);
		timer = window.setTimeout(redirect_employee_form_route_to_detail, 0);
	};

	frappe.router.on("change", schedule_redirect);
	window.addEventListener("hashchange", schedule_redirect);
	window.addEventListener("popstate", schedule_redirect);
}

window.hrmsEmployeeNavigation = window.hrmsEmployeeNavigation || {};
window.hrmsEmployeeNavigation.openEmployeeFormForEdit = function (employee) {
	mark_employee_form_edit_access(employee);
	frappe.set_route("Form", "Employee", employee);
};

// This is a fallback for direct native-form URLs and third-party links. The
// roster itself intercepts its click before the native form is opened.
bind_employee_detail_route_redirect();

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
	{ category: "教育信息", label: "教育信息" },
	{ category: "在职信息", label: "在职信息" },
	{ category: "联系信息", label: "联系信息" },
	{ category: "合同保险", label: "合同信息" },
	{ category: "工资社保", label: "工资社保" },
	{ category: "个税申报", label: "个税信息" },
	{ category: "附件", label: "附件" },
];

const EMPLOYEE_FORM_WIDE_FIELDNAMES = new Set([
	"current_address",
	"permanent_address",
	"family_background",
	"health_details",
	"bio",
]);

const EMPLOYEE_FORM_WIDE_FIELDTYPES = new Set(["Small Text", "Text", "Text Editor", "Long Text"]);
const EMPLOYEE_GENDER_VALUES = ["Male", "Female", "Other"];

function setup_employee_gender_field(frm) {
	if (!frm.fields_dict.gender) return;

	// Gender is a Link field in the standard Employee DocType. Leaving it
	// unrestricted exposed every historical Gender record and the nested
	// “create Gender” action while entering an employee.
	frm.set_query("gender", () => ({
		filters: {
			gender: ["in", EMPLOYEE_GENDER_VALUES],
		},
	}));
	frm.set_df_property("gender", "only_select", 1);
}

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

	// A refresh may apply the template again. Put controls back before
	// discarding the prior presentation container so Frappe retains the same
	// control instances and the form never accumulates a second layout layer.
	restore_employee_form_controls(frm, body);
	$(frm.wrapper).find(".hrms-employee-empty-native-section").removeClass("hrms-employee-empty-native-section");
	const container = $(`<div class="hrms-employee-form-template-sections"></div>`);
	body.prepend(container);

	const fields_by_category = new Map();
	fields.forEach((field) => {
		const category = EMPLOYEE_FORM_CATEGORY_SECTIONS.some((section) => section.category === field.category)
			? field.category
			: "个人信息";
		const category_fields = fields_by_category.get(category) || [];
		category_fields.push(field);
		fields_by_category.set(category, category_fields);
	});

	EMPLOYEE_FORM_CATEGORY_SECTIONS.forEach((section) => {
		const category_fields = fields_by_category.get(section.category);
		if (!category_fields?.length) return;

		const section_wrapper = $(`
			<section class="hrms-employee-form-section" data-employee-section="${section.category}">
				<div class="section-head hrms-employee-form-section__heading">${__(section.label)}</div>
				<div class="hrms-employee-form-section__grid"></div>
			</section>
		`);
		const grid = section_wrapper.find(".hrms-employee-form-section__grid");
		container.append(section_wrapper);

		category_fields.forEach((field) => {
			const control = frm.fields_dict[field.fieldname];
			const wrapper = get_employee_form_control_wrapper(control);
			if (!wrapper.length || wrapper.hasClass("hide-control")) return;
			const is_wide =
				EMPLOYEE_FORM_WIDE_FIELDNAMES.has(field.fieldname) ||
				EMPLOYEE_FORM_WIDE_FIELDTYPES.has(field.fieldtype);
			const field_slot = $("<div class=\"hrms-employee-form-field\"></div>")
				.attr("data-fieldname", field.fieldname)
				.toggleClass("hrms-employee-form-field--wide", is_wide);
			if (wrapper.length) field_slot.append(wrapper);
			grid.append(field_slot);
		});
	});

	// Fields are moved out of Frappe's original section columns.  Hide the now
	// empty containers so the native layout cannot leave large visual gaps
	// between the personnel sections.
	body
		.find(".form-section")
		.not(".hrms-employee-form-section")
		.each(function () {
			if (!$(this).find(".frappe-control").length) {
				$(this).addClass("hrms-employee-empty-native-section");
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

function restore_employee_form_controls(frm, body) {
	const existing_sections = $(frm.wrapper).find(".hrms-employee-form-template-sections");
	if (!existing_sections.length) return;

	existing_sections.find(".frappe-control").each(function () {
		$(this).detach().appendTo(body);
	});
	existing_sections.remove();
}

function get_employee_form_control_wrapper(control) {
	if (!control?.wrapper) return $();
	const control_wrapper = $(control.wrapper);
	return control_wrapper.closest(".frappe-control").length
		? control_wrapper.closest(".frappe-control")
		: control_wrapper;
}
