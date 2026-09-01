const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const hooksPath = path.join(root, "hrms", "hooks.py");
const redirectPath = path.join(root, "hrms", "public", "js", "hrms_home_redirect_v6.js");
const topNavPath = path.join(root, "hrms", "public", "js", "hrms_top_nav.js");
const topNavCssPath = path.join(root, "hrms", "public", "css", "hrms_top_nav.css");
const employeeFormPath = path.join(root, "hrms", "public", "js", "erpnext", "employee.js");
const employeeListPath = path.join(root, "hrms", "public", "js", "erpnext", "employee_list.js");
const employeeApiPath = path.join(root, "hrms", "api", "employee_field_template.py");
const employeeTransferPath = path.join(root, "hrms", "hr", "doctype", "employee_transfer", "employee_transfer.js");
const employeeTransferJsonPath = path.join(root, "hrms", "hr", "doctype", "employee_transfer", "employee_transfer.json");
const employeePromotionPath = path.join(root, "hrms", "hr", "doctype", "employee_promotion", "employee_promotion.js");
const employeePromotionJsonPath = path.join(root, "hrms", "hr", "doctype", "employee_promotion", "employee_promotion.json");
const employeeSeparationPath = path.join(root, "hrms", "hr", "doctype", "employee_separation", "employee_separation.js");
const employeeSeparationJsonPath = path.join(root, "hrms", "hr", "doctype", "employee_separation", "employee_separation.json");
const employeeCodeSelectorPath = path.join(root, "hrms", "hr", "employee_business_code_selector.js");
const employeeDetailJsonPath = path.join(root, "hrms", "hr", "page", "employee_detail", "employee_detail.json");
const employeeDetailJsPath = path.join(root, "hrms", "hr", "page", "employee_detail", "employee_detail.js");
const personnelPath = path.join(root, "hrms", "hr", "workspace", "personnel", "personnel.json");
const personnelSidebarPath = path.join(root, "hrms", "workspace_sidebar", "personnel.json");

const hooks = fs.readFileSync(hooksPath, "utf8");
const redirect = fs.readFileSync(redirectPath, "utf8");
const topNav = fs.readFileSync(topNavPath, "utf8");
const topNavCss = fs.readFileSync(topNavCssPath, "utf8");
const employeeForm = fs.readFileSync(employeeFormPath, "utf8");
const employeeList = fs.readFileSync(employeeListPath, "utf8");
const employeeApi = fs.readFileSync(employeeApiPath, "utf8");
const personnel = JSON.parse(fs.readFileSync(personnelPath, "utf8"));
const personnelSidebar = JSON.parse(fs.readFileSync(personnelSidebarPath, "utf8"));

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) {
		throw new Error(message || `Missing marker: ${marker}`);
	}
}

mustInclude(hooks, '"Employee": "public/js/erpnext/employee_list.js"', "Employee list view customization must be registered in hooks.py.");
mustInclude(hooks, '"Employee": "public/js/erpnext/employee.js"', "Employee form customization must remain registered in hooks.py.");
mustInclude(topNavCss, "hrms-roster-toolbar-control-hidden", "员工花名册必须隐藏未启用的标准工具栏控件。");

for (const label of ["桌面", "Desktop", "网站", "Website", "编辑侧边栏", "Edit Sidebar", "Delete Demo Data"]) {
	mustInclude(redirect, label, `Global sidebar dropdown cleanup must handle: ${label}`);
}
mustInclude(redirect, "hide_empty_workspace_dropdowns", "Workspace dropdown should be hidden when every item is removed.");
mustInclude(redirect, ".frappe-menu.context-menu", "Workspace dropdown cleanup must handle Frappe context menus.");

for (const marker of ["主页", "人事", "组织", "招聘", "考勤假期", "薪酬", "审批", "培训学习", "绩效", "更多"]) {
	mustInclude(topNav, marker, `Top navbar is missing module: ${marker}`);
}

for (const marker of [
	"get_employee_roster",
	"get_employee_roster_summary",
	"quick_update_employee_roster",
	"search_fields: [\"employee_name\", \"cell_number\", \"custom_employee_code\"]",
	"EMPLOYEE_ROSTER_REQUIRED_COLUMNS",
	'"employee_name": "姓名"',
	'"custom_employee_code": "工号"',
	'"department": "部门"',
	'"designation": "岗位"',
	'"employment_type": "工作性质"',
	'"date_of_joining": "入职日期"',
	'"custom_id_type": "证件类型"',
	'"passport_number": "证件号码"',
	'"cell_number": "手机号码"',
	"ensure_required_roster_columns",
	"roster_visible",
	"sort_options",
	"page_length",
	"dynamic_columns",
	"_count_employee_rows",
	"_build_employee_roster_filters",
	"_hydrate_employee_roster_display_values",
	"_department_display_name",
	"department_display",
	"get_employee_by_business_code",
	"page_length = min(max(frappe.utils.cint(page_length) or 20, 10), 500)",
]) {
	mustInclude(employeeApi, marker, `Employee roster API is missing phase-one behavior: ${marker}`);
}

