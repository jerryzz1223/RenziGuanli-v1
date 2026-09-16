const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

const separationJson = JSON.parse(
	read("hrms", "hr", "doctype", "employee_separation", "employee_separation.json"),
);
const separationJs = read(
	"hrms",
	"hr",
	"doctype",
	"employee_separation",
	"employee_separation.js",
);
const separationPy = read(
	"hrms",
	"hr",
	"doctype",
	"employee_separation",
	"employee_separation.py",
);
const separationList = read(
	"hrms",
	"hr",
	"doctype",
	"employee_separation",
	"employee_separation_list.js",
);
const recordsJson = JSON.parse(
	read("hrms", "hr", "page", "employee_separation_records", "employee_separation_records.json"),
);
const recordsJs = read(
	"hrms",
	"hr",
	"page",
	"employee_separation_records",
	"employee_separation_records.js",
);
const recordsPy = read(
	"hrms",
	"hr",
	"page",
	"employee_separation_records",
	"employee_separation_records.py",
);
const applicationPage = JSON.parse(
	read("hrms", "hr", "page", "employee_separation_application", "employee_separation_application.json"),
);
const approvalPage = JSON.parse(
	read("hrms", "hr", "page", "employee_separation_approval", "employee_separation_approval.json"),
);
const applicationPageJs = read(
	"hrms", "hr", "page", "employee_separation_application", "employee_separation_application.js",
);
const approvalPageJs = read(
	"hrms", "hr", "page", "employee_separation_approval", "employee_separation_approval.js",
);
const employeeDetail = read("hrms", "hr", "page", "employee_detail", "employee_detail.js");
const employeeCodeApi = read("hrms", "api", "employee_field_template.py");
const employeeCodeSelector = read("hrms", "hr", "employee_business_code_selector.js");
const personnelSidebar = JSON.parse(read("hrms", "workspace_sidebar", "personnel.json"));
const redirect = read("hrms", "public", "js", "hrms_home_redirect_v6.js");
const topNav = read("hrms", "public", "js", "hrms_top_nav.js");

const field = (fieldname) => separationJson.fields.find((item) => item.fieldname === fieldname);

assert(
	separationJson.quick_entry === 0,
	"离职申请必须进入完整表单，不能在快速录入中暴露内部 Employee 编号。",
);
assert(field("employee")?.hidden === 1, "内部 Employee Link 必须隐藏。");
assert(field("employee_code_display")?.reqd === 1, "离职单必须以员工工号作为必填业务身份。");
assert(field("employee_code_display")?.in_list_view === 1, "离职管理列表必须展示员工工号。");
assert(field("company")?.hidden === 1, "离职单不应展示公司选择。");
assert(!field("company")?.reqd, "离职单不应要求选择公司。");

for (const fieldname of [
	"employee_separation_template",
	"project",
	"table_for_activity",
	"activities",
	"notify_users_by_email",
]) {
	assert(field(fieldname)?.hidden === 1, `离职业务页不应展示旧活动/项目字段: ${fieldname}`);
}

for (const [fieldname, label] of [
	["employee_name", "员工姓名"],
	["employee_code_display", "员工工号"],
	["boarding_begins_on", "拟离职日期"],
	["applied_on", "离职申请时间"],
	["applied_by", "申请操作人"],
	["approved_on", "离职审批时间"],
	["approved_by", "审批操作人"],
	["departed_on", "实际离职时间"],
	["departed_by", "实际离职操作人"],
	["designation", "岗位"],
	["exit_interview", "离职面谈"],
]) {
	assert(field(fieldname)?.label === label, `离职字段中文标签错误: ${fieldname}`);
}
for (const fieldname of ["applied_on", "approved_on", "departed_on"]) {
	assert(field(fieldname)?.fieldtype === "Datetime", `离职时间字段类型错误: ${fieldname}`);
	assert(field(fieldname)?.read_only === 1, `离职时间字段必须由系统自动记录: ${fieldname}`);
}
assert(field("boarding_begins_on")?.fieldtype === "Date", "实际离职日期必须是日期字段。");
assert(field("resignation_letter_date")?.hidden === 1, "旧离职申请日期字段只保留兼容数据，不应和申请时间重复展示。");

