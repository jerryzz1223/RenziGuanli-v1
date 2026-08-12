/* global frappe, __ */

{% include 'hrms/hr/employee_business_code_selector.js' %}

const CONTEXT_METHOD = "hrms.hr.doctype.hrms_employee_reward_punishment.hrms_employee_reward_punishment.get_reward_punishment_context";
const RULE_OPTIONS_METHOD = "hrms.hr.doctype.hrms_employee_reward_punishment.hrms_employee_reward_punishment.get_reward_punishment_rule_options";

frappe.ui.form.on("HRMS Employee Reward Punishment", {
	setup(frm) {
		window.hrmsEmployeeBusinessCodeSelector.setup(frm);
		setup_business_form(frm);
	},
	refresh(frm) {
		window.hrmsEmployeeBusinessCodeSelector.refresh(frm);
		setup_business_form(frm);
		load_rule_options(frm);
		frm.set_df_property("status", "read_only", 1);
		frm.add_custom_button(__("管理奖惩规则"), () => frappe.set_route("List", "HRMS Reward Punishment Rule"));
		if (!frm.is_new() && frm.doc.employee && frm.doc.rule) refresh_context(frm, false);
		if (frm.is_new()) return;

		const roles = frappe.user_roles || [];
		const can_approve = roles.includes("HR Manager") || roles.includes("System Manager");
		if (frm.doc.status === "草稿") {
			frm.add_custom_button(__("提交审核"), () => set_status(frm, "待审核"), __("奖惩处理"));
		}
		if (frm.doc.status === "待审核" && can_approve) {
			frm.add_custom_button(__("确认生效"), () => set_status(frm, "已生效"), __("奖惩处理"));
			frm.add_custom_button(__("驳回"), () => set_status(frm, "已驳回"), __("奖惩处理"));
		}
		if (frm.doc.status === "已驳回") {
			frm.add_custom_button(__("重新编辑"), () => set_status(frm, "草稿"), __("奖惩处理"));
		}
		if (frm.doc.status === "已生效" && can_approve) {
			frm.add_custom_button(__("撤销记录"), () => set_status(frm, "已撤销"), __("奖惩处理"));
		}
	},
	employee(frm) {
		window.hrmsEmployeeBusinessCodeSelector.employee_selected(frm);
		refresh_context(frm, true);
	},
	employee_code_display(frm) {
		window.hrmsEmployeeBusinessCodeSelector.resolve_employee(frm);
	},
	category_selector(frm) {
		select_rule_by_category(frm);
	},
	rule(frm) {
		refresh_context(frm, false);
	},
	occurred_on(frm) {
		refresh_context(frm, !frm.doc.full_salary);
	},
	full_salary(frm) {
		recalculate_amount(frm);
	},
	manual_amount_override(frm) {
		recalculate_amount(frm);
	},
	rate_percent(frm) {
		recalculate_amount(frm);
	},
	validate(frm) {
		if (!frm.doc.employee) frappe.throw(__("请输入并匹配有效的公司员工号。"));
		if (!frm.doc.rule) frappe.throw(__("请选择奖惩类别。"));
	},
});

function setup_business_form(frm) {
	ensure_business_form_style();
	frm.$wrapper.addClass("hrms-reward-business-form");
	frm.toggle_display("employee", false);
	frm.toggle_display("employee_code", false);
	frm.toggle_display("rule", false);
	frm.toggle_display("category", false);
	frm.toggle_display("conversion_count", false);
	frm.toggle_display("converts_to", false);
	frm.toggle_display("approved_by", !frm.is_new() && Boolean(frm.doc.approved_by));
	frm.toggle_display("approved_on", !frm.is_new() && Boolean(frm.doc.approved_on));
	frm.toggle_display("payroll_welfare_source", !frm.is_new() && Boolean(frm.doc.payroll_welfare_source));
	frm.toggle_display("source_import_row", !frm.is_new() && Boolean(frm.doc.source_import_row));
	frm.toggle_display("source_import_batch", !frm.is_new() && Boolean(frm.doc.source_import_batch));
	frm.toggle_display("source_file", !frm.is_new() && Boolean(frm.doc.source_file));
	frm.set_df_property("employee_code_display", "placeholder", __("输入公司员工号，例如 3224"));
	frm.get_field("employee_code_display").$input.attr("placeholder", __("输入公司员工号，例如 3224"));
	frm.set_df_property("subject", "placeholder", __("例如：Q 线镍水洗补水漫出"));
	frm.set_intro(__("先输入公司员工号，再选择奖惩类别。系统会自动带出标准并计算金额。"), "blue");
}

