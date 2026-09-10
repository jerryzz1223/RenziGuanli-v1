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
	},

	date_of_birth(frm) {
		update_employee_age(frm);
		if (!frm.doc.date_of_birth) return;
		frm.call({
			method: "hrms.overrides.employee_master.get_retirement_date",
			args: {
				date_of_birth: frm.doc.date_of_birth,
			},
		}).then((r) => {
			if (r && r.message) frm.set_value("date_of_retirement", r.message);
		});
	},

	passport_number(frm) {
		load_employee_rehire_profile(frm);
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

function is_blank_employee_form_value(value) {
	return value === undefined || value === null || String(value).trim() === "";
}

function apply_employee_rehire_autofill(frm, values = {}) {
	const empty_values = Object.fromEntries(
		Object.entries(values).filter(
			([fieldname, value]) =>
				frm.fields_dict[fieldname] &&
				is_blank_employee_form_value(frm.doc[fieldname]) &&
				!is_blank_employee_form_value(value),
		),
	);
	if (!Object.keys(empty_values).length) return Promise.resolve(0);
	return Promise.resolve(frm.set_value(empty_values)).then(() => Object.keys(empty_values).length);
}

function load_employee_rehire_profile(frm) {
	if (!frm.is_new()) return;
	const identity_number = String(frm.doc.passport_number || "").trim();
	if (!identity_number) {
		frm.__hrms_rehire_notice_identity = "";
		return;
	}
	if (frm.__hrms_rehire_notice_identity === identity_number) return;
	const request_id = (frm.__hrms_rehire_notice_request_id || 0) + 1;
	frm.__hrms_rehire_notice_request_id = request_id;
	frappe.call({
		method: "hrms.api.employee_field_template.check_employee_rehire_history",
		args: { identity_number },
	}).then(async (response) => {
		if (frm.__hrms_rehire_notice_request_id !== request_id) return;
		if (!response.message?.has_history || String(frm.doc.passport_number || "").trim() !== identity_number) return;
		frm.__hrms_rehire_notice_identity = identity_number;
		const filled_count = await apply_employee_rehire_autofill(frm, response.message.autofill_values);
		if (frm.__hrms_rehire_notice_request_id !== request_id) return;
		frappe.msgprint({
			title: __("发现历史任职档案"),
			indicator: "orange",
			message: __(
				filled_count
					? "该证件号在系统中已有任职记录，已自动带入 {0} 项原档案中的个人、联系和教育资料，已填内容不会被覆盖。继续创建会保留原档案，并按本次填写的工号新建任职档案。"
					: "该证件号在系统中已有任职记录。原档案没有可带入的空缺资料；继续创建会保留原档案，并按本次填写的工号新建任职档案。",
				[filled_count],
			),
		});
	}).catch(() => {});
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
	const options = frm.is_new()
		? EMPLOYEE_WORK_NATURE_VALUES.filter((value) => !["待离职", "离职"].includes(value))
		: EMPLOYEE_WORK_NATURE_VALUES;
	frm.set_df_property("custom_work_nature", "options", options.join("\n"));
	// List filters can prefill departure values when opening a new employee.
	if (frm.is_new() && ["待离职", "离职"].includes(frm.doc.custom_work_nature)) {
		frm.set_value("custom_work_nature", options[0]);
	}
}

function apply_employee_work_nature_choice(frm, work_nature) {
	// The selector is business-facing, while `employment_type` remains a Link
	// to standard Employment Type records.  Do not touch those implementation
	// fields while the user is still completing this long native form: Frappe
	// rebuilds its Tab Break panes when they change and hides later sections.
	// The server applies the complete mapping atomically during Save instead.
	sync_employee_work_nature_dependent_fields(frm, work_nature);
}

function sync_employee_work_nature_dependent_fields(frm, work_nature = frm.doc.custom_work_nature) {
	const is_probation = work_nature === "在职·试用期";
	for (const fieldname of ["custom_probation_months", "final_confirmation_date"]) {
		if (!frm.fields_dict[fieldname]) continue;
		frm.toggle_display(fieldname, is_probation);
		if (!is_probation) frm.set_df_property(fieldname, "reqd", false);
		frm.fields_dict[fieldname].$wrapper?.prev(".hrms-employee-group-title").toggle(is_probation);
	}
	const is_leaving = !frm.is_new() && work_nature === "离职";
	const exit_tab = frm.layout?.tabs?.find((tab) => tab.df.fieldname === "exit");
	if (exit_tab) {
		exit_tab.df.hidden = frm.is_new() ? 1 : 0;
		exit_tab.refresh();
	}
	if (!frm.fields_dict.relieving_date) return;

	frm.toggle_display("relieving_date", is_leaving);
	frm.set_df_property("relieving_date", "reqd", is_leaving);
	frm.fields_dict.relieving_date.$wrapper?.prev(".hrms-employee-group-title").toggle(is_leaving);
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
	// EmployeeMaster names employees by company work number. Apply this after
	// the async template too, otherwise it can restore the unused series field.
	frm.toggle_display("naming_series", false);
	frm.set_df_property("naming_series", "reqd", false);
	for (const fieldname of ["custom_roster_sequence", "education", "educational_qualification", "custom_is_confirmed"]) {
		frm.toggle_display(fieldname, false);
		frm.set_df_property(fieldname, "reqd", false);
	}
	update_employee_age(frm);
	// Apply this on every render, including while the template RPC is pending
	// or unavailable, so the native form cannot expose departure fields on add.
	sync_employee_work_nature_dependent_fields(frm);
	$(frm.wrapper).addClass("hrms-employee-one-page");
	setup_employee_roster_layout(frm);

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

function calculate_employee_age(date_of_birth, today) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date_of_birth || "")) return null;
	const birth = new Date(`${date_of_birth}T00:00:00Z`);
	if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== date_of_birth) return null;
	if (date_of_birth > today) return null;
	const age = Number(today.slice(0, 4)) - Number(date_of_birth.slice(0, 4));
	return age - (today.slice(5) < date_of_birth.slice(5) ? 1 : 0);
}

