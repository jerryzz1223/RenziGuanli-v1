// Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

{% include 'hrms/hr/employee_business_code_selector.js' %}

function hide_standard_separation_activity(frm) {
	frm.page.wrapper
		.find(".form-footer, .new-timeline")
		.attr("aria-hidden", "true")
		.css("display", "none");
}

function hide_internal_separation_name(frm) {
	frm.page.wrapper.find(".form-sidebar .form-name-container").each(function () {
		if (($(this).attr("data-copy") || "").trim() === frm.doc.name) {
			$(this).attr("aria-hidden", "true").css("display", "none");
		}
	});
}

function apply_separation_display_rules(frm) {
	hide_standard_separation_activity(frm);
	hide_internal_separation_name(frm);
}

function apply_separation_submit_confirmation(frm) {
	if (frm.__hrms_separation_submit_confirmation_applied) return;

	frm.__hrms_separation_submit_confirmation_applied = true;
	frm.savesubmit = function (btn, callback) {
		const form = this;
		const employee_label = [form.doc.employee_code_display, form.doc.employee_name]
			.filter(Boolean)
			.join(" · ");

		return form.check_if_latest().then(
			() =>
				new Promise((resolve, reject) => {
					frappe.confirm(
						__("正式提交 {0}？", [employee_label]),
						() => form.save("Submit", callback, btn).then(resolve).catch(reject),
						() => {
							form.validated = false;
							resolve();
						},
					);
				}),
		);
	};
}

frappe.ui.form.on("Employee Separation", {
	setup: function (frm) {
		window.hrmsEmployeeBusinessCodeSelector.setup(frm);
	},

	refresh: function (frm) {
		window.hrmsEmployeeBusinessCodeSelector.refresh(frm);
		apply_separation_submit_confirmation(frm);
		[
			"employee",
			"employee_separation_template",
			"project",
			"table_for_activity",
			"activities",
			"notify_users_by_email",
		].forEach((fieldname) => frm.toggle_display(fieldname, false));

		const employee_label = [frm.doc.employee_code_display, frm.doc.employee_name].filter(Boolean).join(" · ");
		if (employee_label) {
			frm.page.set_title(employee_label);
		}

		// Frappe 会在 refresh 后继续渲染侧栏和时间线，因此同步和下一帧都执行一次。
		apply_separation_display_rules(frm);
		requestAnimationFrame(() => apply_separation_display_rules(frm));
		setTimeout(() => apply_separation_display_rules(frm), 120);

		if (frm.doc.employee) {
			frm.add_custom_button(
				__("查看员工档案"),
				function () {
					frappe.set_route("employee-detail", frm.doc.employee);
				},
				__("员工"),
			);
		}
	},

	employee: function (frm) {
		window.hrmsEmployeeBusinessCodeSelector.employee_selected(frm);
	},

	employee_code_display: function (frm) {
		window.hrmsEmployeeBusinessCodeSelector.resolve_employee(frm);
	},
});
