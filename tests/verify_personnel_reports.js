const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
	return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assertIncludes(content, needle, message) {
	if (!content.includes(needle)) {
		throw new Error(message || `Expected to find: ${needle}`);
	}
}

function assertFile(relativePath) {
	if (!fs.existsSync(path.join(root, relativePath))) {
		throw new Error(`Missing file: ${relativePath}`);
	}
}

assertFile("hrms/hr/page/personnel_reports/personnel_reports.js");
assertFile("hrms/hr/page/personnel_reports/personnel_reports.json");
assertFile("hrms/hr/doctype/hrms_employee_report/hrms_employee_report.json");

const api = read("hrms/api/employee_field_template.py");
assertIncludes(api, 'HRMS_EMPLOYEE_REPORT_DOCTYPE = "HRMS Employee Report"', "Missing report DocType constant");
assertIncludes(api, "DEFAULT_EMPLOYEE_REPORTS", "Missing default personnel report definitions");
assertIncludes(api, "def get_employee_report_center", "Missing report center API");
assertIncludes(api, "def save_employee_roster_report", "Missing save report API");
assertIncludes(api, "def download_employee_report", "Missing saved/default report download API");
assertIncludes(api, "def download_employee_roster_export(fields: str", "Export API must have typed fields argument");
assertIncludes(api, "def get_employee_export_records", "Missing export record readback API");
assertIncludes(api, "log_employee_export_record", "Missing export record logging helper");
assertIncludes(api, "export_scope", "Export API must support current-filter/all-employee scope");
assertIncludes(api, "current_filters", "Export API must support current roster filters");

const exportPage = read("hrms/hr/page/employee_roster_export/employee_roster_export.js");
assertIncludes(exportPage, "save_employee_roster_report", "Custom export page must save real report definitions");
assertIncludes(exportPage, "get_employee_export_records", "Custom export page must show export records");
assertIncludes(exportPage, "export_scope", "Custom export page must pass export scope");
assertIncludes(exportPage, "current_filters", "Custom export page must pass current filters");
assertIncludes(exportPage, "全部员工", "Custom export page must support exporting all employees");
assertIncludes(exportPage, "当前筛选结果", "Custom export page must support current-filter export");
assertIncludes(exportPage, "导出记录", "Custom export page must show export record history");
for (const marker of ["基础信息", "联系信息", "合同信息", "工资社保"]) {
	assertIncludes(exportPage + api, marker, `Multi-sheet export must include: ${marker}`);
}
if (exportPage.includes("下一阶段会把当前字段组合保存为可复用的人事报表")) {
	throw new Error("Custom export page still has placeholder save behavior");
}

const reportPage = read("hrms/hr/page/personnel_reports/personnel_reports.js");
assertIncludes(reportPage, "download_employee_report", "Report center must download through backend API");
assertIncludes(reportPage, "添加报表", "Report center must expose add report action");
assertIncludes(reportPage, "邮件订阅", "Report center must expose subscription action");
assertIncludes(reportPage, "编辑分组", "Report center must expose group edit action");
assertIncludes(reportPage, "data-report-popover", "Report center must render a real report action popover");
assertIncludes(reportPage, 'frappe.set_route("List", "HRMS Employee Report")', "Report sorting/group action must route to real report records");
assertIncludes(reportPage, "报表排序", "Report center must expose report sorting");

const sidebar = read("hrms/public/js/hrms_home_redirect_v6.js");
assertIncludes(sidebar, "personnel-reports", "Personnel sidebar must include personnel reports route");
assertIncludes(sidebar, "人事报表", "Personnel sidebar must include 人事报表 label");

const css = read("hrms/public/css/hrms_top_nav.css");
assertIncludes(css, ".hrms-report-center", "Missing report center styles");
assertIncludes(css, ".hrms-report-popover", "Missing report action popover styles");

console.log("personnel reports checks passed");