for (const marker of [
	"表头联想筛选",
	"员工花名册",
	"在职 · 正式",
	"在职 · 试用期",
	"退休返聘",
	"待离职",
	"离职",
	"添加员工",
	"导入",
	"导出",
	"hide_unused_roster_toolbar_controls",
	"hrms-roster-column-filter-input, .hrms-roster-empty-result-header__input",
	"hrms-roster-toolbar-control-hidden",
	"快速编辑",
	"部门筛选",
	"入职日期",
	"更新时间",
	"工号",
	"分页",
	"selected_status_card",
	"department_filter",
	"sort_options",
	"page_length",
	"dynamic_columns",
	"quick_update_employee_roster",
	"get_employee_roster",
	"get_employee_roster_summary",
	"frappe.db.count",
	"get_user_default(\"Company\")",
	"frappe.set_route",
	"frappe.set_route(\"employee-detail\"",
	"apply_single_roster_filter",
	"build_roster_query",
	"hrms-employee-roster-view",
	"hide_name_column: true",
	"format_roster_department_display",
	"format_roster_employee_code_display",
	"normalise_roster_list_cells",
	"bind_roster_employee_detail_navigation",
	"resolve_roster_employee_name",
	"decodeURIComponent(match[1])",
	"event.stopImmediatePropagation()",
	"custom_employee_code || value",
	"apply_roster_meta_columns",
	"ROSTER_ALL_EMPLOYEES_PAGE_LENGTH",
	"ROSTER_TABLE_PAGE_LENGTH",
	"page_length: ROSTER_TABLE_PAGE_LENGTH",
	"configure_roster_page_length",
	"hide_roster_page_length_controls",
	"querySelectorAll(\".sort-selector\")",
	"querySelectorAll(\".filter-section\")",
	"ensure_roster_records_loaded",
	"load_roster_table_records",
	"hide_native_roster_field_filters",
	"remove_native_roster_list_header",
	"expand_roster_layout",
	"stretch_roster_result_area",
	"getBoundingClientRect().top",
	"main_top",
	"window.innerHeight - main_top - 8",
	"window.innerHeight - top - 12",
	"no-list-sidebar",
	"hrms-employee-roster-page",
	"hrms-roster-table-header",
	"hrms-roster-table-header__input",
	"apply_roster_column_sort",
	"hrms-roster-table-wrap",
	"hrms-roster-input-table",
	"get_roster_table_columns",
	"get_visible_roster_table_rows",
	"load_roster_table_records",
	"hrms.api.employee_field_template.get_employee_roster",
	"hrms-payroll-input-table hrms-roster-input-table",
	"render_roster_table_pagination",
	"page_size: 20",
	"姓名 / 工号",
	"hrms-roster-identity-cell",
	"get_roster_filter_suggestions",
	"apply_roster_column_filter",
	"ROSTER_COLUMN_FILTER_STORAGE_KEY",
	"apply_roster_filters_to_live_listview",
	"filter_area.clear_filters()",
	"update_roster_filter_status",
	"当前筛选",
]) {
	mustInclude(employeeList, marker, `Employee list view is missing roster behavior marker: ${marker}`);
}

for (const obsoleteMarker of ["hrms-roster-search-control", "hrms-roster-search-button"]) {
	if (employeeList.includes(obsoleteMarker)) {
		throw new Error(`Employee roster must not retain the redundant top search control: ${obsoleteMarker}`);
	}
}

const bootstrapMetaIndex = employeeList.indexOf("apply_roster_meta_columns();");
const listSettingsIndex = employeeList.indexOf("frappe.listview_settings[EMPLOYEE_DOCTYPE] = {");
if (bootstrapMetaIndex < 0 || bootstrapMetaIndex > listSettingsIndex) {
	throw new Error("工号列必须在 Frappe ListView 初始化前写入 Employee 元数据，不能等到 onload 后再修改。");
}

if (employeeList.includes("listview.filter_area.add([[EMPLOYEE_DOCTYPE, fieldname, \"=\", filters[fieldname]]]")) {
	throw new Error("Roster cards must not append filters through the native filter panel.");
}