for (const marker of [
	"employee_business_code_selector.js",
	"employee_code_display",
	"employee_name",
	'"company",',
	'.find(".form-footer, .new-timeline")',
	'.css("display", "none")',
	".form-sidebar .form-name-container",
	'$(this).attr("data-copy")',
	'frappe.set_route("employee-detail", frm.doc.employee)',
	"frm.doc.docstatus === 1",
	'__("审批通过")',
	"approve_employee_separation",
]) {
	assert(separationJs.includes(marker), `离职表单缺少业务身份或精简页面逻辑: ${marker}`);
}
assert(!separationJs.includes("check_if_latest"), "离职提交不能调用已移除的 check_if_latest");
assert(!separationJs.includes("frm.savesubmit = function"), "离职表单应使用 Frappe 原生提交流程");
for (const forbidden of ["get_onboarding_details", '__("Project")', '__("Task")']) {
	assert(!separationJs.includes(forbidden), `离职表单不能继续使用旧项目活动逻辑: ${forbidden}`);
}

for (const marker of [
	"custom_employee_code",
	"_sync_employee_business_identity",
	"sync_employee_separation_business_identities",
	'frappe.db.set_value("Employee Separation"',
	'self.db_set("boarding_status", "Pending")',
	"def approve_employee_separation(",
	"separation._set_employee_pending_state()",
	"actual_departure_time = get_datetime(self.departed_on)",
	'work_nature = "离职" if is_departed else "待离职"',
	'employee.status = "Left" if is_departed else "Inactive"',
	"employee.relieving_date = getdate(actual_departure_time)",
	"def record_employee_separation_actual_time(",
	"def process_due_employee_separations():",
]) {
	assert(separationPy.includes(marker), `离职后端缺少业务身份或完成状态同步: ${marker}`);
}
assert(!separationPy.includes("super().on_submit()"), "提交离职单不能创建项目、任务和活动。");
assert(!separationPy.includes("create_task_and_notify_user"), "离职单不能创建旧活动任务。");
assert(separationList.includes('Pending: __("待审批")'), "未通过的离职单必须显示为待审批。");
assert(separationList.includes('Completed: __("审批通过")'), "已提交的离职单必须显示为审批通过。");
assert(separationList.includes("hide_name_column: true"), "离职管理列表必须隐藏内部单据编号列。");

assert(recordsJson.name === "employee-separation-records", "离职记录 Page 路由不正确。");
assert(recordsJson.title === "离职记录", "离职记录 Page 标题不正确。");
assert(applicationPage.name === "employee-separation-application", "离职申请必须使用独立页面路由。");
assert(approvalPage.name === "employee-separation-approval", "离职审批必须使用独立页面路由。");
assert(applicationPageJs.includes("on_page_show"), "离职申请兼容入口在缓存页面再次显示时也必须跳转。");
assert(approvalPageJs.includes("on_page_show"), "离职审批兼容入口在缓存页面再次显示时也必须跳转。");
assert(
	applicationPageJs.includes("/desk/employee-separation/view/list?docstatus=0"),
	"离职申请兼容入口必须跳转到可刷新的稳定列表地址。",
);
assert(
	approvalPageJs.includes("/desk/employee-separation/view/list?docstatus=1&boarding_status=Pending"),
	"离职审批兼容入口必须跳转到可刷新的稳定列表地址。",
);
for (const marker of [
	"frappe.has_permission",
	"_get_departed_employees",
	"_get_latest_separations",
	"custom_employee_code",
	"relieving_date",
	"departure_date",
	"application_time",
	"approval_time",
	"actual_departure_time",
	"application_operator",
	"approval_operator",
	"actual_departure_operator",
	"approver_reason_type",
	"approver_reason_display",
	"approver_reason_detail",
	"separation_name",
	"exit_interview",
	"department_display",
	"can_read_separations",
	"_meta_has_field",
	"_get_department_display_names",
	"Employee is the source of truth for departed staff",
]) {
	assert(recordsPy.includes(marker), `离职记录接口缺少员工主档或离职单合并逻辑: ${marker}`);
}
assert(
	!recordsPy.includes("from hrms.api.employee_field_template import _department_display_name"),
	"离职记录不应依赖字段中心的私有函数。",
);
assert(
	recordsPy.includes('return employee.get("status") == "Left"'),
	"离职记录只能展示员工状态已正式离职的员工，不能把待离职员工提前列入。",
);
for (const marker of [
	"company: str | None = None",
	"search: str | None = None",
	"start: int = 0",
	"page_length: int = 50",
	") -> dict:",
]) {
	assert(recordsPy.includes(marker), `离职记录 RPC 缺少 Frappe v17 必需的类型声明: ${marker}`);
}
for (const marker of [
	"拟离职日期",
	"离职申请时间",
	"离职审批时间",
	"实际离职时间",
	"员工姓名",
	"工号",
	"岗位",
	"员工自述原因",
	"审批确认原因",
	"流程操作记录",
	"离职面谈",
	"show_record_details",
	"row.separation_name",
	'frappe.set_route("Form", "Employee Separation", row.separation_name)',
	'frappe.set_route("employee-detail", row.employee)',
	"离职记录加载失败，请检查权限或刷新后重试。",
	"error_message(response)",
	"离职记录加载失败：{0}",
]) {
	assert(recordsJs.includes(marker), `离职记录页缺少表格或详情跳转逻辑: ${marker}`);
}

