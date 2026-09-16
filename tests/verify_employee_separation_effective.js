const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const effectivePy = read("hrms", "hr", "page", "employee_separation_effective", "employee_separation_effective.py");
const effectiveJs = read("hrms", "hr", "page", "employee_separation_effective", "employee_separation_effective.js");
const separationPy = read("hrms", "hr", "doctype", "employee_separation", "employee_separation.py");
const separationJs = read("hrms", "hr", "doctype", "employee_separation", "employee_separation.js");
const sidebar = JSON.parse(read("hrms", "workspace_sidebar", "personnel.json"));

for (const marker of [
	"get_pending_employee_separations",
	'filters = {"docstatus": 1, "boarding_status": "Completed"}',
	'if not employee or employee.status == "Left":',
	"if separation.departed_on:",
	"actual_departure_time",
	'"status": "待离职"',
]) {
	if (!effectivePy.includes(marker)) throw new Error(`实际离职接口缺少状态链：${marker}`);
}

if (!separationPy.includes("def record_employee_separation_actual_time(")) {
	throw new Error("实际离职接口缺少唯一时间保存动作。");
}

for (const marker of [
	"唯一实际离职时间",
	"datetime-local",
	"save_actual_time",
	"record_employee_separation_actual_time",
	"保存并办理",
]) {
	if (!effectiveJs.includes(marker)) throw new Error(`实际离职页面缺少填写或保存动作：${marker}`);
}

for (const marker of [
	"_set_employee_pending_state",
	"actual_departure_time = get_datetime(self.departed_on)",
	"is_departed = bool(actual_departure_time and actual_departure_time <= _current_system_datetime())",
	"employee.relieving_date = getdate(actual_departure_time)",
	"def record_employee_separation_actual_time(",
	'"departed_on": ["is", "set"]',
]) {
	if (!separationPy.includes(marker)) throw new Error(`实际离职唯一时间未接入后端：${marker}`);
}

if (!separationJs.includes("实际离职”功能中填写唯一实际离职时间")) {
	throw new Error("审批通过后的表单必须引导到实际离职功能填写时间。");
}

const leaveSectionIndex = sidebar.items.findIndex(
	(item) => item.type === "Section Break" && item.label === "离职管理",
);
const actualItem = sidebar.items.find(
	(item) => item.label === "实际离职" && sidebar.items.indexOf(item) > leaveSectionIndex,
);
if (actualItem?.link_to !== "employee-separation-effective") {
	throw new Error("实际离职菜单必须绑定独立的 employee-separation-effective 页面。");
}

console.log("Employee separation effective-time contract passed.");
