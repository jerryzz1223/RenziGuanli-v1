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
const separationJs = read("hrms", "hr", "doctype", "employee_separation", "employee_separation.js");
const separationPy = read("hrms", "hr", "doctype", "employee_separation", "employee_separation.py");
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
const employeeDetail = read("hrms", "hr", "page", "employee_detail", "employee_detail.js");
const personnel = JSON.parse(read("hrms", "hr", "workspace", "personnel", "personnel.json"));
const personnelSidebar = JSON.parse(read("hrms", "workspace_sidebar", "personnel.json"));
const redirect = read("hrms", "public", "js", "hrms_home_redirect_v6.js");
const topNav = read("hrms", "public", "js", "hrms_top_nav.js");

const field = (fieldname) => separationJson.fields.find((item) => item.fieldname === fieldname);

assert(separationJson.quick_entry === 0, "离职申请必须进入完整表单，不能在快速录入中暴露内部 Employee 编号。");
assert(field("employee")?.hidden === 1, "内部 Employee Link 必须隐藏。" );
assert(field("employee_code_display")?.reqd === 1, "离职单必须以公司工号作为必填业务身份。" );
assert(field("employee_code_display")?.in_list_view === 1, "离职管理列表必须展示公司工号。" );

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
	["boarding_begins_on", "离职日期"],
	["designation", "岗位"],
	["exit_interview", "离职面谈"],
]) {
	assert(field(fieldname)?.label === label, `离职字段中文标签错误: ${fieldname}`);
}

for (const marker of [
	"employee_business_code_selector.js",
	"employee_code_display",
	"employee_name",
	'.find(".form-footer, .new-timeline")',
	'.css("display", "none")',
	".form-sidebar .form-name-container",
	'$(this).attr("data-copy")',
	'frappe.set_route("employee-detail", frm.doc.employee)',
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
	'self.db_set("boarding_status", "Completed")',
]) {
	assert(separationPy.includes(marker), `离职后端缺少业务身份或完成状态同步: ${marker}`);
}
assert(!separationPy.includes("super().on_submit()"), "提交离职单不能创建项目、任务和活动。" );
assert(!separationPy.includes("create_task_and_notify_user"), "离职单不能创建旧活动任务。" );
assert(separationList.includes("hide_name_column: true"), "离职管理列表必须隐藏内部单据编号列。" );

assert(recordsJson.name === "employee-separation-records", "离职记录 Page 路由不正确。" );
assert(recordsJson.title === "离职记录", "离职记录 Page 标题不正确。" );
for (const marker of [
	"frappe.has_permission",
	"_get_departed_employees",
	"_get_submitted_separation_employee_names",
	"_get_employees_by_names",
	"_get_latest_separations",
	"custom_employee_code",
	"relieving_date",
	"departure_date",
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
	recordsPy.indexOf("_get_departed_employees(company)") <
		recordsPy.indexOf("_get_submitted_separation_employee_names(company)"),
	"离职记录必须以 Employee 离职状态为主，再用已提交离职单补偿同步延迟。",
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
	"离职日期",
	"员工姓名",
	"工号",
	"岗位",
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

for (const marker of ["employee_code_display", "employee_name", 'frappe.new_doc("Employee Separation"']) {
	assert(employeeDetail.includes(marker), `员工档案发起离职时缺少业务身份字段: ${marker}`);
}

for (const collection of [personnel.links, personnelSidebar.items]) {
	assert(
		collection.some(
			(item) =>
				item.type === "Link" &&
				item.label === "离职记录" &&
				item.link_to === "employee-separation-records" &&
				item.link_type === "Page",
		),
		"人事导航必须提供独立离职记录入口。",
	);
}
assert(redirect.includes("employee-separation-records"), "左侧模块路由必须识别离职记录。" );
assert(topNav.includes("employee-separation-records"), "顶部模块路由必须识别离职记录。" );

console.log("Employee separation business identity and records contract passed.");
