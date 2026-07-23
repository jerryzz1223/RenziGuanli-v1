// Copyright (c) 2022, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Department", {
	refresh: function (frm) {
		localize_department_form_labels(frm);

		frm.set_query("payroll_cost_center", function () {
			return {
				filters: {
					company: frm.doc.company,
					is_group: 0,
				},
			};
		});

		frm.add_custom_button(__("快速编辑字段"), function () {
			frappe.set_route("List", "Department");
			frappe.after_ajax(() => {
				frappe.show_alert({
					message: __("请在部门列表勾选该部门后使用“快速编辑”。"),
					indicator: "blue",
				});
			});
		});

		if (!frm.is_new() && frm.doc.department_name?.trim() && frm.doc.name !== frm.doc.department_name.trim()) {
			frm.add_custom_button(__("规范正式部门名称"), function () {
				frappe.prompt(
					[
						{
							fieldname: "confirmation",
							fieldtype: "Data",
							label: __("确认文字"),
							description: __("请输入“确认规范部门名称”。"),
							reqd: 1,
						},
					],
					(values) => {
						frappe
							.call({
								method: "hrms.api.department_identity.rename_department_to_business_name",
								args: { department: frm.doc.name, confirmation: values.confirmation },
								freeze: true,
								freeze_message: __("正在更新部门关联..."),
							})
							.then((r) => frappe.set_route("Form", "Department", r.message.name));
					},
					__("规范正式部门名称"),
					__("执行")
				);
			});
		}
	},

	after_delete: function () {
		frappe.set_route("List", "Department");
	},
});

function localize_department_form_labels(frm) {
	const labels = {
		department_name: "部门",
		company: "公司",
		parent_department: "上级部门",
		is_group: "是否分组",
		disabled: "已停用",
		payroll_cost_center: "薪资成本中心",
		leave_block_list: "假期封存列表",
		hrms_org_section: "组织管理",
		hrms_org_level: "组织层级",
		hrms_org_role: "组织角色",
		hrms_org_manager: "组织负责人",
		hrms_org_proxy: "代理负责人",
		hrms_planned_headcount: "编制人数",
		hrms_actual_headcount: "现有人数",
		hrms_vacancy_count: "空缺人数",
		hrms_recruitment_plan: "招聘计划",
		hrms_org_source_cell: "组织图来源单元格",
		approvers: "审批人",
		shift_request_approver: "班次申请审批人",
		leave_approvers: "请假审批人",
		expense_approvers: "费用审批人",
	};

	Object.entries(labels).forEach(([fieldname, label]) => {
		if (frm.fields_dict[fieldname]) {
			frm.set_df_property(fieldname, "label", __(label));
		}
	});

	if (frm.fields_dict.leave_block_list) {
		frm.set_df_property(
			"leave_block_list",
			"description",
			__("该部门适用的假期封存日期列表。")
		);
	}
	if (frm.fields_dict.approvers) {
		frm.set_df_property(
			"approvers",
			"description",
			__("列表中的第一位审批人将作为默认审批人。")
		);
	}

	["shift_request_approver", "leave_approvers", "expense_approvers"].forEach((table_fieldname) => {
		const grid = frm.fields_dict[table_fieldname]?.grid;
		if (!grid) return;
		grid.update_docfield_property("approver", "label", __("审批人"));
		grid.refresh();
	});
}
