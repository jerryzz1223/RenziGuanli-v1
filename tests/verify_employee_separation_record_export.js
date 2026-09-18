const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const recordsPy = read(
	"hrms",
	"hr",
	"page",
	"employee_separation_records",
	"employee_separation_records.py",
);
const recordsJs = read(
	"hrms",
	"hr",
	"page",
	"employee_separation_records",
	"employee_separation_records.js",
);

for (const marker of [
	"def export_separation_records(",
	"def _filter_records(",
	"def _build_filter_options(",
	"def _record_filter_date(",
	"def _normalize_filter_text(",
	"row.actual_departure_time, row.departure_date, row.planned_departure_date",
	"department_values = {",
	"department: str | None = None",
	"start_date: str | None = None",
	"end_date: str | None = None",
	"year: str | None = None",
	"month: str | None = None",
	"reason: str | None = None",
	"_export_columns()",
	'frappe.local.response.type = "binary"',
	'("离职面谈", "exit_interview")',
	'("审批确认详细原因", "approver_reason_detail")',
]) {
	if (!recordsPy.includes(marker)) throw new Error(`离职记录导出接口缺少：${marker}`);
}

for (const marker of [
	"data-filter-department",
	"data-filter-start-date",
	"data-filter-end-date",
	"data-filter-year",
	"data-filter-month",
	"data-filter-reason",
	"data-filter-apply",
	"data-export",
	"run_filters()",
	"read_filter_controls()",
	"export_records()",
	"this.search = this.wrapper.querySelector(\"[data-search]\").value.trim();",
	"start_date: this.filters.startDate",
	"window.open(`/api/method/hrms.hr.page.employee_separation_records.employee_separation_records.export_separation_records?",
]) {
	if (!recordsJs.includes(marker)) throw new Error(`离职记录页缺少筛选或导出控件：${marker}`);
}

console.log("Employee separation record filter/export contract passed.");
