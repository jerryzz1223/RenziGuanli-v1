frappe.listview_settings["Employee Onboarding"] = {
	add_fields: ["boarding_status", "employee_name", "date_of_joining", "department"],
	onload: function (listview) {
		if (listview.page.__hrms_onboarding_rules_ready) return;
		listview.page.__hrms_onboarding_rules_ready = true;
		listview.page.set_title(__("员工入职办理"));
		listview.page.set_primary_action(__("发起入职办理"), function () {
			open_onboarding_start_dialog();
		});
		listview.page.add_inner_button(__("管理入职任务规则"), function () {
			frappe.set_route("List", "Employee Onboarding Template");
		});
		listview.page.add_inner_button(__("创建标准任务清单"), function () {
			const company = window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company");
			if (!company) {
				frappe.msgprint(__("请先在页面顶部选择当前公司。"));
				return;
			}
			frappe.confirm(
				__("将为 {0} 创建一套可编辑的入职任务清单；已有清单不会被覆盖。是否继续？", [company]),
				function () {
					frappe.call({
						method: "hrms.api.form_data_intake.ensure_default_employee_onboarding_template",
						args: { company },
						freeze: true,
						freeze_message: __("正在创建入职规则…"),
					}).then((response) => {
						const rule = response.message || {};
						if (!rule.name) {
							frappe.msgprint(__("未返回可打开的入职规则，请稍后重试。"));
							return;
						}
						frappe.show_alert({
							message: rule.existing
								? __("已打开现有入职规则：{0}", [rule.title || rule.name])
								: __("已创建标准入职规则：{0}", [rule.title || rule.name]),
							indicator: rule.existing ? "blue" : "green",
						});
						frappe.set_route("Form", "Employee Onboarding Template", rule.name);
					});
				},
			);
		});
	},
	get_indicator: function (doc) {
		return [
			__(doc.boarding_status),
			frappe.utils.guess_colour(doc.boarding_status),
			"boarding_status,=," + doc.boarding_status,
		];
	},
};

function open_onboarding_start_dialog() {
	const company = window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company") || "";
	const dialog = new frappe.ui.Dialog({
		title: __("发起员工入职办理"),
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "onboarding_notice",
				options: `<div class="alert alert-info mb-3"><strong>${__("适用对象")}</strong><br>${__("仅用于已确认录用、尚未完成入职办理的候选人。已在员工花名册中的人员不要重复办理入职。")}</div>`,
			},
			{ fieldtype: "Link", fieldname: "job_applicant", label: __("已接受候选人"), options: "Job Applicant", reqd: 1 },
			{ fieldtype: "Link", fieldname: "job_offer", label: __("已接受 Offer"), options: "Job Offer", reqd: 1 },
			{ fieldtype: "Link", fieldname: "employee_onboarding_template", label: __("入职任务清单"), options: "Employee Onboarding Template", reqd: 1 },
			{ fieldtype: "Date", fieldname: "boarding_begins_on", label: __("办理开始日期"), reqd: 1, default: frappe.datetime.get_today() },
			{ fieldtype: "Date", fieldname: "date_of_joining", label: __("预计入职日期"), reqd: 1, default: frappe.datetime.get_today() },
			{ fieldtype: "Link", fieldname: "holiday_list", label: __("假期列表"), options: "Holiday List" },
		],
		primary_action_label: __("进入入职单填写"),
		primary_action(values) {
			dialog.hide();
			frappe.new_doc("Employee Onboarding", values);
		},
	});

	dialog.set_query("job_applicant", () => ({ filters: { status: "Accepted" } }));
	dialog.set_query("job_offer", () => ({
		filters: { job_applicant: dialog.get_value("job_applicant"), docstatus: 1, status: "Accepted" },
	}));
	dialog.set_query("employee_onboarding_template", () => ({ filters: company ? { company } : {} }));
	dialog.fields_dict.job_applicant.df.onchange = () => dialog.set_value("job_offer", "");
	dialog.show();
}
