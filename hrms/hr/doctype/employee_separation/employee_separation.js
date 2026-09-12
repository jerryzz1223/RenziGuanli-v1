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

function hide_standard_separation_sidebar(frm) {
	const page_container = frm.page.wrapper.closest(".page-container");
	const scope = page_container.length ? page_container : frm.page.wrapper;
	page_container.addClass("hrms-employee-separation-no-sidebar");
	if (!document.getElementById("hrms-employee-separation-no-sidebar-style")) {
		$("<style>", {
			id: "hrms-employee-separation-no-sidebar-style",
			text: `
				.hrms-employee-separation-no-sidebar .layout-side-section,
				.hrms-employee-separation-no-sidebar .form-sidebar { display: none !important; }
				.hrms-employee-separation-no-sidebar .layout-main-section-wrapper {
					width: 100% !important;
					max-width: none !important;
					flex: 0 0 100% !important;
				}
			`,
		}).appendTo(document.head);
	}
	scope
		.find(".layout-side-section, .form-sidebar")
		.attr("aria-hidden", "true")
		.css("display", "none");
	scope
		.find(".layout-main-section-wrapper")
		.removeClass("col-lg-10 col-md-9")
		.addClass("col-12")
		.css({ width: "100%", "max-width": "none" });
}

function apply_separation_display_rules(frm) {
	hide_standard_separation_activity(frm);
	hide_internal_separation_name(frm);
	hide_standard_separation_sidebar(frm);
}

function get_separation_parent_context(frm) {
	const raw_source = new URLSearchParams(window.location.search).get("hrms_from");
	let source = raw_source;
	try {
		source = JSON.parse(raw_source);
	} catch (error) {
		// Plain query values remain valid for manually opened URLs.
	}
	const completed = frm?.doc?.docstatus === 1 && frm?.doc?.boarding_status === "Completed";
	if (source === "employee-separation-records" || completed) {
		return {
			label: __("离职记录"),
			route: "/desk/employee-separation-records",
			back_label: __("返回离职记录"),
		};
	}
	return {
		label: __("离职管理"),
		route: "/desk/employee-separation",
		back_label: __("返回离职管理"),
	};
}

function apply_separation_breadcrumb(frm) {
	if (window.hrmsApplyContextualBreadcrumbs) {
		window.hrmsApplyContextualBreadcrumbs();
		return;
	}
	const parent = get_separation_parent_context(frm);
	const employee_label = [frm.doc.employee_code_display, frm.doc.employee_name].filter(Boolean).join(" · ");
	frappe.breadcrumbs.add({
		type: "Custom",
		label: parent.label,
		route: parent.route,
	});
	if (employee_label) {
		frappe.breadcrumbs.append_breadcrumb_element("", employee_label, "title-text-form");
		frappe.breadcrumbs.$breadcrumbs.find("li").last().addClass("disabled");
	}
}

function add_separation_back_button(frm) {
	const parent = get_separation_parent_context(frm);
	frm.add_custom_button(parent.back_label, function () {
		if (parent.route === "/desk/employee-separation-records") {
			frappe.route_options = {};
			frappe.set_route("employee-separation-records");
			return;
		}
		frappe.route_options = { docstatus: 1, boarding_status: "Pending" };
		frappe.set_route("List", "Employee Separation");
	}).addClass("btn-default");
}

const separation_reasons_by_type = {
	主动离职: ["家庭原因", "个人原因", "发展原因", "合同到期不续签", "其他"],
	被动离职: ["协议解除", "无法胜任工作", "经济性裁员", "严重违法违纪", "其他"],
};

function refresh_separation_reason_options(frm, clear_invalid = false) {
	const reasons = separation_reasons_by_type[frm.doc.separation_reason_type] || [];
	frm.set_df_property("separation_reason", "options", ["", ...reasons].join("\n"));

	if (clear_invalid && frm.doc.separation_reason && !reasons.includes(frm.doc.separation_reason)) {
		frm.set_value("separation_reason", "");
	}
	if (frm.doc.separation_reason_type !== "自定义" && frm.doc.custom_separation_reason) {
		frm.set_value("custom_separation_reason", "");
	}
}

frappe.ui.form.on("Employee Separation", {
	setup: function (frm) {
		window.hrmsEmployeeBusinessCodeSelector.setup(frm);
	},

	refresh: function (frm) {
		window.hrmsEmployeeBusinessCodeSelector.refresh(frm);
		refresh_separation_reason_options(frm);
		add_separation_back_button(frm);
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
		apply_separation_breadcrumb(frm);
		requestAnimationFrame(() => {
			apply_separation_display_rules(frm);
			apply_separation_breadcrumb(frm);
		});
		setTimeout(() => {
			apply_separation_display_rules(frm);
			apply_separation_breadcrumb(frm);
		}, 120);

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

	separation_reason_type: function (frm) {
		refresh_separation_reason_options(frm, true);
	},
});
