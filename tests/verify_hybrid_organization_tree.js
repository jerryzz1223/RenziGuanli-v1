const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pageDir = path.join(root, "hrms", "hr", "page", "organizational_chart");
const pyPath = path.join(pageDir, "organizational_chart.py");
const jsPath = path.join(pageDir, "organizational_chart.js");
const cssPath = path.join(pageDir, "organizational_chart.css");
const seedPath = path.join(pageDir, "yongxin_q2_org_structure.json");
const departmentJsPath = path.join(root, "hrms", "public", "js", "erpnext", "department_list.js");
const departmentFormJsPath = path.join(root, "hrms", "public", "js", "erpnext", "department.js");
const hooksPath = path.join(root, "hrms", "hooks.py");
const setupPath = path.join(root, "hrms", "setup.py");
const localizeZhPath = path.join(root, "hrms", "localize_zh.py");
const navPath = path.join(root, "hrms", "public", "js", "hrms_home_redirect_v6.js");
const topNavPath = path.join(root, "hrms", "public", "js", "hrms_top_nav.js");

function read(file) {
	if (!fs.existsSync(file)) {
		throw new Error(`Missing file: ${path.relative(root, file)}`);
	}
	return fs.readFileSync(file, "utf8");
}

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) {
		throw new Error(message || `Missing marker: ${marker}`);
	}
}

function mustMatch(source, pattern, message) {
	if (!pattern.test(source)) {
		throw new Error(message || `Missing pattern: ${pattern}`);
	}
}

const py = read(pyPath);
const js = read(jsPath);
const css = read(cssPath);
const seed = read(seedPath);
const departmentJs = read(departmentJsPath);
const departmentFormJs = read(departmentFormJsPath);
const hooks = read(hooksPath);
const setup = read(setupPath);
const localizeZh = read(localizeZhPath);
const nav = read(navPath);
const topNav = read(topNavPath);

for (const marker of [
	"def get_hybrid_tree(",
	"def get_hybrid_node_detail(",
	"def get_employee_roster_field_map(",
	"def get_yongxin_q2_org_template_preview(",
	"def preview_yongxin_department_hierarchy(",
	"def preview_yongxin_position_hierarchy(",
	"def preview_yongxin_q3_organization_snapshot(",
	"def preview_yongxin_q3_department_hierarchy(",
	"def import_yongxin_q3_department_hierarchy(",
	"def import_yongxin_q2_org_structure(",
	"def update_department_fields(",
	"上级部门不能选择当前部门或其下级部门",
	"必须先设置为文件夹部门",
	"文件夹部门不能用于花名册归属",
	"def move_organization_node(",
	"def delete_departments(",
	"YONGXIN_Q2_ORG_TEMPLATE",
	"YONGXIN_Q3_BASELINE_WORKBOOK",
	"YONGXIN_Q3_ORG_SHEET",
	"YONGXIN_Q3_DEPARTMENT_HIERARCHY",
	"_organization_business_name",
	"_organization_source_name",
	"raw_department_name",
	"raw_designation_name",
	"snapshot_version",
	"write_mode",
	"preview_only",
	"_company_has_imported_org_template",
	"_is_yongxin_company",
	"_get_yongxin_template_tree",
	"_build_template_tree_node",
	"_build_template_people",
	"_get_employee_lookup",
	"_get_template_node_detail",
	"HYBRID_MANAGER_KEYWORDS",
	"HYBRID_ROSTER_FIELD_MAP",
	"DEPARTMENT_QUICK_EDIT_FIELDS",
	"_import_department_node",
	"_upsert_department_from_node",
	"_import_position_templates",
	"_ensure_designation",
	"_is_management_designation",
	"_get_department_staffing",
	"def get_organization_report",
	'"columns": ["部门/课别", "编制人数", "现有人数", "空缺人数", "岗位满足率", "备注"]',
	"_get_department_relationships",
	"_is_all_departments_name",
	"_build_department_node",
	"_build_live_management_hierarchy",
	"_build_live_division_nodes",
	"_wrap_deputy_divisions",
	"_collect_template_department_units",
	"_position_hierarchy_level",
	"_position_hierarchy_message",
	"_matches_template_designation",
	"课与组同名",
	"同一课下存在同名组",
	"_suggest_template_team_name",
	"_classify_management_role",
	"_build_management_node",
	"_build_employee_group_node",
	"_build_work_level_nodes",
	"_build_position_group_nodes",
	"_build_employee_node",
	"_get_designation_parent_map",
	"_would_create_employee_reporting_loop",
	"_would_create_designation_loop",
	'"node_type": "work_level"',
	'"node_type": "position_group"',
	'if node_type not in TEMPLATE_DEPARTMENT_NODE_TYPES',
	"group_people =",
	'"people": group_people',
	'"employee_route": employee.get("name")',
	'"employee_code": _employee_business_number(employee)',
	"def resolve_employee_code",
	"_employee_business_number",
	"_resolve_yongxin_company_candidates",
	"_company_business_weight",
	"_get_node_employees",
	"_validate_department_delete",
	"def update_employee_group",
	"fieldname not in {\"grade\", \"designation\"}",
	"planned_headcount",
	"current_headcount",
	"vacancy_count",
	"missing_department_count",
	"missing_manager_count",
	"reports_to",
	"designation",
	"matched_employee",
	"match_status",
	"grade",
	"branch",
	"frappe.whitelist()",
]) {
	mustInclude(py, marker, `Hybrid organization backend missing marker: ${marker}`);
}