function load_rule_options(frm) {
	if (!frm.doc.company || frm.__reward_rule_company === frm.doc.company) {
		sync_rule_presentation(frm);
		return;
	}
	frappe.call({ method: RULE_OPTIONS_METHOD, args: { company: frm.doc.company } }).then((response) => {
		const rules = response.message || [];
		frm.__reward_rule_company = frm.doc.company;
		frm.__reward_rules = rules;
		frm.set_df_property("category_selector", "options", ["", ...rules.map((rule) => rule.category)].join("\n"));
		sync_rule_presentation(frm);
	});
}

function sync_rule_presentation(frm) {
	const selected = (frm.__reward_rules || []).find((rule) => rule.name === frm.doc.rule || rule.category === frm.doc.category);
	if (!selected) return;
	if (frm.doc.category_selector !== selected.category) frm.set_value("category_selector", selected.category);
	const conversion = selected.conversion_count ? __("每 {0} 次折算为 {1}", [selected.conversion_count, selected.converts_to]) : __("不设次数折算");
	frm.set_df_property("category_selector", "description", __(
		"{0} · {1} · {2}",
		[selected.reward_punishment_type, selected.standard_text, conversion]
	));
}

function select_rule_by_category(frm) {
	const selected = (frm.__reward_rules || []).find((rule) => rule.category === frm.doc.category_selector);
	if (!selected || selected.name === frm.doc.rule) return;
	frm.set_value("rule", selected.name);
	sync_rule_presentation(frm);
}

function refresh_context(frm, use_salary_profile) {
	if (!frm.doc.employee) return;
	frappe.call({
		method: CONTEXT_METHOD,
		args: {
			employee: frm.doc.employee,
			rule: frm.doc.rule || "",
			occurred_on: frm.doc.occurred_on || "",
			record_name: frm.is_new() ? "" : frm.doc.name,
		},
	}).then((response) => {
		const context = response.message || {};
		const rule = context.rule || {};
		frm.set_value("company", context.company || frm.doc.company);
		frm.set_value({
			employee_code: context.employee_code || frm.doc.employee_code,
			employee_name: context.employee_name || frm.doc.employee_name,
			department: context.department || frm.doc.department,
			designation: context.designation || frm.doc.designation,
		});
		if ((use_salary_profile || !frm.doc.full_salary) && context.full_salary) {
			frm.set_value("full_salary", context.full_salary);
		}
		if (rule.name) {
			frm.set_value({
				reward_punishment_type: rule.reward_punishment_type,
				category: rule.category,
				rate_percent: rule.rate_percent,
				standard: rule.standard_text,
				conversion_count: rule.conversion_count,
				converts_to: rule.converts_to,
			}).then(() => {
				recalculate_amount(frm);
				sync_rule_presentation(frm);
			});
		}
		load_rule_options(frm);
	});
}

function recalculate_amount(frm) {
	if (frm.doc.manual_amount_override) return;
	const amount = (Number(frm.doc.full_salary) || 0) * (Number(frm.doc.rate_percent) || 0) / 100;
	frm.set_value("amount", Math.round(amount * 100) / 100);
}

function set_status(frm, status) {
	frm.set_value("status", status).then(() => frm.save());
}

function ensure_business_form_style() {
	if (document.getElementById("hrms-reward-business-form-style")) return;
	const style = document.createElement("style");
	style.id = "hrms-reward-business-form-style";
	style.textContent = `
		.hrms-reward-business-form .form-section {
			background: #fff; border: 1px solid #e3ece6; border-radius: 14px;
			box-shadow: 0 4px 14px rgba(24, 78, 49, .05); margin: 16px 0; padding: 2px 20px 18px;
		}
		.hrms-reward-business-form .form-section .section-head {
			border-bottom: 1px solid #edf2ee; color: #174d33; font-weight: 700; margin-bottom: 14px; padding: 15px 0 11px;
		}
		.hrms-reward-business-form .control-label { color: #44564b; font-size: 13px; font-weight: 600; }
		.hrms-reward-business-form .form-control { border-color: #d9e5dd; border-radius: 9px; min-height: 38px; }
		.hrms-reward-business-form textarea.form-control { min-height: 92px; }
		.hrms-reward-business-form .form-section:nth-of-type(3) .form-control[readonly] { background: #f4f8f5; color: #1d5136; font-weight: 600; }
		.hrms-reward-business-form .form-layout > .form-message { border-radius: 10px; margin: 0 0 16px; }
	`;
	document.head.appendChild(style);
}