for (const marker of [
	"employee_code_display",
	"employee_name",
	'frappe.new_doc("Employee Separation"',
]) {
	assert(employeeDetail.includes(marker), `员工档案发起离职时缺少业务身份字段: ${marker}`);
}

const sidebarItems = personnelSidebar.items;
const leaveSectionIndex = sidebarItems.findIndex(
	(item) => item.type === "Section Break" && item.label === "离职管理",
);
assert(leaveSectionIndex >= 0, "人事导航必须提供独立的离职管理分组。");
const nextSectionIndex = sidebarItems.findIndex(
	(item, index) => index > leaveSectionIndex && item.type === "Section Break",
);
const leaveItems = sidebarItems.slice(
	leaveSectionIndex + 1,
	nextSectionIndex >= 0 ? nextSectionIndex : sidebarItems.length,
);
assert(
	JSON.stringify(leaveItems.map((item) => item.label)) ===
		JSON.stringify(["离职申请", "离职审批", "实际离职", "离职记录"]),
	"离职管理分组必须按申请、审批、实际离职、记录提供四个入口。",
);
const relationshipSectionIndex = sidebarItems.findIndex(
	(item) => item.type === "Section Break" && item.label === "员工关系",
);
assert(relationshipSectionIndex >= 0, "人事导航必须保留员工关系分组。");
const relationshipItems = sidebarItems.slice(
	relationshipSectionIndex + 1,
	leaveSectionIndex,
);
assert(
	!relationshipItems.some((item) => ["离职申请", "离职审批", "实际离职", "离职记录"].includes(item.label)),
	"离职申请、审批、实际离职和记录不能继续混在员工关系分组中。",
);
assert(
	leaveItems.find((item) => item.label === "实际离职")?.link_to === "employee-separation-effective",
	"实际离职入口必须指向独立的办理页面。",
);
assert(
		leaveItems.find((item) => item.label === "离职申请")?.url === "/desk/employee-separation/view/list?docstatus=0" &&
		leaveItems.find((item) => item.label === "离职申请")?.link_type === "URL",
	"离职申请入口必须指向可刷新并保留视图状态的列表地址。",
);
assert(
		leaveItems.find((item) => item.label === "离职审批")?.url === "/desk/employee-separation/view/list?docstatus=1&boarding_status=Pending" &&
		leaveItems.find((item) => item.label === "离职审批")?.link_type === "URL",
	"离职审批入口必须指向可刷新并保留视图状态的列表地址。",
);
assert(redirect.includes('/desk/employee-separation/view/list?docstatus=0'), "左侧离职申请入口必须使用稳定列表路由。");
assert(redirect.includes('/desk/employee-separation/view/list?docstatus=1&boarding_status=Pending'), "左侧离职审批入口必须使用稳定列表路由。");
assert(redirect.includes('current_path === "/desk/employee-separation/view/list"'), "刷新离职列表时必须从地址识别业务侧栏。");
assert(redirect.includes('"employee-separation-application"'), "人事模块必须识别离职申请视图。");
assert(redirect.includes('"employee-separation-approval"'), "人事模块必须识别离职审批视图。");
assert(redirect.includes("window.hrmsSeparationListView"), "离职列表必须保留入口视图状态。");
assert(separationList.includes("route_filters.get(\"docstatus\") === \"0\""), "离职列表必须用可刷新的草稿筛选识别申请视图。");
assert(employeeCodeApi.includes('filters = {"status": ["!=", "Left"]} if cint(include_pending) else {"status": "Active"}'), "离职工号查询必须允许匹配待离职员工并排除已离职员工。");
assert(employeeCodeApi.includes('custom_employee_code": employee_code'), "工号匹配必须使用公司工号字段。");
assert(employeeCodeSelector.includes('include_pending: frm.doctype === "Employee Separation" ? 1 : 0'), "离职表单必须启用待离职员工工号匹配。");
assert(redirect.includes("employee-separation-records"), "左侧模块路由必须识别离职记录。");
assert(topNav.includes("employee-separation-records"), "顶部模块路由必须识别离职记录。");

console.log("Employee separation business identity and records contract passed.");
