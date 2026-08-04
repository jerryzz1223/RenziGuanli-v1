const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "hrms", "api", "employee_field_template.py"), "utf8");
const list = fs.readFileSync(path.join(root, "hrms", "public", "js", "erpnext", "employee_list.js"), "utf8");

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}

// 工作性质和员工阶段是两套口径：试用/正式必须来自是否转正，不能伪造成 Employment Type。
const expectedCards = [
	["试用期", "status: Active, custom_is_confirmed: 否"],
	["正式", "status: Active, custom_is_confirmed: 是"],
	["全职", "status: Active, employment_type: Full-time"],
	["实习生", "status: Active, employment_type: Intern"],
	["外包", "status: Active, employment_type: Contract"],
	["退休返聘", "status: Active, employment_type: Retainer"],
];

for (const source of [api, list]) {
	const normalisedSource = source.replaceAll('"', "");
	for (const [label, filters] of expectedCards) {
		const expression = new RegExp(`${label}[\\s\\S]{0,100}${filters}`);
		if (!expression.test(normalisedSource)) throw new Error(`${label} 的花名册统计口径错误。`);
	}
}

mustInclude(api, '"custom_is_confirmed",', "花名册 API 必须允许使用是否转正筛选。");
mustInclude(api, "_normalise_probation_employment_type", "导入工作性质为试用期时必须转为员工阶段，而非新建错误工作性质。");
mustInclude(list, "frappe.route_options", "花名册卡片必须使用 Frappe 路由筛选，不能依赖 URL 查询参数刷新页面。");
mustInclude(list, "build_roster_route_options", "花名册卡片必须统一构建 Frappe 路由筛选条件。");

if (list.includes("window.location.href = target")) {
	throw new Error("花名册卡片不应整页跳转，否则统计和列表容易不同步。");
}

console.log("employee roster employment/status semantics verified");
