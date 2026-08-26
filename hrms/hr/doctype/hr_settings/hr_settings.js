// Copyright (c) 2016, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("HR Settings", {
	refresh: function (frm) {
		frm.set_query("sender", () => {
			return {
				filters: {
					enable_outgoing: 1,
				},
			};
		});
		frm.set_query("hiring_sender", () => {
			return {
				filters: {
					enable_outgoing: 1,
				},
			};
		});
		if (!(frm.doc.attendance_final_excel_fields || []).length) {
			frm.add_custom_button(__("初始化终稿 Excel 表头"), () => {
				frappe.call({
					method: "hrms.api.attendance_processing_center.seed_attendance_final_excel_fields",
					callback: () => frm.reload_doc(),
				});
			}, __("考勤设置"));
		}
	},
});

frappe.tour["HR Settings"] = [
	{
		fieldname: "emp_created_by",
		title: "Employee Naming By",
		description: __(
			"Employee can be named by Employee ID if you assign one, or via Naming Series. Select your preference here.",
		),
	},
	{
		fieldname: "standard_working_hours",
		title: "Standard Working Hours",
		description: __(
			"Enter the Standard Working Hours for a normal work day. These hours will be used in calculations of reports such as Employee Hours Utilization and Project Profitability analysis.",
		),
	},
	{
		fieldname: "leave_and_expense_claim_settings",
		title: "Leave and Expense Claim Settings",
		description: __(
			"Review various other settings related to Employee Leaves and Expense Claim",
		),
	},
];
