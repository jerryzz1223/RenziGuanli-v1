// Copyright (c) 2016, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Training Result", {
	training_event: function (frm) {
		if (frm.doc.training_event && !frm.doc.docstatus) {
			frappe.call({
				method: "hrms.hr.doctype.training_result.training_result.get_employees",
				args: {
					training_event: frm.doc.training_event,
				},
				callback: function (r) {
					frm.set_value("employees", "");
					if (r.message) {
						$.each(r.message, function (i, d) {
							var row = frappe.model.add_child(
								frm.doc,
								"Training Result Employee",
								"employees",
							);
							row.employee = d.employee;
							row.employee_name = d.employee_name;
							row.assessment_result = d.attendance === "Present" ? "Pending" : "Absent";
							row.needs_retraining = d.attendance === "Present" ? 0 : 1;
						});
					}
					refresh_field("employees");
				},
			});
		}
	},
	refresh: function (frm) {
		frm.set_intro(
			__("请按参训人员逐行填写课时、分数和考核结论；缺席或未通过人员勾选“需要补训”，以便后续重新安排培训活动。"),
			"blue",
		);
	},
});
