const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

const pageJson = JSON.parse(
	read("hrms", "hr", "page", "employee_separation_interview", "employee_separation_interview.json"),
);
const pageJs = read(
	"hrms", "hr", "page", "employee_separation_interview", "employee_separation_interview.js",
);
const pagePy = read(
	"hrms", "hr", "page", "employee_separation_interview", "employee_separation_interview.py",
);
const separationJson = JSON.parse(
	read("hrms", "hr", "doctype", "employee_separation", "employee_separation.json"),
);
const recordsPy = read(
	"hrms", "hr", "page", "employee_separation_records", "employee_separation_records.py",
);
const sidebar = JSON.parse(read("hrms", "workspace_sidebar", "personnel.json"));
const homeRedirect = read("hrms", "public", "js", "hrms_home_redirect_v6.js");

assert(pageJson.name === "employee-separation-interview", "离职面谈页面路由不正确。");
assert(pageJson.title === "离职面谈", "离职面谈页面标题不正确。");
for (const marker of [
	"get_employee_separation_interviews",
	'filters = {"docstatus": 1, "boarding_status": "Completed"}',
	"save_employee_separation_interview",
	'require_hrms_capability("separation_approve"',
	'separation.check_permission("write")',
	'只有离职审批通过后才能填写离职面谈',
	'db_set("exit_interview"',
]) {
	assert(pagePy.includes(marker), `离职面谈后端缺少审批后权限或保存链路: ${marker}`);
}
for (const marker of [
	"employee-separation-interview",
	"已审批的离职申请",
	"填写离职面谈",
	"save_employee_separation_interview",
	"后续离职记录",
	"Text Editor",
]) {
	assert(pageJs.includes(marker), `离职面谈页面缺少录入或后续提示: ${marker}`);
}
assert(
	separationJson.fields.some((field) => field.fieldname === "exit_interview" && field.label === "离职面谈"),
	"离职单必须保留离职面谈字段作为流程数据载体。",
);
assert(
	read("hrms", "hr", "doctype", "employee_separation", "employee_separation.js").includes('"exit_interview"'),
	"离职申请表单不应在审批前直接填写离职面谈。",
);
assert(recordsPy.includes('"exit_interview": separation.get("exit_interview")'), "离职记录必须读取离职面谈字段。");
assert(homeRedirect.includes('route: "/desk/employee-separation-interview"'), "人事导航必须使用新的离职面谈页面路由。");
assert(!homeRedirect.includes('route: "/desk/exit-interview"'), "旧的独立离职面谈入口必须从人事导航移除。");
const leaveIndex = sidebar.items.findIndex((item) => item.type === "Section Break" && item.label === "离职管理");
const leaveItems = sidebar.items.slice(leaveIndex + 1, sidebar.items.findIndex((item, index) => index > leaveIndex && item.type === "Section Break"));
assert(leaveItems[2]?.link_to === "employee-separation-interview", "侧栏必须在审批之后提供离职面谈入口。");

console.log("Employee separation interview page and downstream record contract passed.");
