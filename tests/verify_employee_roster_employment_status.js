const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "hrms", "api", "employee_field_template.py"), "utf8");
const list = fs.readFileSync(path.join(root, "hrms", "public", "js", "erpnext", "employee_list.js"), "utf8");
const statusSync = fs.readFileSync(path.join(root, "hrms", "hr", "employee_personnel_status.py"), "utf8");
const hooks = fs.readFileSync(path.join(root, "hrms", "hooks.py"), "utf8");
const detail = fs.readFileSync(path.join(root, "hrms", "hr", "page", "employee_detail", "employee_detail.js"), "utf8");

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}

// 原生 employment_type 保留给薪资和合同；花名册使用自动派生的五种人员状态。
const expectedCards = [
	["在职 · 正式", "custom_personnel_status: 在职"],
	["在职 · 试用期", "custom_personnel_status: 试用期"],
	["退休返聘", "custom_personnel_status: 退休返聘"],
	["待离职", "custom_personnel_status: 待离职"],
	["离职", "custom_personnel_status: 已离职"],
];

const normalisedList = list.replaceAll('"', "");
for (const [label, filters] of expectedCards) {
	const expression = new RegExp(`${label}[\\s\\S]{0,160}${filters}`);
	if (!expression.test(normalisedList)) throw new Error(`${label} 的花名册统计口径错误。`);
}

mustInclude(api, '"custom_personnel_status",', "花名册 API 必须返回并允许筛选人员状态。");
mustInclude(api, '"field_label": "工作性质"', "字段中心必须提供业务工作性质字段。");
mustInclude(api, '"在职\\n试用期\\n退休返聘\\n待离职\\n已离职"', "工作性质选项必须固定为五种业务状态。");
mustInclude(api, "_normalise_probation_employment_type", "导入工作性质为试用期时必须转为员工阶段，而非新建错误工作性质。");
mustInclude(statusSync, "def derive_personnel_status", "必须由后端统一派生人员状态。");
mustInclude(statusSync, "relieving_date > reference_date", "未来离职日期必须映射为待离职。");
mustInclude(statusSync, "sync_employee_separation_status", "离职单提交后必须同步 Employee。");
mustInclude(statusSync, "cancel_employee_separation_status", "离职单取消后必须重算 Employee。");
mustInclude(hooks, "sync_due_employee_personnel_statuses", "每日必须处理到期的待离职员工。");
mustInclude(list, "hrms_employee_personnel_status_updated", "花名册必须监听状态变更以刷新页面缓存。");
mustInclude(list, "custom_personnel_status(value)", "花名册必须显式格式化工作性质，不能退回圆点或空值。");
mustInclude(list, 'String(value || __("未设置"))', "未设置的工作性质必须显示可读文本。");
mustInclude(list, "frappe.route_options", "花名册卡片必须使用 Frappe 路由筛选，不能依赖 URL 查询参数刷新页面。");
mustInclude(list, "build_roster_route_options", "花名册卡片必须统一构建 Frappe 路由筛选条件。");
mustInclude(list, '"relieving_date"', "花名册必须读取 Employee 的标准离职日期字段。");
mustInclude(list, "sync_roster_status_date_column", "待离职和已离职视图必须切换为离职日期列。");
mustInclude(list, "get_active_roster_card().personnel_status", "离职日期列应按内部状态判断，不依赖展示文案。");
mustInclude(detail, "header.custom_personnel_status", "员工详情必须读取统一的工作性质字段。");
mustInclude(detail, "this.detail?.header?.custom_is_confirmed", "转正单必须读取员工当前转正状态。");
mustInclude(detail, "this.detail?.header?.final_confirmation_date", "转正单必须读取员工当前转正日期。");
mustInclude(detail, 'personnel_status === "试用期"', "只有试用期员工才能显示转正入口。");

if (detail.includes("hrms-employee-detail-readonly-notice")) {
	throw new Error("员工详情不应保留重复的黄色人事异动提示行。");
}
if (detail.includes('render_kpi("状态"')) {
	throw new Error("员工详情不应展示与工作性质冲突的原生状态。");
}

if (list.includes("window.location.href = target")) {
	throw new Error("花名册卡片不应整页跳转，否则统计和列表容易不同步。");
}

console.log("employee roster employment/status semantics verified");