mustInclude(topNavCss, "body.hrms-employee-roster-view .filter-button", "Employee roster must hide the native filter button.");
mustInclude(topNavCss, ".hrms-roster-card.is-active", "Employee roster must show a single active status card.");
mustInclude(topNavCss, ".hrms-roster-page-length-hidden", "Employee roster must hide only the page-size choices, not its data.");
mustInclude(topNavCss, ".hrms-roster-native-filters-hidden", "Employee roster must remove its redundant top field filters.");
mustInclude(topNavCss, ".page-container.hrms-employee-roster-page .layout-main-section-wrapper", "Employee roster must target the actual ListView layout wrapper.");
mustInclude(topNavCss, "flex: 1 1 100% !important;", "Employee roster must release Frappe's 80% list-shell width.");
mustInclude(topNavCss, ".page-container[data-page-route=\"Workspaces\"] .layout-main", "Workspaces must remove Frappe's reading-column width cap.");
mustInclude(topNavCss, ".page-container[data-page-route=\"Workspaces\"] .layout-main-section-wrapper", "Workspaces must use the available desktop width.");
mustInclude(topNavCss, "body.hrms-module-shell .page-container > .page-body", "Module pages must share a full-height content shell.");
mustInclude(topNavCss, "min-height: calc(100vh - var(--navbar-height, 56px));", "Module pages must extend to the viewport bottom.");
mustInclude(topNavCss, "body.hrms-module-shell .main-section", "Frappe's list-height measurement node must fill the viewport.");
mustInclude(topNavCss, ".hrms-roster-table-header", "Employee roster must provide one fixed business table header.");
mustInclude(topNavCss, ".hrms-roster-table-header__input", "Employee roster header must provide searchable inputs.");
mustInclude(topNavCss, ".hrms-roster-table-header__sort", "Employee roster header must provide sortable column titles.");
mustInclude(topNavCss, ".hrms-roster-table-wrap", "Employee roster must use one payroll-style table surface.");
mustInclude(topNavCss, ".hrms-roster-input-table", "Employee roster data and header must share one table layout.");
mustInclude(topNavCss, ".hrms-roster-identity-cell", "Employee name and business code must be rendered in one identity cell.");
mustInclude(topNavCss, ".hrms-roster-table-pagination", "Employee roster must provide visible paging for the custom table.");
mustInclude(topNavCss, ".hrms-roster-input-table", "Employee roster must style its payroll-compatible table cells.");
const rosterTableCss = topNavCss.slice(topNavCss.indexOf(".hrms-roster-table-wrap"), topNavCss.indexOf(".hrms-roster-input-table"));
if (!rosterTableCss.includes("flex-direction: column;") || !rosterTableCss.includes("width: 100%;")) {
	throw new Error("Employee roster table must stack its scroll area above the pagination bar and fill the available width.");
}

for (const marker of [
	"在职信息",
	"个人信息",
	"联系信息",
	"工资社保",
	"合同信息",
	"材料附件",
	"背景调查",
	"员工对比",
	"人事异动",
	"redirect_existing_employee_form_to_detail",
	"bind_employee_detail_route_redirect",
	"openEmployeeFormForEdit",
	"EMPLOYEE_FORM_EDIT_ACCESS_KEY",
	"is_new_employee_form_route",
	"/^new-employee(?:-|$)/",
	"frappe.set_route(\"employee-detail\", frm.doc.name)",
]) {
	mustInclude(employeeForm, marker, `Employee form is missing detail marker: ${marker}`);
}

if (personnel.is_hidden !== 1 || personnel.content !== "[]") {
	throw new Error("Personnel workspace must be retired instead of rendered as a home page.");
}

if (personnelSidebar.items.some((item) => item.type === "Link" && item.label === "主页")) {
	throw new Error("Personnel sidebar must not show a home link.");
}

if (!personnelSidebar.items.some((item) => item.type === "Link" && item.label === "员工花名册" && item.link_to === "Employee")) {
	throw new Error("Personnel sidebar must retain the employee-roster entry.");
}

const employeeCodeSelector = fs.readFileSync(employeeCodeSelectorPath, "utf8");
for (const marker of [
	"get_employee_by_business_code",
	"employee_code_display",
	"toggle_display(\"employee\", false)",
	"custom_employee_code",
	"employee_name",
	"已匹配员工：{0}",
]) {
	mustInclude(employeeCodeSelector, marker, `员工工号选择器缺少：${marker}`);
}

for (const [doctype, jsPath, jsonPath] of [
	["Employee Transfer", employeeTransferPath, employeeTransferJsonPath],
	["Employee Promotion", employeePromotionPath, employeePromotionJsonPath],
	["Employee Separation", employeeSeparationPath, employeeSeparationJsonPath],
]) {
	const source = fs.readFileSync(jsPath, "utf8");
	const json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
	const employeeCodeDisplayField = json.fields.find((field) => field.fieldname === "employee_code_display");
	const shouldBeReadOnly = doctype === "Employee Transfer";
	if (
		!employeeCodeDisplayField ||
		employeeCodeDisplayField.fieldtype !== "Data" ||
		Boolean(employeeCodeDisplayField.read_only) !== shouldBeReadOnly
	) {
		throw new Error(`${doctype} 的员工工号读写规则不符合业务入口约定。`);
	}
	mustInclude(source, "employee_business_code_selector.js", `${doctype} 必须接入统一员工工号选择器。`);
	mustInclude(source, "employee_code_display", `${doctype} 必须由公司工号选择员工。`);
}

