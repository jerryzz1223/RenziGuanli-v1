const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

const propertyUpdate = read("hrms", "hr", "employee_property_update.js");
const transferJs = read("hrms", "hr", "doctype", "employee_transfer", "employee_transfer.js");
const transferPy = read("hrms", "hr", "doctype", "employee_transfer", "employee_transfer.py");
const transfer = JSON.parse(read("hrms", "hr", "doctype", "employee_transfer", "employee_transfer.json"));
const history = JSON.parse(read("hrms", "hr", "doctype", "employee_property_history", "employee_property_history.json"));

assert(!propertyUpdate.includes("+ ` (${d.fieldname})`"), "异动项目不能向人事人员展示内部字段名后缀。");
for (const marker of ["添加人事异动项目", "选择变更项目", "变更前", "变更后", "加入异动明细"]) {
	assert(propertyUpdate.includes(marker), `异动明细弹窗缺少中文业务文案: ${marker}`);
}
for (const marker of [
	"hrms-business-change-action",
	"尚未添加变更项目",
	"已添加 {0} 项变更",
	".grid-row-check",
	".grid-field-setup",
]) {
	assert(propertyUpdate.includes(marker), `异动明细操作区缺少业务化处理: ${marker}`);
}
assert(!propertyUpdate.includes("grid.add_custom_button"), "添加变更项目不能继续藏在 Frappe 子表按钮区。");
for (const marker of ["TRANSFER_PROPERTY_FIELDS", "TRANSFER_PROPERTY_LABELS", "异动类型", "关联审批单", "异动明细"]) {
	assert(transferJs.includes(marker), `人事异动表单缺少业务化配置: ${marker}`);
}
for (const marker of ["跨公司调动", "sync_transfer_type_fields", "new_company", "create_new_employee_id"]) {
	assert(transferJs.includes(marker), `人事异动必须按异动类型控制公司变更字段: ${marker}`);
}
for (const [fieldname, label] of [
	["transfer_type", "异动类型"],
	["transfer_reason", "异动原因"],
	["transfer_date", "生效日期"],
	["approval_reference", "关联审批单"],
	["remarks", "备注"],
]) {
	const field = transfer.fields.find((item) => item.fieldname === fieldname);
	assert(field && field.label === label, `异动字段标签不正确: ${fieldname}`);
}
for (const [fieldname, label] of [["property", "变更项目"], ["current", "变更前"], ["new", "变更后"]]) {
	assert(history.fields.some((item) => item.fieldname === fieldname && item.label === label), `异动明细列未中文化: ${fieldname}`);
}
for (const marker of ["validate_active_employee", "请至少添加一项实际发生变化的异动明细", "生效日期未到，不能提交人事异动"]) {
	assert(transferPy.includes(marker), `人事异动提交校验缺失: ${marker}`);
}
for (const marker of ["跨公司调动", "请选择新公司", "普通人事异动不能填写新公司", "跨公司调动的新公司不能与原公司相同"]) {
	assert(transferPy.includes(marker), `人事异动跨公司校验缺失: ${marker}`);
}

const transferType = transfer.fields.find((field) => field.fieldname === "transfer_type");
assert(transferType?.options?.includes("跨公司调动"), "异动类型必须提供跨公司调动。");

console.log("Employee Transfer Chinese business UI contract passed.");
