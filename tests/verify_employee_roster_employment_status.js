const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "hrms", "api", "employee_field_template.py"), "utf8");
const list = fs.readFileSync(path.join(root, "hrms", "public", "js", "erpnext", "employee_list.js"), "utf8");
const hooks = fs.readFileSync(path.join(root, "hrms", "hooks.py"), "utf8");
const detail = fs.readFileSync(path.join(root, "hrms", "hr", "page", "employee_detail", "employee_detail.js"), "utf8");
const confirmationScheduler = fs.readFileSync(path.join(root, "hrms", "hr", "employee_confirmation_scheduler.py"), "utf8");

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}

const expectedCards = [
	["在职 · 正式", "custom_work_nature: 在职·正式"],
	["在职 · 试用期", "custom_work_nature: 在职·试用期"],
	["退休返聘", "custom_work_nature: 退休返聘"],
	["待离职", "custom_work_nature: 待离职"],
	["离职", "custom_work_nature: 离职"],
];

const normalisedList = list.replaceAll('"', "");
const allCardExpression = /label: 全部[\s\S]{0,120}custom_work_nature: \[!=, 离职\]/;
if (!allCardExpression.test(normalisedList)) {
	throw new Error("“全部”花名册必须排除已离职员工。");
}

for (const [label, filters] of expectedCards) {
	const expression = new RegExp(`${label}[\\s\\S]{0,120}${filters}`);
	if (!expression.test(normalisedList)) throw new Error(`${label} 的工作性质筛选口径错误。`);
}

mustInclude(api, '"custom_work_nature": "工作性质"', "花名册必须返回表单保存的工作性质字段。");
mustInclude(api, '"工作性质": "custom_work_nature"', "导入“工作性质”必须直接写入表单字段。");
mustInclude(api, '"custom_work_nature": "在职·正式"', "导入示例必须使用表单工作性质值。");
mustInclude(api, '_backfill_employee_work_nature()', "上线前必须为历史员工回填工作性质。");
mustInclude(api, "EMPLOYEE_ROSTER_STATUS_CARDS", "花名册必须提供五类工作性质卡片。");
mustInclude(list, "format_roster_work_nature", "花名册必须显示表单保存的工作性质。");
mustInclude(list, "custom_work_nature", "花名册必须按工作性质字段筛选。");
mustInclude(list, "Frappe begins its native ListView refresh", "工作性质卡片的数据请求必须避开原生列表的切换时序。");
mustInclude(list, "frappe.route_options", "花名册卡片必须使用 Frappe 路由筛选。");
mustInclude(list, "build_roster_route_options", "花名册卡片必须统一构建路由筛选条件。");
mustInclude(detail, "header.custom_work_nature", "员工详情必须读取工作性质字段。");
mustInclude(detail, "is_probation_work_nature", "只有试用员工才能显示转正入口。");
mustInclude(detail, 'header.custom_work_nature === "在职·试用期"', "员工详情必须以保存的工作性质判断试用期。");
mustInclude(confirmationScheduler, "process_due_employee_confirmations", "系统必须定时检查到期转正员工。");
mustInclude(confirmationScheduler, '["否", ""]', "自动转正必须覆盖未填写是否转正但已到期的员工。");
mustInclude(confirmationScheduler, "Employee Promotion", "自动转正必须生成标准转正单据。");
mustInclude(api, '"title": "自动转正"', "自动转正必须显示在成长记录中。");
mustInclude(hooks, "process_due_employee_confirmations", "定时任务必须执行自动转正。");

for (const source of [list, detail, hooks]) {
	if (source.includes("人员状态") || source.includes("custom_personnel_status")) {
		throw new Error("员工花名册公开口径不应保留人员状态字段或文案。");
	}
}

console.log("employee roster work-nature semantics verified");
