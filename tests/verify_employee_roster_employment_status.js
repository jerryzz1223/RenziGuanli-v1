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
	["在职 · 正式", "employment_type: Full-time"],
	["在职 · 试用期", "employment_type: Full-time"],
	["退休返聘", "employment_type: Retainer"],
	["待离职", "status: Inactive"],
	["离职", "status: Left"],
];

const normalisedList = list.replaceAll('"', "");
const allCardExpression = /label: 全部[\s\S]{0,120}status: \[!=, Left\]/;
if (!allCardExpression.test(normalisedList)) {
	throw new Error("“全部”花名册必须排除已离职员工。");
}

for (const [label, filters] of expectedCards) {
	const expression = new RegExp(`${label}[\\s\\S]{0,120}${filters}`);
	if (!expression.test(normalisedList)) throw new Error(`${label} 的工作性质筛选口径错误。`);
}

mustInclude(api, '"employment_type": "工作性质"', "花名册必须只返回工作性质字段。");
mustInclude(api, '"在职": "Full-time"', "导入“在职”必须映射到工作性质的底层全职值。");
mustInclude(api, 'if fieldname == "employment_type":', "导入必须专门处理工作性质列。");
mustInclude(api, '"custom_is_confirmed": "是"', "正式卡片必须由是否转正=是判断。");
mustInclude(list, 'custom_is_confirmed: ["!=", "是"]', "试用卡片必须涵盖未填写是否转正的员工。");
mustInclude(api, "EMPLOYEE_ROSTER_STATUS_CARDS", "花名册必须提供五类工作性质卡片。");
mustInclude(list, "format_roster_employment_type", "花名册必须显示工作性质的中文名称。");
mustInclude(list, "is_roster_probation_employee", "花名册必须在转正标记为空时按转正日期判断。");
mustInclude(list, "frappe.datetime.get_today()", "花名册必须以系统当天判断到期转正。");
mustInclude(list, "frappe.route_options", "花名册卡片必须使用 Frappe 路由筛选。");
mustInclude(list, "build_roster_route_options", "花名册卡片必须统一构建路由筛选条件。");
mustInclude(detail, "header.employment_type", "员工详情必须读取工作性质字段。");
mustInclude(detail, "is_probation_work_nature", "只有试用员工才能显示转正入口。");
mustInclude(detail, "header.final_confirmation_date", "员工详情必须在转正标记为空时读取转正日期。");
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