mustMatch(
	py,
	/def get_hybrid_tree\([\s\S]*?root_node\["connections"\][\s\S]*?return \{[\s\S]*?"root": root_node[\s\S]*?@frappe\.whitelist\(\)\s*def get_organization_report/,
	"get_hybrid_tree must return the live tree before the organization report definition",
);

mustMatch(
	py,
	/root_node = _build_live_management_hierarchy\([\s\S]*?department_nodes=/,
	"Live charts must keep the Excel management line above Department nodes",
);

mustMatch(
	js,
	/const roots = root\.node_type === "company" \? root\.children \|\| \[\] : \[root\];/,
	"The chart must only hide a technical Company root, never the management hierarchy",
);

for (const marker of [
	'"source_document": "1.2组织架构.xlsx"',
	'"title": "2026年第2季度组织架构图"',
	'"chart_tree"',
	'"node_type": "company_leadership"',
	'"node_type": "director"',
	'"name": "总经理：林俊松"',
	'"name": "技术总监：陈文萍"',
	'"name": "管理总监：逯瑜"',
	'"department_tree"',
	'"position_templates"',
	'"staffing_summary"',
	'"name": "凌龙分管"',
	'"name": "连续课"',
	'"name": "生产组"',
]) {
	mustInclude(seed, marker, `Yongxin organization seed missing marker: ${marker}`);
}

for (const marker of [
	'"fieldname": "hrms_org_level"',
	'"fieldname": "hrms_org_role"',
	'"fieldname": "hrms_org_manager"',
	'"fieldname": "hrms_org_proxy"',
	'"fieldname": "hrms_planned_headcount"',
	'"fieldname": "hrms_actual_headcount"',
	'"fieldname": "hrms_vacancy_count"',
	'"fieldname": "hrms_parent_designation"',
]) {
	mustInclude(setup, marker, `Organization setup custom field missing marker: ${marker}`);
}

for (const marker of [
	'"Department": "public/js/erpnext/department_list.js"',
]) {
	mustInclude(hooks, marker, `Department list hook missing marker: ${marker}`);
}

for (const marker of [
	"frappe.listview_settings[\"Department\"]",
	"setup_department_list_actions",
	"show_department_quick_edit_dialog",
	"show_department_hierarchy_preview_dialog",
	"render_department_hierarchy_preview",
	"show_position_hierarchy_preview_dialog",
	"render_position_hierarchy_preview",
	"show_department_bulk_delete_dialog",
	"preview_yongxin_department_hierarchy",
	"preview_yongxin_position_hierarchy",
	"预检部门层级",
	"核对职位层级",
	"get_selected_departments",
	"hrms.hr.page.organizational_chart.organizational_chart.update_department_fields",
	"hrms.hr.page.organizational_chart.organizational_chart.delete_departments",
	"调整层级",
	"先将承担上级职责的节点勾选为文件夹部门",
	"批量删除部门",
	"parent_department",
	"上级部门",
	"frappe.set_route(\"List\", \"Department\")",
	"listview.refresh()",
]) {
	mustInclude(departmentJs, marker, `Department list quick edit/delete missing marker: ${marker}`);
}

for (const marker of [
	"localize_department_form_labels",
	"configure_focused_department_form",
	"sync_company_root_parent_display",
	"is_technical_department_root",
	"get_company_root_label",
	"公司根节点",
	"hide_department_sidebar",
	"render_department_relationships",
	"FOCUSED_DEPARTMENT_FIELDS",
	"HIDDEN_DEPARTMENT_FIELDS",
	"frm.set_df_property",
	"parent_department",
	"上级部门",
	"文件夹部门（可包含下级部门）",
	"允许花名册归属（仅末级）",
	"enforce_roster_leaf_rule",
	"下级部门",
	"当前部门员工",
	"frappe.db.get_list(\"Department\"",
	"frappe.db.get_list(\"Employee\"",
]) {
	mustInclude(departmentFormJs, marker, `Department form localization missing marker: ${marker}`);
}

for (const marker of [
	'"Parent Department": "上级部门"',
	'"All Departments": "所有部门"',
	'"Is Group": "是否分组"',
	'"Disabled": "已停用"',
	'"Leave Block List": "假期封存列表"',
	'"Organization Management": "组织管理"',
	'"Organization Level": "组织层级"',
	'"Planned Headcount": "编制人数"',
	'"Actual Headcount": "现有人数"',
	'"Vacancy Count": "空缺人数"',
	'"Recruitment Plan": "招聘计划"',
	'"Search": "搜索"',
	'"Save": "保存"',
	'"Assign": "分派"',
	'"Attachments": "附件"',
	'"Tags": "标签"',
	'"Share": "分享"',
	'"Enabled": "已启用"',
]) {
	mustInclude(localizeZh, marker, `Chinese localization dictionary missing marker: ${marker}`);
}

for (const marker of [
	"frappe.pages[\"organizational-chart\"]",
	"HybridOrganizationChart",
	"getClientRects().length",
	"YONGXIN_COMPANY",
	"get_hybrid_tree",
	"get_hybrid_node_detail",
	"get_employee_roster_field_map",
	"set_company",
	"同步2026Q3架构",
	"新增部门",
	"编辑部门",
	"删除部门",
	"data-action=\"add-department\"",
	"data-action=\"edit-department\"",
	"data-action=\"delete-department\"",
	"get_yongxin_q2_org_template_preview",
	"import_yongxin_q2_org_structure",
	"import_yongxin_q3_department_hierarchy",
	"同步2026Q3架构",
	"show_department_edit_dialog",
	"quick_edit_node",
	"get_node_department",
	"data-action=\"quick-edit-node\"",
	"data-action=\"fit-view\"",
	"data-tree-stage",
	"fit_to_view",
	"apply_tree_scale",
	"MIN_ORG_CHART_ZOOM",
	"render_load_error",
	"frappe.new_doc(\"Department\"",
	"delete_departments",
	"render_tree_node",
	"render_person_tokens",
	"this.search_term",
	"matching_people",
	"show_person_detail",
	"render_detail_panel",
	"render_department_relationships",
	"render_employee_list",
	"get_route_mode",
	"render_report_shell",
	"load_organization_report",
	"export_report_table",
	"edit_employee_group",
	"update_employee_group",
	"data-action=\"open-person\"",
	"data-person-name",
	"data-employee",
	"data-employee-route",
	"data-employee-code",
	"data-action=\"select-node\"",
	"normalize_employee_route_value",
	"normalize_employee_code_value",
	"resolve_employee_route_value",
	"resolve_employee_code",
	"node.employee_route || node.employee",
	"当前人员没有可用于匹配档案的员工编号",
	"expand_all",
	"collapse_all",
	"export_chart",
]) {
	mustInclude(js, marker, `Hybrid organization frontend missing marker: ${marker}`);
}

mustMatch(
	js,
	/export_chart\(\)\s*\{[\s\S]*?export_organization_chart_excel[\s\S]*?link\.download = file\.file_name \|\| `\$\{this\.company \|\| YONGXIN_COMPANY\}_组织架构图\.xlsx`;/s,
	"Organization chart export must download an Excel workbook instead of opening the browser print dialog",
);

if (/export_chart\(\)\s*\{\s*window\.print\(\);\s*\}/.test(js)) {
	throw new Error("Organization chart export must not open the browser print dialog.");
}

for (const marker of ["def export_organization_chart_excel", "YONGXIN_ORG_EXPORT_TEMPLATE", "_refresh_organization_export_nodes", "_refresh_organization_export_summary", "组织架构图.xlsx"]) {
	mustInclude(py, marker, `Organization chart Excel export missing marker: ${marker}`);
}

for (const marker of [
	"YONGXIN_Q3_ORG_WORKBOOK_CANDIDATES",
	"WORKBOOK_SNAPSHOT_NODE_ROWS",
	"def _get_yongxin_workbook_snapshot_tree",
	"def _parse_workbook_snapshot_nodes",
	"def _build_workbook_snapshot_relationships",
	"def _get_workbook_snapshot_node_detail",
	'"snapshot_fallback": True',
	"原始 Excel 未部署，当前页面仍可正常查看",
	'"source_mode": "workbook_snapshot"',
	"source_employee_count",
]) {
	mustInclude(py, marker, `Workbook-backed organization snapshot missing marker: ${marker}`);
}

for (const marker of [
	'this.source_mode = "live"',
	"set_source_mode",
	"move_organization_node",
	"handle_drag_start",
	"handle_drop",
	'draggable="${movable ? "true" : "false"}"',
	"toggle_fullscreen",
	"requestFullscreen",
	"source_mode: this.source_mode",
	"原表人员",
	"另有 {0} 人，请点击查看",
	"class=\"hrms-org-person-more\"",
	"data-action=\"select-node\"",
]) {
	mustInclude(js, marker, `Organization source/fullscreen frontend missing marker: ${marker}`);
}

for (const marker of [
	".hrms-org-page",
	".hrms-org-tree-canvas",
	".hrms-org-node",
	".hrms-org-node--company",
	".hrms-org-node--company_leadership",
	".hrms-org-node--director",
	".hrms-org-node--department",
	".hrms-org-node--manager",
	".hrms-org-node--employee_group",
	".hrms-org-node--work_level",
	".hrms-org-node--position_group",
	".hrms-org-tree-stage",
	".hrms-org-node-lines",
	".hrms-org-node-edit",
	".hrms-org-person-token",
	".hrms-org-person-token.is-unmatched",
	".hrms-org-person-detail",
	".hrms-org-detail",
	"min-height: 0",
	"align-self: stretch",
	"height: 100%",
	"overflow-y: auto",
	"overscroll-behavior: contain",
	"overflow-wrap: anywhere",
	"white-space: normal",
	"width: 100%",
	"height: 8px",
	"padding: 10px 12px 11px",
	"top: 2px",
	"pointer-events: none",
	"z-index: 2",
	".hrms-org-employee-row",
	".hrms-org-toolbar",
	".hrms-org-vacancy-marker",
	".hrms-org-node.is-drop-target",
	".hrms-org-node--employee",
]) {
	mustInclude(css, marker, `Hybrid organization CSS missing marker: ${marker}`);
}

for (const marker of ["get_organization_report", "导出表格", "批准：", "text/csv;charset=utf-8"]) {
	mustInclude(js, marker, `Embedded organization report frontend missing marker: ${marker}`);
}
for (const marker of [".hrms-org-report", "border-collapse: collapse", "border: 1px solid #1f2933"]) {
	mustInclude(css, marker, `Embedded organization report CSS missing marker: ${marker}`);
}
mustInclude(css, ".hrms-org-page.is-fullscreen", "Organization chart must provide a dedicated fullscreen layout.");

mustMatch(
	css,
	/\.hrms-org-tree,\s*\.hrms-org-tree ul\s*\{[^}]*justify-content:\s*center;[^}]*\}/s,
	"Organization chart must lay out sibling nodes on the same row",
);

mustMatch(
	css,
	/\.hrms-org-node\s*\{[^}]*border:\s*1px solid #1f2933;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/s,
	"Organization cards must use the Excel-style black line visual language",
);

mustMatch(
	css,
	/\.hrms-org-page\s*\{[^}]*\bheight:\s*calc\(100vh - 52px\);[^}]*\boverflow:\s*hidden;/s,
	"Hybrid organization page must constrain itself to the viewport and prevent document-level scrolling",
);

mustMatch(
	css,
	/\.hrms-org-tree li::before,[^}]*\.hrms-org-tree li::after\s*\{[^}]*pointer-events:\s*none;/s,
	"Organization tree connector lines must not intercept nested node actions",
);

