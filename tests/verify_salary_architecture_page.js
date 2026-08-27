const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const sidebar = read("hrms/public/js/hrms_home_redirect_v6.js");
const pageJson = JSON.parse(read("hrms/hr/page/salary_architecture/salary_architecture.json"));
const pageJs = read("hrms/hr/page/salary_architecture/salary_architecture.js");

for (const marker of [
	'label: "薪资架构", route: "/desk/salary-architecture", slug: "salary-architecture"',
	'"salary-architecture"',
]) {
	if (!sidebar.includes(marker)) throw new Error(`Salary architecture sidebar entry is missing: ${marker}`);
}

if (pageJson.name !== "salary-architecture" || pageJson.title !== "薪资架构") {
	throw new Error("薪资架构必须是独立的 Frappe Page。");
}

for (const marker of [
	"薪级表",
	"①底薪",
	"②职能津贴",
	"级差",
	"defaultLevelCount = 20",
	"删除",
	"版本 + 薪资序号",
	"list_salary_structure_versions",
	"list_salary_grades",
	"save_salary_level_structure",
	"create_salary_level_structure_version",
	"import_salary_structure_workbook",
	"delete_salary_structure_version",
]) {
	if (!pageJs.includes(marker)) throw new Error(`薪资架构页缺少关键逻辑: ${marker}`);
}

console.log("Salary architecture standalone page contract passed.");
