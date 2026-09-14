const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const api = read("hrms/api/data_statistics.py");
const page = read("hrms/hr/page/hrms_data_statistics/hrms_data_statistics.js");
const pageCss = read("hrms/hr/page/hrms_data_statistics/hrms_data_statistics.css");
const pageJson = JSON.parse(read("hrms/hr/page/hrms_data_statistics/hrms_data_statistics.json"));
const topNav = read("hrms/public/js/hrms_top_nav.js");
const sidebar = read("hrms/public/js/hrms_home_redirect_v6.js");
const hooks = read("hrms/hooks.py");

assert.deepStrictEqual(pageJson.roles.map((row) => row.role), ["System Manager"]);
assert(api.includes('def get_hrms_data_statistics(month: str | None = None, company: str = ""):'));
for (const marker of ["DATA_STATISTICS_GROUPS", "DATA_CLEANUP_MODULES", '"last_modified_at"', '"latest_record_name"', '"is_single"', '"created_by"', '"modified_by"', '"approved_by"', '"monthly_update_count"', "traceability_basis", "get_hrms_operator_statistics", "get_hrms_operator_activity", "_within_statistics_month", "_creation_events", "_collapse_import_sessions", "IMPORT_SESSION_GAP", "IMPORT_MODIFICATION_THRESHOLD", "imported_record_count", "active_day_count", "daily_average", '"forms"', '"scope"', "全部操作人员", "_workflow_rows", "_version_operation", '"operation_groups"', '"operation_type"', '"record_title"', '"changes"', '"record_exists"', "导入记录", "修改记录", "提交记录", "审批记录", "Version 修改日志", "已完成审批"]) {
	assert(api.includes(marker), `Missing statistics backend marker: ${marker}`);
}
for (const marker of ["按表单分类", "按人员分类", "人员操作汇总", "表单操作审计", "表单名称", "导入批次", "导入数据量", "导入记录", "修改记录", "操作总数", "活跃天数", "日均频率", "复核提示", "待复核", "单日高频", "修改次数偏高", "历史操作记录", "记录类型", "查看详情", "收起详情", "变更字段", "修改前", "修改后", "打开当前完整记录", "打开导入批次", "返回表单列表", "data-open-form-audit", "data-open-record", "data-open-person-form", "data-operation-type", "data-activity-filter", "data-toggle-event", "data-event-detail", "data-statistics-view", "更新记录数", "data-statistics-month", "data-statistics-search", "operator-matrix", "matrix-actions"]) {
	assert(page.includes(marker), `Missing statistics page marker: ${marker}`);
}
assert(page.includes("hrms.api.data_statistics.get_hrms_operator_statistics"));
assert(page.includes("hrms.api.data_statistics.get_hrms_operator_activity"));
assert(page.includes('class="table hrms-data-statistics__activity-table"'));
assert(!page.includes("data-open-table"));
assert(page.includes('frappe.set_route("Form", button.dataset.openRecord, button.dataset.recordName)'));
assert(page.includes("frappe.route_options = {}"));
assert(page.includes('addClass("hrms-data-statistics-wide-layout")'));
assert(page.includes('classList.toggle("hrms-data-statistics-page", enabled)'));
assert(page.includes('frappe.pages["hrms-data-statistics"].on_page_hide'));
assert(pageCss.includes(".hrms-data-statistics__activity-filters"));
assert(pageCss.includes(".hrms-data-statistics__activity-table"));
assert(pageCss.includes(".hrms-data-statistics__operator-matrix"));
assert(pageCss.includes(".hrms-data-statistics__review-signal"));
assert(pageCss.includes(".hrms-data-statistics__matrix-actions"));
assert(page.includes("month: state.month || undefined"));
assert(!pageCss.includes(".hrms-data-statistics__operation-nav"));
assert(!pageCss.includes(".hrms-data-statistics__form-chips"));
assert(!page.includes('class="hrms-data-statistics__hero"'));
const moreItemsMatch = topNav.match(/const\s+moreItems\s*=\s*\[([\s\S]*?)\];/);
assert(moreItemsMatch && moreItemsMatch[1].includes('label: "数据统计"'));
assert(moreItemsMatch[1].includes('route: "/desk/hrms-data-statistics"'));
assert(moreItemsMatch[1].includes("roles: SYSTEM_ADMIN_ROLES"));
assert(!topNav.includes('{ label: "数据统计", action: "data-statistics", roles: SYSTEM_ADMIN_ROLES }'));
assert(!topNav.includes('action === "data-statistics"'));
assert(sidebar.includes('label: "更多服务"'));
assert(sidebar.includes('{ type: "link", label: "数据统计", route: "/desk/hrms-data-statistics", slug: "hrms-data-statistics" }'));
const dataStatisticsSidebar = sidebar.match(/label: "更多服务"[\s\S]*?\n\t\t},/);
assert(dataStatisticsSidebar && !dataStatisticsSidebar[0].includes('label: "系统管理"'));
assert(hooks.includes("20260914-data-statistics-clean-sidebar-v4"));

console.log("HRMS data statistics page and top More-menu entry verified.");