mustMatch(
	js,
	/normalize_employee_route_value\(employee\)\s*\{[^}]*value\.length\s*>\s*140[^}]*return value;/s,
	"Employee navigation must accept trusted numeric and configured Employee document names",
);

mustMatch(
	js,
	/load_tree\(\)\s*\{[\s\S]*?\.catch\(\(error\)\s*=>[\s\S]*?render_load_error\(error,/,
	"Organization tree loading must recover from request failures instead of remaining blank",
);

mustMatch(
	py,
	/if source_mode == \"quarterly_template\":\s*return _get_yongxin_template_tree\(company\)/,
	"The quarterly workbook must be an explicit reference view; the default chart must use live Department relationships",
);

mustMatch(
	py,
	/children\.extend\(_build_work_level_nodes\(department, employees, managers\)\)/,
	"Live department trees must retain work-level nodes before position and employee nodes",
);

mustMatch(
	css,
	/\.hrms-org-detail\s*\{[^}]*\balign-self:\s*stretch;[^}]*\bheight:\s*100%;[^}]*\boverflow-y:\s*auto;/s,
	"Hybrid organization detail panel must remain fixed in its grid column and scroll independently",
);

for (const marker of [
	'{ type: "link", label: "部门管理", route: "/desk/department", slug: "department" }',
	'{ type: "link", label: "架构图", route: "/desk/organizational-chart", slug: "organizational-chart" }',
	'{ type: "link", label: "部门报表", route: "/desk/organizational-chart/report", slug: "organization-report" }',
]) {
	mustInclude(nav, marker, `Organization shell nav missing marker: ${marker}`);
}

mustInclude(topNav, '"organizational-chart"', "Top nav must keep organizational chart as an organization route key.");

for (const forbidden of ["render_sidebar()", "hrms-org-sidebar", "data-route="]) {
	if (js.includes(forbidden) || css.includes(forbidden)) {
		throw new Error(`Organizational chart must not render a second department sidebar: ${forbidden}`);
	}
}

for (const forbidden of [
	'{ type: "link", label: "公司管理", route: "/desk/company-management"',
	"data-company-field",
	"shift_request_approver: \"班次申请审批人\"",
	"leave_approvers: \"请假审批人\"",
	"expense_approvers: \"费用审批人\"",
	'{ label: "公司", route: "/desk/company", slug: "company" }',
	'{ label: "分支机构", route: "/desk/branch", slug: "branch" }',
	'{ label: "岗位", route: "/desk/designation", slug: "designation" }',
	'{ label: "职级", route: "/desk/employee-grade", slug: "employee-grade" }',
	'keys: ["company", "branch", "department", "designation", "employee-grade", "organizational-chart", "organization-report"]',
	"matching_people.slice(0, 8)",
]) {
	for (const [source, name] of [
		[nav, "global organization navigation"],
		[topNav, "top organization navigation"],
		[js, "organization chart page"],
		[departmentFormJs, "department form"],
	]) {
		if (source.includes(forbidden)) {
			throw new Error(`${name} must not expose company/branch/job-grade organization entries: ${forbidden}`);
		}
	}
}

console.log("Hybrid organization tree APIs, UI, edit actions, and navigation are wired.");
