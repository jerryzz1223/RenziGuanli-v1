const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(...parts) {
	return fs.readFileSync(path.join(root, ...parts), "utf8");
}

function readJson(...parts) {
	return JSON.parse(read(...parts));
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

const redirectSource = read("hrms", "public", "js", "hrms_home_redirect_v6.js");
const topNavSource = read("hrms", "public", "js", "hrms_top_nav.js");
const apiSource = read("hrms", "api", "employee_field_template.py");

const propertyHistoryPagePath = path.join(root, "hrms", "hr", "page", "employee_property_history");
assert(fs.existsSync(path.join(propertyHistoryPagePath, "employee_property_history.json")), "任职记录必须有真实 Page JSON。");
assert(fs.existsSync(path.join(propertyHistoryPagePath, "employee_property_history.js")), "任职记录必须有真实 Page JS。");

const pageJson = readJson("hrms", "hr", "page", "employee_property_history", "employee_property_history.json");
assert(pageJson.name === "employee-property-history", "任职记录 Page name 必须是 employee-property-history。");
assert(pageJson.title === "异动记录", "异动记录 Page 标题必须是中文。");

const pageRoot = path.join(root, "hrms", "hr", "page");
const legacyPropertyHistoryPages = fs
	.readdirSync(pageRoot)
	.filter((entry) => /^employee_property_hi(?:_\d+)?$/.test(entry));
assert(
	legacyPropertyHistoryPages.length === 0,
	`任职记录不能保留截断生成的旧 Page 目录: ${legacyPropertyHistoryPages.join(", ")}`
);

const pageJs = read("hrms", "hr", "page", "employee_property_history", "employee_property_history.js");
for (const marker of [
	'frappe.pages["employee-property-history"]',
	"hrms.api.employee_field_template.get_employee_property_history",
	"Employee Transfer",
	"Employee Promotion",
]) {
	assert(pageJs.includes(marker), `任职记录页缺少必要标记: ${marker}`);
}
assert(!pageJs.includes('set_primary_action(__("办理人事异动")'), "异动记录页不得重复提供办理入口。");
assert(!pageJs.includes('add_inner_button(__("打开人事异动列表")'), "异动记录页不得绕回 Employee Transfer 列表。");

for (const marker of [
	"get_employee_property_history",
	"Employee Transfer",
	"Employee Promotion",
	"Employee Property History",
	"transfer_details",
	"promotion_details",
	'"property"',
	'"current"',
	'"new"',
	'"fieldname"',
]) {
	assert(apiSource.includes(marker), `任职记录后台 API 缺少真实字段契约: ${marker}`);
}

for (const marker of ["LEGACY_PERSONNEL_PAGE_SLUGS", "frappe.delete_doc"]) {
	assert(apiSource.includes(marker), `ensure_personnel_pages 必须清理旧的截断 Page 记录: ${marker}`);
}
assert(!apiSource.includes("rename_doc(\"Page\""), "ensure_personnel_pages 不能用 rename_doc 清理旧 Page，Frappe 17 该 API 不支持 ignore_permissions。");
assert(!apiSource.includes("rename_doc(\"Page\", primary_name, page_name, force=True, ignore_permissions=True"), "rename_doc 不能传 ignore_permissions。");

for (const marker of ['"employee-property-history"', "ensure_personnel_pages"]) {
	assert(redirectSource.includes(marker), `侧栏跳转必须确保任职记录页面可用: ${marker}`);
	assert(topNavSource.includes(marker), `顶部导航跳转必须确保任职记录页面可用: ${marker}`);
}

const topNavEnsuredRoutes = topNavSource.match(/if \(\[([\s\S]*?)\]\.includes\(deskRoute\)\)/);
assert(topNavEnsuredRoutes, "顶部导航必须维护跳转前 ensure 的页面白名单。");
for (const marker of ['"attendance-import-center"', '"payroll-input-center"', '"employee-property-history"']) {
	assert(topNavEnsuredRoutes[1].includes(marker), `顶部导航跳转前 ensure 白名单缺少: ${marker}`);
}

assert(!redirectSource.includes('{ label: "培训经历", route: "/desk/employee-training"'), "培训经历不能指向 Employee Training 子表裸路由。");
assert(redirectSource.includes('{ label: "培训经历", route: "/desk/employee-skill-map"'), "培训经历应进入 Employee Skill Map 父级资料。");

for (const workspaceParts of [
	["hrms", "hr", "workspace", "personnel", "personnel.json"],
	["hrms", "workspace_sidebar", "personnel.json"],
]) {
	const workspaceSource = read(...workspaceParts);
	assert(!workspaceSource.includes('"link_to": "Employee Property History"'), `${workspaceParts.join("/")} 不能指向任职记录子表。`);
	assert(!workspaceSource.includes('"link_to": "Employee Training"'), `${workspaceParts.join("/")} 不能指向培训经历子表。`);
	assert(workspaceSource.includes('"link_to": "employee-property-history"'), `${workspaceParts.join("/")} 必须进入任职记录汇总页。`);
	assert(workspaceSource.includes('"label": "异动记录"'), `${workspaceParts.join("/")} 左侧必须只展示异动记录入口。`);
	assert(!workspaceSource.includes('"link_to": "Employee Transfer"'), `${workspaceParts.join("/")} 左侧不得直接办理人事异动。`);
	assert(workspaceSource.includes('"link_to": "Employee Skill Map"'), `${workspaceParts.join("/")} 必须进入培训经历父级资料。`);
}

const propertyHistory = readJson("hrms", "hr", "doctype", "employee_property_history", "employee_property_history.json");
assert(propertyHistory.istable === 1, "Employee Property History 应为子表，测试必须保护聚合页逻辑。");
for (const field of ["property", "current", "new", "fieldname"]) {
	assert(propertyHistory.fields.some((item) => item.fieldname === field), `Employee Property History 缺少字段: ${field}`);
}

const transfer = readJson("hrms", "hr", "doctype", "employee_transfer", "employee_transfer.json");
assert(transfer.fields.some((field) => field.fieldname === "transfer_details" && field.options === "Employee Property History"), "Employee Transfer 必须把任职变化写入 transfer_details。");
assert(transfer.fields.some((field) => field.fieldname === "employee"), "Employee Transfer 必须关联员工。");
assert(transfer.fields.some((field) => field.fieldname === "transfer_date"), "Employee Transfer 必须有异动日期。");
for (const fieldname of ["transfer_type", "transfer_reason", "approval_reference", "remarks"]) {
	assert(transfer.fields.some((field) => field.fieldname === fieldname), `Employee Transfer 缺少中文业务字段: ${fieldname}`);
}

const promotion = readJson("hrms", "hr", "doctype", "employee_promotion", "employee_promotion.json");
assert(promotion.fields.some((field) => field.fieldname === "promotion_details" && field.options === "Employee Property History"), "Employee Promotion 必须把任职变化写入 promotion_details。");
assert(promotion.fields.some((field) => field.fieldname === "employee"), "Employee Promotion 必须关联员工。");
assert(promotion.fields.some((field) => field.fieldname === "promotion_date"), "Employee Promotion 必须有转正/晋升日期。");

const skillMap = readJson("hrms", "hr", "doctype", "employee_skill_map", "employee_skill_map.json");
assert(skillMap.fields.some((field) => field.fieldname === "trainings" && field.options === "Employee Training"), "培训经历必须通过 Employee Skill Map.trainings 写入。");

for (const doctypePath of [
	["employee_onboarding", "employee_onboarding.json"],
	["employee_promotion", "employee_promotion.json"],
	["employee_separation", "employee_separation.json"],
	["employee_transfer", "employee_transfer.json"],
	["employee_grievance", "employee_grievance.json"],
	["exit_interview", "exit_interview.json"],
]) {
	const fullPath = path.join(root, "hrms", "hr", "doctype", ...doctypePath);
	assert(fs.existsSync(fullPath), `人事员工关系入口缺少有效 DocType: ${doctypePath.join("/")}`);
}

console.log("Personnel seed contract routes and write-field targets are valid.");
