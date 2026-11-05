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
assert(script.includes("hrms.api.interview_registration.preview_import"), "招聘中心必须预览原表导入。");
assert(script.includes("hrms.api.interview_registration.import_registrations"), "招聘中心必须提供导入。");
assert(!script.includes("show_overview"), "招聘中心不再展示旧招聘总览。");
assert(!script.includes("frappe.new_doc"), "招聘中心应以导入查阅为主。");
assert(topNav.includes('route: "/desk/recruitment-center"'), "顶部招聘入口必须进入招聘中心。");
assert(shellNav.includes('route: "/desk/recruitment-center"'), "侧栏招聘入口必须进入招聘中心。");
assert(pageRegistry.includes('"name": "recruitment-center"'), "迁移页面注册表必须包含招聘中心。");
assert(setup.includes("ensure_personnel_pages()"), "迁移完成后必须注册招聘中心 Page。 ");

console.log("Recruitment center contract is valid.");
