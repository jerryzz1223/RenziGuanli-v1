const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const api = read("hrms/api/employee_field_template.py");
const accessPage = read("hrms/hr/page/hrms_access_center/hrms_access_center.js");
const developerPage = read("hrms/hr/page/hrms_developer_center/hrms_developer_center.js");
const modelPage = read("hrms/hr/page/hrms_model_center/hrms_model_center.js");
const sidebarShell = read("hrms/public/js/hrms_home_redirect_v6.js");

for (const marker of [
	"账户与角色分配",
	"角色操作权限",
	"用户数据范围",
	"实际有效权限",
	"全部已创建账户",
	"仅显示本项目相关角色",
	"配置业务权限",
	"测试账户的实际有效权限",
	"test_hrms_effective_permission",
	"data-action=\"test-user\"",
]) {
	assert(accessPage.includes(marker), `Account-first access center contract missing: ${marker}`);
}

for (const marker of [
	"def test_hrms_effective_permission(",
	"frappe.has_permission(doctype, permission_type, doc=doc, user=user)",
	'filters={"user": user}',
	'for permission_doctype in ("DocPerm", "Custom DocPerm")',
	'"administrator_assigned"',
	'"is_project_used"',
]) {
	assert(api.includes(marker), `Effective permission backend contract missing: ${marker}`);
}

for (const marker of [
	"get_hrms_developer_configuration_map",
	"字段字典与引用范围",
	"打开生效位置",
	"如何验证",
	"仍然需要代码和迁移",
	'frappe.set_route("List", this.dataset.dictionary)',
]) {
	assert(developerPage.includes(marker), `Developer configuration map contract missing: ${marker}`);
}

for (const marker of [
	'label: "账户与权限"',
	'label: "账户与权限总览"',
	'label: "用户数据范围"',
	'label: "角色权限配置"',
	'label: "安全审计"',
	'label: "开发与配置"',
	'label: "开发与配置总览"',
	'label: "基础模型管理"',
	'label: "全部底层模型（谨慎）"',
	'label: "业务配置"',
	'label: "结构与页面（高级）"',
	'label: "运行与发布"',
	'"Core": "系统管理"',
	'"Frappe Framework": "人资管理系统"',
	'"Employee Self Service": "员工自助"',
	'"System User": "系统用户"',
]) {
	assert(sidebarShell.includes(marker), `Contextual Chinese sidebar contract missing: ${marker}`);
}

for (const marker of [
	"get_hrms_model_governance_catalog",
	"不需要了解全部单据类型",
	"核心业务模型",
	"无代码业务配置",
	"系统内部记录",
	"项目中用在哪里",
	"应该怎样修改",
	"查看底层结构（高级）",
	"谨慎查看全部底层模型",
	"套件明细",
]) {
	assert(modelPage.includes(marker) || api.includes(marker), `Model governance contract missing: ${marker}`);
}

assert(api.includes('"doctype": TEMPLATE_DOCTYPE'), "Configuration map missing the employee field template");
for (const doctype of [
	"Workflow",
	"HRMS Form Approval Matrix",
	"HRMS Attendance Custom Rule",
	"HRMS Payroll Rule",
	"HRMS Payroll Field Mapping",
	"HRMS DingTalk Settings",
]) {
	assert(api.includes(`"doctype": "${doctype}"`), `Configuration map missing ${doctype}`);
}

console.log("Account-first permissions, real permission testing, and business configuration map verified.");
