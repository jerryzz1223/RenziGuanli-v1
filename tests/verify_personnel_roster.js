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
const employeeArchiveJsonPath = path.join(root, "hrms", "hr", "page", "employee_archive", "employee_archive.json");
const employeeArchiveJsPath = path.join(root, "hrms", "hr", "page", "employee_archive", "employee_archive.js");
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
	"frappe.get_all(EMPLOYEE_DOCTYPE",
	"_build_employee_roster_filters",
]) {
	mustInclude(employeeApi, marker, `Employee roster API is missing phase-one behavior: ${marker}`);
}

for (const marker of [
	"姓名/手机号",
	"姓名、手机号、工号",
	"员工花名册",
	"在职",
	"全职",
	"实习生",
	"外包",
	"退休返聘",
	"试用期",
	"待离职",
	"正式",
	"已离职",
	"添加员工",
	"导入",
	"导出",
	"设置花名册字段",
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
]) {
	mustInclude(employeeList, marker, `Employee list view is missing roster behavior marker: ${marker}`);
}

if (employeeList.includes("listview.filter_area.add([[EMPLOYEE_DOCTYPE, fieldname, \"=\", filters[fieldname]]]")) {
	throw new Error("Roster cards must not append filters through the native filter panel.");
}

mustInclude(topNavCss, "body.hrms-employee-roster-view .filter-button", "Employee roster must hide the native filter button.");
mustInclude(topNavCss, ".hrms-roster-card.is-active", "Employee roster must show a single active status card.");

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
	"hrms.api.employee_field_template.ensure_personnel_pages",
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
	["员工档案库", "employee-archive"],
	["入职管理", "Employee Onboarding"],
	["转正管理", "Employee Promotion"],
	["离职管理", "Employee Separation"],
	["人事异动", "Employee Transfer"],
]) {
	if (!personnel.links.some((link) => link.type === "Link" && link.label === label && link.link_to === linkTo)) {
		throw new Error(`Personnel workspace must use real Frappe route for ${label} -> ${linkTo}`);
	}
	if (!personnelSidebar.items.some((item) => item.type === "Link" && item.label === label && item.link_to === linkTo)) {
		throw new Error(`Personnel sidebar must use real Frappe route for ${label} -> ${linkTo}`);
	}
}

if (!fs.existsSync(employeeArchiveJsonPath) || !fs.existsSync(employeeArchiveJsPath)) {
	throw new Error("员工档案库 must be an independent Frappe Page, not another Employee list alias.");
}

const employeeArchiveJson = JSON.parse(fs.readFileSync(employeeArchiveJsonPath, "utf8"));
const employeeArchiveJs = fs.readFileSync(employeeArchiveJsPath, "utf8");

if (employeeArchiveJson.name !== "employee-archive" || employeeArchiveJson.title !== "员工档案库") {
	throw new Error("员工档案库 Page route/title is incorrect.");
}

for (const marker of [
	"frappe.pages[\"employee-archive\"]",
	"frappe.ui.make_app_page",
	"hrms.api.employee_field_template.get_employee_roster",
	"hrms.api.employee_field_template.get_employee_roster_summary",
	"Employee",
	"员工档案库",
	"姓名/手机号",
	"姓名、手机号、工号",
	"员工姓名",
	"姓名",
	"工号",
	"部门",
	"岗位",
	"工作性质",
	"入职日期",
	"证件类型",
	"证件号码",
	"手机号码",
	"操作",
	"设置花名册字段",
	"frappe.set_route(\"employee-detail\"",
	"当前没有真实员工档案",
]) {
	mustInclude(employeeArchiveJs, marker, `员工档案库 Page is missing real-data behavior marker: ${marker}`);
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
	"frappe.pages[\"employee-detail\"]",
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
	"修改部门、岗位、职务、职级等信息建议通过人事异动完成",
	"添加更多员工档案字段",
	"hrms-employee-detail-readonly-notice",
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
