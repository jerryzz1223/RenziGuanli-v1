// Copyright (c) 2022, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

const FOCUSED_DEPARTMENT_FIELDS = [
	"department_name",
	"parent_department",
	"is_group",
	"hrms_org_level",
	"hrms_org_role",
	"hrms_org_manager",
	"hrms_org_card_content",
	"hrms_roster_assignable",
];
const HIDDEN_DEPARTMENT_FIELDS = [
	"company",
	"disabled",
	"payroll_cost_center",
	"leave_block_list",
	"hrms_org_section",
	"hrms_org_proxy",
	"hrms_planned_headcount",
	"hrms_actual_headcount",
	"hrms_vacancy_count",
	"hrms_recruitment_plan",
	"hrms_org_source_cell",
	"approvers",
	"shift_request_approver",
	"leave_approvers",
	"expense_approvers",
];

frappe.ui.form.on("Department", {
	refresh(frm) {
		localize_department_form_labels(frm);
		configure_focused_department_form(frm);
		sync_company_root_parent_display(frm);
		hide_department_sidebar(frm);
		render_department_relationships(frm);

		frm.add_custom_button(__("调整层级"), () => {
			frappe.set_route("List", "Department");
			frappe.after_ajax(() => {
				frappe.show_alert({
					message: __("请在部门列表勾选该部门后使用“调整层级”。"),
					indicator: "blue",
				});
			});
		});
	},

	company(frm) {
		set_parent_department_query(frm);
	},

	parent_department(frm) {
		sync_company_root_parent_display(frm);
		render_department_relationships(frm);
	},

	is_group(frm) {
		enforce_roster_leaf_rule(frm);
	},

	hrms_roster_assignable(frm) {
		enforce_roster_leaf_rule(frm);
	},

	after_save(frm) {
		sync_company_root_parent_display(frm);
		render_department_relationships(frm);
	},

	after_delete() {
		frappe.set_route("List", "Department");
	},
});

function localize_department_form_labels(frm) {
	const labels = {
		department_name: "部门名称",
		parent_department: "上级部门",
		is_group: "文件夹部门（可包含下级部门）",
		hrms_org_level: "组织层级（数字越小越高）",
		hrms_org_role: "组织角色",
		hrms_org_manager: "负责人",
		hrms_org_card_content: "架构图卡片说明",
		hrms_roster_assignable: "允许花名册归属（仅末级）",
	};
	Object.entries(labels).forEach(([fieldname, label]) => {
		if (frm.fields_dict[fieldname]) frm.set_df_property(fieldname, "label", __(label));
	});
}

function configure_focused_department_form(frm) {
	const contextCompany = window.hrmsCompanyContext?.getCurrentCompany?.();
	if (!frm.doc.company && contextCompany) frm.set_value("company", contextCompany);
	HIDDEN_DEPARTMENT_FIELDS.forEach((fieldname) => {
		if (frm.fields_dict[fieldname]) frm.set_df_property(fieldname, "hidden", 1);
	});
	FOCUSED_DEPARTMENT_FIELDS.forEach((fieldname) => {
		if (frm.fields_dict[fieldname]) frm.set_df_property(fieldname, "hidden", 0);
	});
	if (frm.fields_dict.is_group) {
		frm.set_df_property("is_group", "description", __("勾选后可作为其他部门的上级；未勾选即为末级部门。"));
	}
	if (frm.fields_dict.hrms_roster_assignable) {
		frm.set_df_property("hrms_roster_assignable", "description", __("只为实际填入员工花名册的末级部门勾选。"));
	}
	if (frm.fields_dict.hrms_org_manager) {
		frm.set_df_property("hrms_org_manager", "description", __("可填写多位负责人，用顿号、逗号或换行分隔。"));
	}
	if (frm.fields_dict.hrms_org_card_content) {
		frm.set_df_property("hrms_org_card_content", "description", __("仅显示在来源单元格对应的原表架构卡片中，不改变部门层级。"));
	}
	set_parent_department_query(frm);
}

