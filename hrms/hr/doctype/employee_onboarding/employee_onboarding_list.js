frappe.listview_settings["Employee Onboarding"] = {
	add_fields: ["boarding_status", "employee_name", "date_of_joining", "department"],
	onload: function (listview) {
		if (listview.page.__hrms_onboarding_rules_ready) return;
		listview.page.__hrms_onboarding_rules_ready = true;
		listview.page.add_inner_button(__("入职规则配置"), function () {
			frappe.set_route("List", "Employee Onboarding Template");
		});
		listview.page.add_inner_button(__("初始化标准入职规则"), function () {
			const company = window.hrmsCompanyContext?.getCurrentCompany?.() || frappe.defaults?.get_user_default?.("Company");
			if (!company) {
				frappe.msgprint(__("请先在页面顶部选择当前公司。"));
				return;
			}
			frappe.confirm(
				__("将为 {0} 创建一套可编辑的标准入职规则；已有规则不会被覆盖。是否继续？", [company]),
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
