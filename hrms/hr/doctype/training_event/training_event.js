// Copyright (c) 2016, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Training Event", {
	onload_post_render: function (frm) {
		frm.get_field("employees").grid.set_multiple_add("employee");
	},
	refresh: function (frm) {
		frm.set_intro(
			__("完成通知和签到后，使用“培训结果”登记课时、成绩与补训结论；安全、资格类课程请填写复训截止日期和资格用途。"),
			"blue",
		);
		if (!frm.doc.__islocal) {
			frm.add_custom_button(__("登记培训结果"), function () {
				frappe.route_options = {
					training_event: frm.doc.name,
				};
				frappe.set_route("List", "Training Result");
			});
			frm.add_custom_button(__("收集培训反馈"), function () {
				frappe.route_options = {
					training_event: frm.doc.name,
				};
				frappe.set_route("List", "Training Feedback");
			});
			frm.add_custom_button(__("查看员工技能"), function () {
				frappe.set_route("List", "Employee Skill Map");
			}, __("学习闭环"));
		}
		frm.events.set_employee_query(frm);
	},

	set_employee_query: function (frm) {
		let emp = [];
		for (let d in frm.doc.employees) {
			if (frm.doc.employees[d].employee) {
				emp.push(frm.doc.employees[d].employee);
			}
		}
		frm.set_query("employee", "employees", function () {
			return {
				filters: {
					name: ["NOT IN", emp],
					status: "Active",
				},
			};
		});
	},
});

frappe.ui.form.on("Training Event Employee", {
	employee: function (frm) {
		frm.events.set_employee_query(frm);
	},
});
