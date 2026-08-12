// Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

{% include 'hrms/hr/employee_property_update.js' %}
{% include 'hrms/hr/employee_business_code_selector.js' %}

const TRANSFER_PROPERTY_FIELDS = [
	"department",
	"designation",
	"grade",
	"reports_to",
	"employment_type",
	"custom_direct_indirect",
	"custom_is_confirmed",
];

const TRANSFER_PROPERTY_LABELS = {
	department: __("部门"),
	designation: __("岗位"),
	grade: __("职级"),
	reports_to: __("直属上级"),
	employment_type: __("工作性质"),
	custom_direct_indirect: __("直间接"),
	custom_is_confirmed: __("是否转正"),
};

function set_transfer_field_property(frm, fieldname, property, value) {
	if (frm.fields_dict[fieldname]) {
		frm.set_df_property(fieldname, property, value);
	}
}

function set_transfer_field_visibility(frm, fieldname, visible) {
	if (frm.fields_dict[fieldname]) {
		frm.toggle_display(fieldname, visible);
	}
}

function configure_transfer_employee_identity(frm) {
	// Employee.name remains the internal relation only. HR users operate by company employee code.
	set_transfer_field_visibility(frm, "employee", false);
	["employee_code_display", "employee_name"].forEach((fieldname) => {
		set_transfer_field_visibility(frm, fieldname, true);
		set_transfer_field_property(frm, fieldname, "read_only", 1);
		set_transfer_field_property(frm, fieldname, "reqd", 1);
	});

	[
		"transfer_type",
		"company",
		"new_company",
		"department",
		"approval_reference",
		"create_new_employee_id",
		"new_employee_id",
		"reallocate_leaves",
	].forEach((fieldname) => set_transfer_field_visibility(frm, fieldname, false));
}

function apply_transfer_form_labels(frm) {
	frm.__hrms_employee_property_fields = TRANSFER_PROPERTY_FIELDS;
	frm.__hrms_employee_property_labels = TRANSFER_PROPERTY_LABELS;
	frm.__hrms_inline_property_selection = true;

	[
		["employee_code_display", "员工工号"],
		["employee_name", "员工姓名"],
		["transfer_reason", "异动原因"],
		["transfer_date", "生效日期"],
		["remarks", "备注"],
		["draft_creation_info", "草稿信息"],
		["details_section", "异动明细"],
		["transfer_details", "本次变更项目"],
	].forEach(([fieldname, label]) => set_transfer_field_property(frm, fieldname, "label", label));

	set_transfer_field_property(
		frm,
		"details_section",
		"description",
		__("选择本次实际变化的部门、岗位、职级、直属上级或工作性质；提交后自动更新员工档案并写入任职记录。")
	);
	configure_transfer_employee_identity(frm);
}

function render_transfer_draft_creation_info(frm) {
	const field = frm.fields_dict.draft_creation_info;
	if (!field) return;

	const is_saved_draft = frm.doc.docstatus === 0 && !frm.is_new();
	frm.toggle_display("draft_creation_info", is_saved_draft);
	if (!is_saved_draft) return;

	const creation = frappe.datetime.str_to_user?.(frm.doc.creation) || frm.doc.creation || "-";
	const creator = frm.doc.owner || "-";
	field.$wrapper.html(
		`<div class="hrms-transfer-draft-creation-info"><span>${frappe.utils.escape_html(__("创建时间"))}：${frappe.utils.escape_html(creation)}</span><span>${frappe.utils.escape_html(__("创建人"))}：${frappe.utils.escape_html(creator)}</span></div>`,
	);
}

function hide_transfer_modified_metadata(frm) {
	const sidebar = frm.page?.wrapper?.[0]?.querySelector(".form-sidebar");
	if (!sidebar) return;

	sidebar.querySelectorAll(".modified-by, .form-sidebar-stats > div").forEach((item) => {
		const text = (item.textContent || "").replace(/\s+/g, " ").trim();
		if (/最近编辑|last edited|\bedited\b/i.test(text) && !/创建|created/i.test(text)) {
			item.classList.add("hrms-transfer-modified-metadata-hidden");
		}
	});
}

function derive_transfer_type(frm) {
	const changed_fields = (frm.doc.transfer_details || [])
		.filter((row) => !row.__deleted)
		.map((row) => row.fieldname);
	const transfer_type = changed_fields.includes("custom_is_confirmed")
		? "转全职"
		: changed_fields.includes("grade")
			? "晋升"
			: "调岗";

	if (frm.doc.transfer_type !== transfer_type) {
		frm.set_value("transfer_type", transfer_type);
	}
}

function set_transfer_value_if_changed(frm, fieldname, value) {
	const nextValue = value || "";
	if ((frm.doc[fieldname] || "") === nextValue) {
		return false;
	}
	frm.set_value(fieldname, nextValue);
	return true;
}

function sync_transfer_employee(frm) {
	const selectedEmployee = frm.doc.employee;
	if (
		!selectedEmployee ||
		frappe.ui.form.is_saving ||
		frm.__hrms_transfer_identity_loading === selectedEmployee
	) {
		return;
	}

	frm.__hrms_transfer_identity_loading = selectedEmployee;
	const clearLoading = () => {
		if (frm.__hrms_transfer_identity_loading === selectedEmployee) {
			delete frm.__hrms_transfer_identity_loading;
		}
	};

	frappe.call({
		method: "hrms.hr.doctype.employee_transfer.employee_transfer.get_employee_business_options",
		args: { company: frm.doc.company || "" },
		callback(response) {
			try {
				if (frm.doc.employee !== selectedEmployee || frappe.ui.form.is_saving) {
					return;
				}

				const employee = (response.message || []).find((row) => row.name === selectedEmployee);
				if (!employee) {
					return;
				}

				set_transfer_value_if_changed(frm, "employee_code_display", employee.employee_code || "");
				set_transfer_value_if_changed(frm, "employee_name", employee.employee_name || "");
				set_transfer_value_if_changed(frm, "company", employee.company || frm.doc.company || "");
				set_transfer_value_if_changed(frm, "department", employee.department || frm.doc.department || "");
			} finally {
				clearLoading();
			}
		},
		error() {
			clearLoading();
		},
	});
}

frappe.ui.form.on("Employee Transfer", {
	setup(frm) {
		apply_transfer_form_labels(frm);
	},

	onload(frm) {
		if (frm.is_new() && !frm.doc.transfer_date) {
			frm.set_value("transfer_date", frappe.datetime.get_today());
		}
		sync_transfer_employee(frm);
	},

	refresh(frm) {
		apply_transfer_form_labels(frm);
		derive_transfer_type(frm);
		render_transfer_draft_creation_info(frm);
		hide_transfer_modified_metadata(frm);
	},

	employee(frm) {
		frm.trigger("clear_property_table");
		sync_transfer_employee(frm);
	},

	transfer_details_add(frm) {
		derive_transfer_type(frm);
	},

	transfer_details_remove(frm) {
		derive_transfer_type(frm);
	},

	on_submit(frm) {
		frappe.show_alert({ message: __("人事异动已提交并写入任职记录"), indicator: "green" });
	},
});