function is_technical_department_root(parent_department) {
	const normalized = String(parent_department || "").replace(/\s+/g, "").toLowerCase();
	return ["alldepartments", "all部门s", "所有部门"].includes(normalized);
}

function get_company_root_label(frm) {
	const context_company = window.hrmsCompanyContext?.getCurrentCompany?.();
	const company = context_company || frm.doc.company || "永新";
	return company === "1" ? "永新" : company;
}

function get_company_root_display(frm) {
	return `${get_company_root_label(frm)}（${__("总公司")}）`;
}

function sync_company_root_parent_display(frm) {
	const field = frm.fields_dict.parent_department;
	if (!field?.$wrapper) return;

	const technical_root = is_technical_department_root(frm.doc.parent_department);
	field.$wrapper.find(".hrms-company-root-parent").remove();
	field.$wrapper.find(".control-input").removeClass("hide");
	if (!technical_root) return;

	const company = escape_html(get_company_root_display(frm));
	const root_context = $(
		`<div class="hrms-company-root-parent">
			<div class="hrms-company-root-parent__value">${company}</div>
			<small>${__("公司根节点")}</small>
			<button type="button" class="btn btn-default btn-xs" data-action="edit-parent-department">${__("调整上级部门")}</button>
		</div>`,
	);
	field.$wrapper.find(".control-input").addClass("hide");
	field.$wrapper.append(root_context);
	root_context.on("click", "[data-action='edit-parent-department']", () => {
		root_context.remove();
		field.$wrapper.find(".control-input").removeClass("hide");
		field.$input?.focus();
	});
}

function set_parent_department_query(frm) {
	frm.set_query("parent_department", () => ({
		filters: {
			company: frm.doc.company,
			name: ["!=", frm.doc.name || ""],
			disabled: 0,
			is_group: 1,
		},
	}));
}

function enforce_roster_leaf_rule(frm) {
	if (!frm.doc.is_group || !frm.doc.hrms_roster_assignable) return;
	frm.set_value("hrms_roster_assignable", 0);
	frappe.show_alert({ message: __("文件夹部门不能用于花名册归属，已自动取消勾选。"), indicator: "orange" });
}

function hide_department_sidebar(frm) {
	frm.wrapper.classList.add("hrms-focused-department-form");
	frm.wrapper.querySelectorAll(".layout-side-section, .form-footer, .form-timeline, .new-timeline").forEach((element) => {
		element.style.display = "none";
	});
	frm.wrapper.querySelectorAll(".layout-main-section-wrapper, .layout-main-section").forEach((element) => {
		element.style.width = "100%";
		element.style.maxWidth = "100%";
	});
}

function render_department_relationships(frm) {
	const anchor = frm.fields_dict.parent_department?.$wrapper;
	if (!anchor?.length) return;

	if (!frm.__hrms_relationship_wrapper) {
		frm.__hrms_relationship_wrapper = $("<div class='hrms-department-relationships'></div>");
		anchor.after(frm.__hrms_relationship_wrapper);
		frm.__hrms_relationship_wrapper.on("click", "[data-department]", (event) => {
			frappe.set_route("Form", "Department", event.currentTarget.dataset.department);
		});
		frm.__hrms_relationship_wrapper.on("click", "[data-employee]", (event) => {
			frappe.set_route("Form", "Employee", event.currentTarget.dataset.employee);
		});
	}

	if (frm.is_new()) {
		frm.__hrms_relationship_wrapper.html(render_relationship_sections(frm, [], []));
		return;
	}

	frm.__hrms_relationship_wrapper.html(`<div class="text-muted">${__("正在读取部门关系...")}</div>`);
	Promise.all([
		frappe.db.get_list("Department", {
			filters: { parent_department: frm.doc.name, company: frm.doc.company },
			fields: ["name", "department_name"],
			order_by: "department_name asc",
			limit: 500,
		}),
		frappe.db.get_list("Employee", {
			filters: { department: frm.doc.name, status: "Active" },
			fields: ["name", "employee_name", "designation", "grade"],
			order_by: "employee_name asc",
			limit: 500,
		}),
	])
		.then(([children, employees]) => {
			if (!frm.__hrms_relationship_wrapper?.is(":visible")) return;
			frm.__hrms_relationship_wrapper.html(render_relationship_sections(frm, children || [], employees || []));
		})
		.catch(() => {
			frm.__hrms_relationship_wrapper.html(`<div class="text-muted">${__("部门关系读取失败，请刷新后重试。")}</div>`);
		});
}

