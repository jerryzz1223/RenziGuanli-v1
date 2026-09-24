const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "hrms", "api", "employee_field_template.py"), "utf8");
const page = fs.readFileSync(path.join(root, "hrms", "hr", "page", "employee_detail", "employee_detail.js"), "utf8");
const sidebar = fs.readFileSync(path.join(root, "hrms", "public", "js", "hrms_home_redirect_v6.js"), "utf8");

for (const marker of [
	"def _get_employee_training_history(doc)",
	'employee_code = str(doc.get("custom_employee_code")',
	"employee.employee_code = %(employee_code)s",
	"event.company = %(company)s",
	'"training_history": _get_employee_training_history(doc)',
	'"review_status": "已确认" if cint(row.result_docstatus) == 1 else "待复核"',
]) assert(api.includes(marker), `培训记录接口缺少：${marker}`);

for (const marker of [
	'"培训记录"',
	"render_training_summary_card",
	"render_training_history",
	"data-training-search",
	"data-training-type",
	"hrms-employee-training-table",
	"累计学时",
	"课时 / 学时",
	"待复核",
	"number.toFixed(3)",
	"actualDates && actualDates !== date",
]) assert(page.includes(marker), `员工详情培训记录缺少：${marker}`);

assert(sidebar.includes('{ label: "培训计划", route: "/desk/training-program", slug: "training-program" }'));
for (const removedItem of ["培训活动", "培训结果", "培训反馈", "员工技能"]) {
	assert(!sidebar.includes(`label: "${removedItem}"`), `培训侧栏不应继续显示${removedItem}`);
}

console.log("employee training history verified");