if (!fs.existsSync(employeeDetailJsonPath) || !fs.existsSync(employeeDetailJsPath)) {
	throw new Error("员工档案详情页 must be an independent Frappe Page.");
}

const employeeDetailJson = JSON.parse(fs.readFileSync(employeeDetailJsonPath, "utf8"));
const employeeDetailJs = fs.readFileSync(employeeDetailJsPath, "utf8");

if (employeeDetailJson.name !== "employee-detail" || employeeDetailJson.title !== "员工档案详情") {
	throw new Error("员工档案详情 Page route/title is incorrect.");
}

for (const marker of [
	'department_display = _department_display_name(doc.get("department"))',
	'"department_display": department_display',
	"_get_employee_detail_sections(doc, department_display)",
	'field["fieldname"] == "department" and department_display',
	"def _display_employee_field_value(fieldname, value)",
]) {
	mustInclude(employeeApi, marker, `员工档案详情必须使用部门业务名称，而非 Department 内部名称：${marker}`);
}

for (const marker of ["get_department_display(header)", "header.department_display || header.department"]) {
	mustInclude(employeeDetailJs, marker, `员工档案详情前端必须优先显示 department_display：${marker}`);
}

for (const marker of ["header.employee_name", '`${__("工号")}：${header.custom_employee_code}`']) {
	mustInclude(employeeDetailJs, marker, `员工档案详情必须仅使用姓名和公司工号作为可见身份：${marker}`);
}

if (employeeDetailJs.includes("header.employee_name || header.name")) {
	throw new Error("Employee detail must not fall back to Frappe internal Employee.name for visible identity.");
}

for (const marker of [
	"frappe.pages[\"employee-detail\"]",
	"on_page_show",
	"refresh_from_route",
	"load_request_id",
	"loading_employee",
	"Promise.all([detail_request, navigation_request])",
	"is_current_request(request_id, employee)",
	"get_employee_detail",
	"get_employee_detail_navigation",
	"ensure_personnel_pages",
	"related_records",
	"_get_employee_related_records",
	"_get_employee_flat_related_item",
	"custom_education_category",
	"custom_study_mode",
	"custom_education_level",
	"custom_graduation_school",
	"custom_major",
	"custom_contract_no",
	"custom_social_insurance",
	"员工头像",
	"概览",
	"在职信息",
	"个人信息",
	"联系信息",
	"工资社保",
	"合同信息",
	"材料附件",
	"背景调查",
	"上一个员工",
	"下一个员工",
	"人事异动",
	"转正",
	"离职",
	"合同记录",
	"办理人事异动",
	"编辑资料",
	"can_edit_employee_detail",
	"data-action=\"edit-employee\"",
	"frappe.set_route(\"Form\", \"Employee\", this.employee)",
	"添加更多员工档案字段",
	"hrms-employee-detail-info-grid",
	"hrms-employee-detail-growth-timeline",
	"hrms-employee-detail-side-panel",
	"hrms-employee-detail-shell",
	"hrms-employee-detail-profile-card",
	"hrms-employee-detail-action-strip",
	"hrms-employee-detail-kpi-grid",
	"hrms-employee-detail-section-card",
	"hrms-employee-detail-field-value",
	"hrms-employee-detail-collapse-row",
	"hrms-employee-detail-related-detail",
	"toggle_related_block",
	"查看更多",
	"新增记录",
	"row.compact",
	"暂未录入薪资社保数据",
	"hrms-employee-detail-sticky-tabs",
	"body.hrms-employee-detail-view",
]) {
	mustInclude(employeeDetailJs + employeeApi, marker, `Employee detail page is missing: ${marker}`);
}

for (const forbiddenMarker of ["data-edit-section", "frappe.prompt(", "quick_update_employee_roster"]) {
	if (employeeDetailJs.includes(forbiddenMarker)) {
		throw new Error(`Employee detail page must be read-only and route edits through personnel actions, but found: ${forbiddenMarker}`);
	}
}

if (!employeeDetailJs.includes("Administrator") || !employeeDetailJs.includes("System Manager")) {
	throw new Error("Employee detail edit action must be restricted to Administrator/System Manager.");
}

console.log("Personnel roster uses real Frappe Employee routes and custom interactive assets.");
