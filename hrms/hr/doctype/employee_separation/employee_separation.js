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

frappe.ui.form.on("Employee Separation", {
	setup: function (frm) {
		window.hrmsEmployeeBusinessCodeSelector.setup(frm);
	},

	refresh: function (frm) {
		window.hrmsEmployeeBusinessCodeSelector.refresh(frm);
		[
			"employee",
			"company",
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

		if (frm.doc.docstatus === 1 && frm.doc.boarding_status === "Pending") {
			frm.set_intro(__("离职申请已提交，正在等待审批；审批前不改变员工工作性质。"), "orange");
		}

		if (frm.doc.docstatus === 1 && frm.doc.boarding_status === "Completed") {
			const departure_is_future = frappe.datetime.get_diff(frm.doc.boarding_begins_on, frappe.datetime.get_today()) > 0;
			frm.set_intro(
				departure_is_future
					? __("离职申请已审批；未到离职日期，员工工作性质为“待离职”。")
					: __("离职申请已审批且离职日期已到，员工工作性质为“离职”。"),
				"green",
			);
		}

		if (
			frm.doc.docstatus === 1 &&
			frm.doc.boarding_status === "Pending" &&
			(frappe.session.user === "Administrator" || frappe.user.has_role("System Manager"))
		) {
			frm.add_custom_button(__("审批通过"), function () {
				frappe.confirm(
					__("审批通过后，未到离职日期的员工将变为“待离职”，到期后自动变为“离职”。是否继续？"),
					() => {
						frappe.call({
							method: "hrms.hr.doctype.employee_separation.employee_separation.approve_employee_separation",
							args: { separation_name: frm.doc.name },
							freeze: true,
							freeze_message: __("正在审批离职申请……"),
							callback: () => frm.reload_doc(),
						});
					},
				);
			}).addClass("btn-primary");
		}
	},

	employee: function (frm) {
		window.hrmsEmployeeBusinessCodeSelector.employee_selected(frm);
	},

	employee_code_display: function (frm) {
		window.hrmsEmployeeBusinessCodeSelector.resolve_employee(frm);
	},
});
