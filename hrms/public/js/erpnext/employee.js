// Copyright (c) 2016, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Employee", {
	onload_post_render: function (frm) {
		show_employee_form_as_one_page(frm);
	},

	refresh: function (frm) {
		remember_employee_list_return(frm);
		setup_employee_form_defaults(frm);
		setup_employee_gender_field(frm);
		setup_employee_work_nature_field(frm);
		apply_employee_field_template(frm);
		show_employee_form_as_one_page(frm);
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

	custom_work_nature(frm) {
		apply_employee_work_nature_choice(frm, frm.doc.custom_work_nature);
	},

	after_save(frm) {
		setup_employee_work_nature_field(frm);
		sync_employee_work_nature_dependent_fields(frm);
		return_to_employee_roster_after_insert(frm);
	},
});

window.hrmsEmployeeNavigation = window.hrmsEmployeeNavigation || {};
window.hrmsEmployeeNavigation.openEmployeeFormForEdit = function (employee) {
	frappe.set_route("Form", "Employee", employee);
};

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

const EMPLOYEE_GENDER_VALUES = ["Male", "Female", "Other"];
const EMPLOYEE_WORK_NATURE_VALUES = ["在职·正式", "在职·试用期", "退休返聘", "待离职", "离职"];
function setup_employee_work_nature_field(frm) {
	const field = frm.fields_dict.custom_work_nature;
	if (!field) return;
	// This Select field is the persisted HR source. Do not overlay a temporary
	// control on top of `employment_type`, or the roster would have to infer the
	// choice from implementation fields after every save.
	frm.set_df_property("custom_work_nature", "label", __("工作性质"));
	frm.set_df_property("custom_work_nature", "options", EMPLOYEE_WORK_NATURE_VALUES.join("\n"));
}

function apply_employee_work_nature_choice(frm, work_nature) {
	// The selector is business-facing, while `employment_type` remains a Link
	// to standard Employment Type records.  Always write valid linked values
	// plus every dependent Employee field, rather than saving the display label
	// and letting Frappe reject it as a missing Link record.
	const updates = {
		"在职·正式": { employment_type: "Full-time", status: "Active", custom_is_confirmed: "是", relieving_date: null },
		"在职·试用期": { employment_type: "Full-time", status: "Active", custom_is_confirmed: "否", relieving_date: null },
		"退休返聘": { employment_type: "Retainer", status: "Active", relieving_date: null },
		"待离职": { employment_type: "Full-time", status: "Inactive", relieving_date: null },
		"离职": { employment_type: "Full-time", status: "Left" },
	};
	const values = updates[work_nature];
	if (!values) return;
	Object.entries(values).forEach(([fieldname, value]) => {
		if (Object.hasOwn(frm.doc, fieldname)) frm.set_value(fieldname, value);
	});
	sync_employee_work_nature_dependent_fields(frm);
}

function sync_employee_work_nature_dependent_fields(frm) {
	const is_leaving = frm.doc.status === "Left";
	if (!frm.fields_dict.relieving_date) return;

	frm.toggle_display("relieving_date", is_leaving);
	frm.set_df_property("relieving_date", "reqd", is_leaving);
}

function get_employee_work_nature_display(employee = {}) {
	if (EMPLOYEE_WORK_NATURE_VALUES.includes(employee.employment_type)) return employee.employment_type;
	if (employee.status === "Left") return "离职";
	if (employee.status === "Inactive") return "待离职";
	if (employee.employment_type === "Retainer") return "退休返聘";
	if (employee.employment_type === "Probation" || employee.custom_is_confirmed === "否") return "在职·试用期";
	return "在职·正式";
}

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
	const request_id = (frm.__hrms_employee_template_request_id || 0) + 1;
	frm.__hrms_employee_template_request_id = request_id;

	frappe
		.call("hrms.api.employee_field_template.get_employee_field_template")
		.then((r) => {
			// A refresh can start another request while this one is in flight. Only
			// the latest response may alter or reveal the form, otherwise the native
			// layout can briefly reappear before the template layout is restored.
			if (frm.__hrms_employee_template_request_id !== request_id) return;
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
					// A Custom Field can reach the browser before the administrator's
					// template document is synchronised.  Preserve its native visibility
					// in that short window; only an explicit template row may hide it.
					return;
				}

				const visible = Boolean(configured_field.enabled && configured_field.form_visible !== 0);
				frm.toggle_display(field.fieldname, visible);
				if (!visible) {
					frm.set_df_property(field.fieldname, "reqd", false);
				}
			});

			sync_employee_work_nature_dependent_fields(frm);
			show_employee_form_as_one_page(frm);
		})
		.catch(() => {});
}

function show_employee_form_as_one_page(frm) {
	$(frm.wrapper).addClass("hrms-employee-one-page");

	// Tab Breaks are the source of Frappe's original per-tab column layout.
	// Do not reparent their controls or replace the layout.  Giving each
	// already-visible pane its normal Bootstrap active state simply places all
	// native panes in the same scrolling Employee document.
	window.requestAnimationFrame(() => {
		(frm.layout?.tabs || []).forEach((tab) => {
			if (!tab.hidden) tab.wrapper.addClass("show active");
		});
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
