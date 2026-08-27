// Copyright (c) 2016, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Training Feedback", {
	onload: function (frm) {
		frm.add_fetch("training_event", "course", "course");
		frm.add_fetch("training_event", "event_name", "event_name");
		frm.add_fetch("training_event", "trainer_name", "trainer_name");
	},
	refresh: function (frm) {
		frm.set_intro(__("参训人员完成后填写课程、讲师和组织安排的评价；建议满意度低于 4 分时记录改进建议。"), "blue");
	},
});
