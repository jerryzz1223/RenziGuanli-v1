// Copyright (c) 2017, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Training Program", {
	refresh(frm) {
		frm.set_intro(
			__("先明确培训类别、期间、目标和必修要求；审核通过后，从本计划创建培训活动并闭环考核、反馈和员工技能记录。"),
			"blue",
		);
		if (!frm.is_new()) {
			frm.add_custom_button(__("创建培训活动"), () => {
				frappe.new_doc("Training Event", {
					training_program: frm.doc.name,
					company: frm.doc.company,
					training_category: frm.doc.training_category,
					training_mode: frm.doc.training_mode,
				});
			}, __("培训执行"));
			frm.add_custom_button(__("查看培训活动"), () => {
				frappe.route_options = { training_program: frm.doc.name };
				frappe.set_route("List", "Training Event");
			}, __("培训执行"));
		}
	},
});
