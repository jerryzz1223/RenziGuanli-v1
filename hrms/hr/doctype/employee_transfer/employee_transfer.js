// Copyright (c) 2018, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

{% include 'hrms/hr/employee_property_update.js' %}
{% include 'hrms/hr/employee_business_code_selector.js' %}

const TRANSFER_PROPERTY_FIELDS = [
	"department",
	"designation",
	"grade",
	"reports_to",
	"branch",
	"employment_type",
	"custom_direct_indirect",
	"custom_is_confirmed",
];

const CROSS_COMPANY_TRANSFER_TYPE = "跨公司调动";

const TRANSFER_PROPERTY_LABELS = {
	department: __("部门"),
	designation: __("岗位"),
	grade: __("职级"),
	reports_to: __("直属上级"),
	branch: __("分支机构"),
	employment_type: __("工作性质"),
	custom_direct_indirect: __("直间接"),
	custom_is_confirmed: __("是否转正"),
};

function apply_transfer_form_labels(frm) {
	frm.__hrms_employee_property_fields = TRANSFER_PROPERTY_FIELDS;
	frm.__hrms_employee_property_labels = TRANSFER_PROPERTY_LABELS;

	[
		["employee_code_display", "员工工号"],
		["employee_name", "员工姓名"],
		["transfer_type", "异动类型"],
		["transfer_reason", "异动原因"],
		["transfer_date", "生效日期"],
		["company", "原公司"],
		["new_company", "新公司"],
		["department", "原部门"],
		["approval_reference", "关联审批单"],
		["remarks", "备注"],
		["details_section", "异动明细"],
		["transfer_details", "本次变更项目"],
		["create_new_employee_id", "跨公司调动时新建员工档案"],
		["new_employee_id", "新员工档案"],
	].forEach(([fieldname, label]) => {
		if (frm.fields_dict[fieldname]) {
			frm.set_df_property(fieldname, "label", __(label));
		}
	});

	if (frm.fields_dict.details_section) {
		frm.set_df_property(
			"details_section",
			"description",
			__("先选择异动类型和原因，再添加部门、岗位、职级等实际发生变化的项目。提交后会同步更新员工当前任职信息并生成任职记录。")
		);
	}
}

function sync_transfer_type_fields(frm) {
	const is_cross_company_transfer = frm.doc.transfer_type === CROSS_COMPANY_TRANSFER_TYPE;

	if (frm.fields_dict.company) {
		frm.set_df_property("company", "read_only", 1);
	}

	frm.toggle_display("new_company", is_cross_company_transfer);
	frm.toggle_display("create_new_employee_id", is_cross_company_transfer);
	frm.set_df_property("new_company", "reqd", is_cross_company_transfer ? 1 : 0);

	if (!is_cross_company_transfer && frm.doc.docstatus === 0) {
		if (frm.doc.new_company) frm.set_value("new_company", "");
		if (frm.doc.create_new_employee_id) frm.set_value("create_new_employee_id", 0);
		if (frm.doc.new_employee_id) frm.set_value("new_employee_id", "");
	}

	frm.toggle_display(
		"new_employee_id",
		is_cross_company_transfer && Boolean(frm.doc.new_employee_id)
	);
}

frappe.ui.form.on('Employee Transfer', {
	setup(frm) {
		window.hrmsEmployeeBusinessCodeSelector.setup(frm);
		apply_transfer_form_labels(frm);
		sync_transfer_type_fields(frm);
	},

	refresh(frm) {
		window.hrmsEmployeeBusinessCodeSelector.refresh(frm);
		apply_transfer_form_labels(frm);
		sync_transfer_type_fields(frm);
	},

	employee(frm) {
		frm.trigger("clear_property_table");
		window.hrmsEmployeeBusinessCodeSelector.employee_selected(frm);
		sync_transfer_type_fields(frm);
	},

	employee_code_display(frm) {
		window.hrmsEmployeeBusinessCodeSelector.resolve_employee(frm);
		sync_transfer_type_fields(frm);
	},

	transfer_type(frm) {
		sync_transfer_type_fields(frm);
	},

	create_new_employee_id(frm) {
		sync_transfer_type_fields(frm);
	},
});
