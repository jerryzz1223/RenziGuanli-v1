const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pageDir = path.join(root, "hrms", "hr", "page", "organizational_chart");
const pyPath = path.join(pageDir, "organizational_chart.py");
const jsPath = path.join(pageDir, "organizational_chart.js");
const cssPath = path.join(pageDir, "organizational_chart.css");
const seedPath = path.join(pageDir, "yongxin_q2_org_structure.json");
const departmentJsPath = path.join(root, "hrms", "public", "js", "erpnext", "department_list.js");
const hooksPath = path.join(root, "hrms", "hooks.py");
const setupPath = path.join(root, "hrms", "setup.py");
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

const py = read(pyPath);
const js = read(jsPath);
const css = read(cssPath);
const seed = read(seedPath);
const departmentJs = read(departmentJsPath);
const hooks = read(hooksPath);
const setup = read(setupPath);
const nav = read(navPath);
const topNav = read(topNavPath);

for (const marker of [
	"def get_hybrid_tree(",
	"def get_hybrid_node_detail(",
	"def get_employee_roster_field_map(",
	"def get_yongxin_q2_org_template_preview(",
	"def import_yongxin_q2_org_structure(",
	"def update_department_fields(",
	"def delete_departments(",
	"YONGXIN_Q2_ORG_TEMPLATE",
	"_company_has_imported_org_template",
	"_get_yongxin_template_tree",
	"_build_template_tree_node",
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
	"_build_department_node",
	"_build_management_node",
	"_build_employee_group_node",
	"_get_node_employees",
	"_validate_department_delete",
	"planned_headcount",
	"current_headcount",
	"vacancy_count",
	"missing_department_count",
	"missing_manager_count",
	"reports_to",
	"designation",
	"grade",
	"branch",
	"frappe.whitelist()",
]) {
	mustInclude(py, marker, `Hybrid organization backend missing marker: ${marker}`);
}

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
	"show_department_bulk_delete_dialog",
	"get_selected_departments",
	"hrms.hr.page.organizational_chart.organizational_chart.update_department_fields",
	"hrms.hr.page.organizational_chart.organizational_chart.delete_departments",
	"快速编辑",
	"批量删除部门",
	"hrms_org_manager",
	"hrms_planned_headcount",
	"hrms_recruitment_plan",
	"frappe.set_route(\"List\", \"Department\")",
	"listview.refresh()",
]) {
	mustInclude(departmentJs, marker, `Department list quick edit/delete missing marker: ${marker}`);
}

for (const marker of [
	"frappe.pages[\"organizational-chart\"]",
	"HybridOrganizationChart",
	"get_hybrid_tree",
	"get_hybrid_node_detail",
	"get_employee_roster_field_map",
	"组织管理",
	"架构图",
	"组织报表",
	"导入架构模板",
	"新增部门",
	"编辑部门",
	"删除部门",
	"data-action=\"add-department\"",
	"data-action=\"edit-department\"",
	"data-action=\"delete-department\"",
	"get_yongxin_q2_org_template_preview",
	"import_yongxin_q2_org_structure",
	"show_department_edit_dialog",
	"hrms_org_manager",
	"hrms_planned_headcount",
	"frappe.new_doc(\"Department\"",
	"delete_departments",
	"render_tree_node",
	"render_detail_panel",
	"render_employee_list",
	"expand_all",
	"collapse_all",
	"export_chart",
]) {
	mustInclude(js, marker, `Hybrid organization frontend missing marker: ${marker}`);
}

for (const marker of [
	".hrms-org-page",
	".hrms-org-sidebar",
	".hrms-org-tree-canvas",
	".hrms-org-node",
	".hrms-org-node--company",
	".hrms-org-node--company_leadership",
	".hrms-org-node--director",
	".hrms-org-node--department",
	".hrms-org-node--manager",
	".hrms-org-node--employee_group",
	".hrms-org-node-lines",
	".hrms-org-detail",
	".hrms-org-employee-row",
	".hrms-org-toolbar",
]) {
	mustInclude(css, marker, `Hybrid organization CSS missing marker: ${marker}`);
}

for (const marker of [
	'{ type: "link", label: "组织管理", route: "/desk/department", slug: "department" }',
	'{ type: "link", label: "架构图", route: "/desk/organizational-chart", slug: "organizational-chart" }',
	'{ type: "link", label: "组织报表", route: "/desk/staffing-plan", slug: "staffing-plan" }',
]) {
	mustInclude(nav, marker, `Organization shell nav missing marker: ${marker}`);
}

mustInclude(topNav, '"organizational-chart"', "Top nav must keep organizational chart as an organization route key.");

for (const forbidden of [
	'{ label: "公司", route: "/desk/company", slug: "company" }',
	'{ label: "分支机构", route: "/desk/branch", slug: "branch" }',
	'{ label: "岗位", route: "/desk/designation", slug: "designation" }',
	'{ label: "职级", route: "/desk/employee-grade", slug: "employee-grade" }',
	'keys: ["company", "branch", "department", "designation", "employee-grade", "organizational-chart", "staffing-plan"]',
	'<label>${__("公司")}</label>',
]) {
	for (const [source, name] of [
		[nav, "global organization navigation"],
		[topNav, "top organization navigation"],
		[js, "organization chart page"],
	]) {
		if (source.includes(forbidden)) {
			throw new Error(`${name} must not expose company/branch/job-grade organization entries: ${forbidden}`);
		}
	}
}

console.log("Hybrid organization tree APIs, UI, edit actions, and navigation are wired.");