function update_employee_age(frm) {
	if (!frm.fields_dict.custom_age) return;
	frm.set_df_property("custom_age", "read_only", 1);
	const age = calculate_employee_age(frm.doc.date_of_birth, frappe.datetime.get_today());
	if (frm.doc.custom_age !== age) frm.set_value("custom_age", age);
}

// Keep Frappe's controls, columns and dependency handling in place. Only add
// headings and style the existing column forms as compact rows of fields.
function setup_employee_roster_layout(frm) {
	(frm.layout?.sections || []).forEach((section) => section.wrapper.addClass("hrms-roster-field-section"));
	// Frappe restores the section's collapsed default on every form refresh.
	// Address is part of the roster and should be visible whenever it is opened.
	frm.layout?.sections_dict?.address_section?.collapse(false);
	const groups = [
		["custom_employee_code", "员工基本信息"],
		["gender", "个人资料"],
		["custom_education_category", "教育信息"],
		["date_of_joining", "入职信息"],
		["cell_number", "联系方式"],
		["final_confirmation_date", "转正信息"],
		["contract_end_date", "劳动合同"],
		["custom_social_insurance", "保险与公积金"],
		["relieving_date", "离职信息"],
	];
	for (const [fieldname, label] of groups) {
		const field = frm.fields_dict[fieldname];
		if (!field?.$wrapper) continue;
		let heading = field.$wrapper.prev(`.hrms-employee-group-title[data-group="${fieldname}"]`);
		if (!heading.length) {
			heading = $("<h3 class='hrms-employee-group-title'>")
				.attr("data-group", fieldname).text(__(label)).insertBefore(field.$wrapper);
		}
		heading.toggle(!field.df.hidden && !field.df.hidden_due_to_dependency);
	}

	const identity = frm.fields_dict.employee_name;
	const editable_name = frm.fields_dict.first_name;
	// The computed full name duplicates the editable name in this roster.
	identity?.$wrapper.toggleClass("hrms-employee-redundant-name",
		Boolean(identity.df.read_only && editable_name && !editable_name.df.hidden));
	for (const fieldname of ["pan_number", "ifsc_code", "micr_code", "provident_fund_account"]) {
		const field = frm.fields_dict[fieldname];
		field?.$wrapper.toggleClass("hrms-employee-unused-field", !frm.doc[fieldname] && !field.df.reqd);
	}
	const section_labels = {
		company_details_section: "任职信息",
		address_section: "居住与户籍地址",
		emergency_contact_details: "紧急联系人",
		passport_details_section: "证件与户籍资料",
	};
	for (const [fieldname, label] of Object.entries(section_labels)) {
		const section = frm.layout?.sections_dict?.[fieldname];
		if (section?.head) section.head.contents().first().replaceWith(document.createTextNode(__(label)));
	}

	if (!frm.__hrms_roster_navigation) {
		const nav = $("<nav class='hrms-employee-roster-navigation' aria-label='员工档案导航'>")
			.prependTo(frm.layout.wrapper);
		$("<span class='hrms-employee-roster-caption'>").text(__("员工档案")).appendTo(nav);
		$("<button type='button' class='btn btn-default btn-sm'>").text(__("返回花名册"))
			.appendTo(nav).on("click", () => frappe.set_route("List", "Employee"));
		const records = $("<button type='button' class='btn btn-default btn-sm'>")
			.text(__("材料与业务记录")).appendTo(nav)
			.on("click", () => {
				if (frm.is_dirty()) {
					frappe.msgprint(__("请先保存员工资料，再查看材料与业务记录。"));
					return;
				}
				frappe.set_route("employee-detail", frm.doc.name);
			});
		const advanced = $("<button type='button' class='btn btn-default btn-sm' aria-expanded='false'>")
			.text(__("其他关联单据")).appendTo(nav)
			.on("click", () => {
				const expanded = !$(frm.wrapper).hasClass("hrms-employee-show-connections");
				$(frm.wrapper).toggleClass("hrms-employee-show-connections", expanded);
				advanced.attr("aria-expanded", String(expanded));
				advanced.text(__(expanded ? "收起关联单据" : "其他关联单据"));
				if (expanded) frm.dashboard?.links_area?.wrapper?.[0]?.scrollIntoView({ behavior: "smooth", block: "start" });
			});
		frm.__hrms_roster_navigation = { records, advanced };
	}
	frm.__hrms_roster_navigation.records.toggle(!frm.is_new());
	frm.__hrms_roster_navigation.advanced.toggle(!frm.is_new());
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