function render_relationship_sections(frm, children, employees) {
	const has_business_parent = Boolean(frm.doc.parent_department) && !is_technical_department_root(frm.doc.parent_department);
	const structure_state = frm.doc.is_group
		? __("文件夹部门：可承载下级部门，不直接作为花名册归属。")
		: frm.doc.hrms_roster_assignable
			? __("末级部门：可作为花名册归属。")
			: __("末级部门：如需将员工归入此部门，请启用“允许花名册归属”。");
	const parent = has_business_parent
		? `<button type="button" class="btn btn-default btn-sm" data-department="${escape_html(frm.doc.parent_department)}">${escape_html(frm.doc.parent_department)}</button>`
		: `<span class="text-muted">${escape_html(get_company_root_display(frm))}</span>`;
	return `
		<style>
			.hrms-focused-department-form .layout-side-section,
			.hrms-focused-department-form .form-footer,
			.hrms-focused-department-form .comment-box,
			.hrms-focused-department-form .form-timeline,
			.hrms-focused-department-form .new-timeline { display: none !important; }
			.hrms-department-relationships { clear: both; padding: 24px 0 8px; }
			.hrms-department-relation-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
			.hrms-department-relation { border: 1px solid var(--border-color); padding: 16px; background: var(--card-bg); }
			.hrms-department-relation h4 { font-size: 14px; margin: 0 0 12px; }
			.hrms-department-relation-list { display: flex; flex-wrap: wrap; gap: 8px; max-height: 320px; overflow: auto; }
			.hrms-department-employee { display: flex; flex-direction: column; align-items: flex-start; min-width: 140px; white-space: normal; }
			.hrms-department-employee small { color: var(--text-muted); }
			.hrms-company-root-parent { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 7px 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--control-bg); }
			.hrms-company-root-parent__value { font-weight: 600; }
			.hrms-company-root-parent small { color: var(--text-muted); }
			@media (max-width: 900px) { .hrms-department-relation-grid { grid-template-columns: 1fr; } }
		</style>
		<div class="hrms-department-relation-grid">
			<section class="hrms-department-relation hrms-department-structure-state">
				<h4>${__("当前管理状态")}</h4>
				<div>${escape_html(structure_state)}</div>
			</section>
			<section class="hrms-department-relation">
				<h4>${__("上级部门")}</h4>
				<div class="hrms-department-relation-list">${parent}</div>
			</section>
			<section class="hrms-department-relation">
				<h4>${__("下级部门")} (${children.length})</h4>
				<div class="hrms-department-relation-list">${children.length ? children.map(render_child_department).join("") : `<span class="text-muted">${__("暂无下级部门")}</span>`}</div>
			</section>
			<section class="hrms-department-relation">
				<h4>${__("当前部门员工")} (${employees.length})</h4>
				<div class="hrms-department-relation-list">${employees.length ? employees.map(render_department_employee).join("") : `<span class="text-muted">${__("暂无在职员工")}</span>`}</div>
			</section>
		</div>
	`;
}

function render_child_department(department) {
	return `<button type="button" class="btn btn-default btn-sm" data-department="${escape_html(department.name)}">${escape_html(department.department_name || department.name)}</button>`;
}

function render_department_employee(employee) {
	const meta = [employee.designation, employee.grade].filter(Boolean).join(" · ");
	return `<button type="button" class="btn btn-default btn-sm hrms-department-employee" data-employee="${escape_html(employee.name)}"><strong>${escape_html(employee.employee_name || employee.name)}</strong>${meta ? `<small>${escape_html(meta)}</small>` : ""}</button>`;
}

function escape_html(value) {
	return frappe.utils.escape_html(String(value || ""));
}
