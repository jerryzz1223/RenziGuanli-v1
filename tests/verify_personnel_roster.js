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

for (const marker of ["工作台", "人事", "组织", "招聘", "考勤假期", "薪酬", "审批", "培训学习", "绩效", "更多"]) {
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
	'"custom_personnel_status": "工作性质"',
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
	"在职",
	"退休返聘",
	"试用期",
	"待离职",
	"已离职",
	"添加员工",
	"导入",
	"导出",
	"设置花名册字段",
	"hide_unused_roster_toolbar_controls",
	"hrms-roster-toolbar-control-hidden",
	"open_roster_field_settings",
	"sessionStorage.setItem(\"hrms_settings_center_active_module\", \"字段管理中心\")",
	"sessionStorage.setItem(\"hrms_settings_center_focus\", \"roster_visible\")",
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
	"custom_employee_code || doc.employee_number || value",
	"apply_roster_meta_columns",
	"ROSTER_ALL_EMPLOYEES_PAGE_LENGTH",
	"page_length: ROSTER_ALL_EMPLOYEES_PAGE_LENGTH",
	"configure_roster_page_length",
	"hide_roster_page_length_controls",
	"hide_native_roster_field_filters",
	"enhance_roster_column_headers",
	"hrms-roster-column-filter-hotspot",
	"hrms-roster-column-filter-input",
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
mustInclude(topNavCss, ".hrms-roster-column-filter-hotspot", "Employee roster headers must expose a blank-space filter target.");
mustInclude(topNavCss, ".hrms-roster-column-filter-editor", "Employee roster headers must provide an inline suggestion editor.");

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
	"frappe.set_route(\"employee-detail\", frm.doc.name)",
]) {
	mustInclude(employeeForm, marker, `Employee form is missing detail marker: ${marker}`);
}

for (const label of ["员工管理", "员工关系"]) {
	if (!personnel.links.some((link) => link.type === "Card Break" && link.label === label)) {
		throw new Error(`Personnel workspace is missing card group: ${label}`);
	}
	if (!personnelSidebar.items.some((item) => item.type === "Section Break" && item.label === label)) {
		throw new Error(`Personnel sidebar is missing collapsible section: ${label}`);
	}
}

for (const [label, linkTo] of [
	["员工花名册", "Employee"],
	["入职管理", "Employee Onboarding"],
	["转正管理", "Employee Promotion"],
	["离职管理", "Employee Separation"],
	["离职记录", "employee-separation-records"],
	["异动记录", "employee-property-history"],
]) {
	if (!personnel.links.some((link) => link.type === "Link" && link.label === label && link.link_to === linkTo)) {
		throw new Error(`Personnel workspace must use real Frappe route for ${label} -> ${linkTo}`);
	}
	if (!personnelSidebar.items.some((item) => item.type === "Link" && item.label === label && item.link_to === linkTo)) {
		throw new Error(`Personnel sidebar must use real Frappe route for ${label} -> ${linkTo}`);
	}
}

const employeeCodeSelector = fs.readFileSync(employeeCodeSelectorPath, "utf8");
for (const marker of [
	"get_employee_by_business_code",
	"employee_code_display",
	"toggle_display(\"employee\", false)",
	"custom_employee_code",
	"employee_number",
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
	"记录说明",
	"办理入口",
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
