const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const api = read("hrms/api/employee_field_template.py");
const page = read("hrms/hr/page/hrms_model_center/hrms_model_center.js");
const pageJson = JSON.parse(read("hrms/hr/page/hrms_model_center/hrms_model_center.json"));
const sidebar = read("hrms/public/js/hrms_home_redirect_v6.js");

assert.deepStrictEqual(pageJson.roles.map((row) => row.role), ["System Manager"]);
assert(api.includes("def get_hrms_model_governance_catalog():"));
assert(api.includes('"framework_model_count": frappe.db.count("DocType")'));

for (const category of ["核心业务模型", "无代码业务配置", "系统内部记录"]) {
	assert(api.includes(`"category": "${category}"`), `Missing model category: ${category}`);
	assert(page.includes(category), `Missing category filter: ${category}`);
}

for (const doctype of [
	"Employee",
	"Department",
	"Attendance",
	"Salary Slip",
	"HRMS Employee Field Template",
	"HRMS Form Approval Matrix",
	"HRMS Attendance Custom Rule",
	"HRMS Payroll Rule",
	"HRMS Data Cleanup Log",
	"HRMS Form Import Row",
]) {
	assert(api.includes(`"doctype": "${doctype}"`) || (doctype === "HRMS Employee Field Template" && api.includes('"doctype": TEMPLATE_DOCTYPE')), `Missing governed model: ${doctype}`);
}

for (const marker of [
	"不需要了解全部单据类型",
	"项目中用在哪里",
	"应该怎样修改",
	"查看底层结构（高级）",
	"完整底层模型注册表（高级）",
	"套件明细",
	"frappe.confirm",
]) {
	assert(page.includes(marker), `Missing model guide marker: ${marker}`);
}

assert(sidebar.includes('label: "基础模型管理"'));
assert(sidebar.includes('label: "全部底层模型（谨慎）"'));

console.log("Project-focused model governance center verified.");
