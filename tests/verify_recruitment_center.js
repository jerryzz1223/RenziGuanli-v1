const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pageRoot = path.join(root, "hrms", "hr", "page", "recruitment_center");

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

for (const filename of ["recruitment_center.json", "recruitment_center.js", "recruitment_center.py", "recruitment_center.css"]) {
	assert(fs.existsSync(path.join(pageRoot, filename)), `招聘中心缺少文件: ${filename}`);
}

const page = JSON.parse(fs.readFileSync(path.join(pageRoot, "recruitment_center.json"), "utf8"));
const script = fs.readFileSync(path.join(pageRoot, "recruitment_center.js"), "utf8");
const api = fs.readFileSync(path.join(pageRoot, "recruitment_center.py"), "utf8");
const topNav = fs.readFileSync(path.join(root, "hrms", "public", "js", "hrms_top_nav.js"), "utf8");
const shellNav = fs.readFileSync(path.join(root, "hrms", "public", "js", "hrms_home_redirect_v6.js"), "utf8");
const pageRegistry = fs.readFileSync(path.join(root, "hrms", "api", "employee_field_template.py"), "utf8");
const setup = fs.readFileSync(path.join(root, "hrms", "setup.py"), "utf8");

assert(page.name === "recruitment-center" && page.title === "招聘中心", "招聘中心 Page 元数据不正确。");
for (const marker of ["Job Requisition", "Job Opening", "Job Applicant", "Interview", "Job Offer", "Employee Onboarding"]) {
	assert(script.includes(marker), `招聘中心前端未覆盖流程单据: ${marker}`);
	assert(api.includes(marker), `招聘中心数据接口未覆盖流程单据: ${marker}`);
}
assert(api.includes("frappe.has_permission"), "招聘中心数据接口必须按当前用户权限读取。");
assert(!api.includes("ignore_permissions"), "招聘中心读取不得绕过单据权限。");
assert(api.includes("frappe.get_list"), "招聘中心读取必须走带权限的列表查询。");
assert(api.includes('{"COUNT": "name", "as": "total"}'), "聚合字段必须使用当前 Frappe 支持的字典语法。");
assert(!api.includes("count(name)"), "聚合字段不得使用已禁用的字符串 SQL 函数语法。");
assert(topNav.includes('route: "/desk/recruitment-center"'), "顶部招聘入口必须进入招聘中心。");
assert(shellNav.includes('route: "/desk/recruitment-center"'), "侧栏招聘入口必须进入招聘中心。");
assert(pageRegistry.includes('"name": "recruitment-center"'), "迁移页面注册表必须包含招聘中心。");
assert(setup.includes("ensure_personnel_pages()"), "迁移完成后必须注册招聘中心 Page。 ");

console.log("Recruitment center contract is valid.");
