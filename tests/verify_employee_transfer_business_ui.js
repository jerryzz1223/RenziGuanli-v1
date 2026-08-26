const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

const propertyUpdate = read("hrms", "hr", "employee_property_update.js");
const transferJs = read("hrms", "hr", "doctype", "employee_transfer", "employee_transfer.js");
const employeeSelectorJs = read("hrms", "hr", "employee_business_code_selector.js");
const transferPy = read("hrms", "hr", "doctype", "employee_transfer", "employee_transfer.py");
const transfer = JSON.parse(read("hrms", "hr", "doctype", "employee_transfer", "employee_transfer.json"));
const history = JSON.parse(read("hrms", "hr", "doctype", "employee_property_history", "employee_property_history.json"));
const detailJs = read("hrms", "hr", "page", "employee_detail", "employee_detail.js");
const employeeApi = read("hrms", "api", "employee_field_template.py");

const field = (fieldname) => transfer.fields.find((item) => item.fieldname === fieldname);

assert(!propertyUpdate.includes("+ ` (${d.fieldname})`"), "异动项目不能向人事人员展示内部字段名后缀。");
for (const marker of ["添加人事异动项目", "选择变更项目", "变更前", "变更后", "加入异动明细"]) {
	assert(propertyUpdate.includes(marker), `异动明细缺少中文业务文案: ${marker}`);
}
for (const marker of [
	"hrms-transfer-property-cards",
	"点击卡片后直接在下方填写目标值",
	'fieldname === "department" ? ["department", "designation"]',
	"get_designations_for_department",
	"data-remove-transfer-property",
	"render_transfer_employee_business_control",
]) {
	assert(propertyUpdate.includes(marker), `人事异动卡片编辑器缺少关键逻辑: ${marker}`);
}
assert(
	propertyUpdate.includes("change: handle_change"),
	"异动目标字段变更必须在控件创建时绑定，避免 Link 控件打开后丢失事件。",
);
assert(
	propertyUpdate.includes("control_state.control = control") &&
		propertyUpdate.includes("frm.__hrms_transfer_control_state"),
	"部门联动控件必须缓存在表单实例上，不能写入待序列化的明细数据。",
);
assert(
	!propertyUpdate.includes("row.__hrms_transfer_control") &&
		!propertyUpdate.includes("row.__hrms_setting_transfer_value"),
	"异动明细不得挂载控件实例或 UI 状态，否则保存时 JSON 序列化会循环引用报错。",
);
assert(
	!propertyUpdate.includes("control.df.onchange ="),
	"不得在控件初始化后替换 onchange，Frappe Link 控件会因此出现焦点闪烁。",
);
assert(
	!propertyUpdate.includes("window.setTimeout(() => render_transfer_property_editor(frm, table), 0);"),
	"部门变更不得异步重绘整块异动明细。",
);
assert(!propertyUpdate.includes('branch: __("调整所属分支机构")'), "首版异动不能继续提供分支机构变更。");

for (const marker of [
	"TRANSFER_PROPERTY_FIELDS",
	"TRANSFER_PROPERTY_LABELS",
	"configure_transfer_employee_identity",
	"derive_transfer_type",
	"异动原因",
	"生效日期",
	"人事异动已提交并写入任职记录",
]) {
	assert(transferJs.includes(marker), `人事异动表单缺少精简业务逻辑: ${marker}`);
}

assert(
	!employeeSelectorJs.includes("freeze: true") &&
		!employeeSelectorJs.includes('freeze_message: __("正在匹配员工工号")'),
	"工号匹配不得冻结整页，避免保存或提交后遗留灰色遮罩。",
);
assert(
	!transferJs.includes('frappe.set_route("employee-detail", employee)'),
	"异动提交后不得在 Frappe 保存收尾期间立即跳转页面。",
);
for (const forbidden of ["sync_transfer_type_fields", "CROSS_COMPANY_TRANSFER_TYPE", '"branch"']) {
	assert(!transferJs.includes(forbidden), `人事异动仍残留已停用逻辑: ${forbidden}`);
}

const refreshBlock = transferJs.match(/\n\trefresh\(frm\) \{([\s\S]*?)\n\t\},/);
assert(refreshBlock, "人事异动必须保留刷新事件。");
assert(
	!refreshBlock[1].includes("sync_transfer_employee"),
	"保存或提交触发刷新时不得再次异步回写员工身份字段。",
);
for (const marker of [
	"set_transfer_value_if_changed",
	"__hrms_transfer_identity_loading",
	"frm.doc.employee !== selectedEmployee || frappe.ui.form.is_saving",
]) {
	assert(transferJs.includes(marker), `人事异动身份同步缺少保存并发保护: ${marker}`);
}
assert(!transferJs.includes("frm.is_saving"), "必须使用 Frappe 真实的全局保存状态，表单实例上没有 is_saving 属性。");

for (const marker of [
	"TRANSFER_LINK_LABEL_FIELDS",
	"_resolve_transfer_link_value",
	"row.new = _resolve_transfer_link_value(field.options, new_value, employee.company)",
	'department = _resolve_transfer_link_value("Department", department, company)',
]) {
	assert(transferPy.includes(marker), `人事异动必须将业务名称转换为关联字段内部值: ${marker}`);
}

assert(field("employee")?.hidden === 1 && field("employee")?.reqd === 1, "内部 Employee 主键必须保留但隐藏。");
assert(
	field("employee_code_display")?.fieldtype === "Data" &&
		field("employee_code_display")?.read_only === 1 &&
		field("employee_code_display")?.reqd === 1 &&
		field("employee_code_display")?.in_list_view === 1,
	"员工工号必须由入口预填、只读并作为列表业务编号。",
);
assert(field("employee_name")?.read_only === 1 && field("employee_name")?.in_list_view === 1, "员工姓名必须只读展示。");
assert(transfer.title_field === "employee_code_display", "异动单列表和侧栏必须以员工工号作为业务标识。");
assert(field("draft_creation_info")?.fieldtype === "HTML", "异动草稿必须保留创建信息展示区。");
for (const marker of ["render_transfer_draft_creation_info", "创建时间", "创建人", "hide_transfer_modified_metadata"]) {
	assert(transferJs.includes(marker), `异动草稿创建信息缺少：${marker}`);
}
assert(field("transfer_type")?.hidden === 1, "异动场景应由变更项目自动归类，不得重复要求填写。");
for (const hiddenField of ["company", "new_company", "department", "approval_reference", "create_new_employee_id", "new_employee_id"]) {
	assert(field(hiddenField)?.hidden === 1, `首版异动必须隐藏旧字段: ${hiddenField}`);
}
assert(transfer.quick_entry === 0, "异动单必须使用完整业务表单，不能走 Frappe 快速新建。");

for (const [fieldname, label] of [
	["transfer_reason", "异动原因"],
	["transfer_date", "生效日期"],
	["remarks", "备注"],
]) {
	assert(field(fieldname)?.label === label, `异动字段标签不正确: ${fieldname}`);
}
for (const [fieldname, label] of [["property", "变更项目"], ["current", "变更前"], ["new", "变更后"]]) {
	assert(history.fields.some((item) => item.fieldname === fieldname && item.label === label), `异动明细列未中文化: ${fieldname}`);
}

for (const marker of [
	"sync_employee_identity",
	"derive_transfer_type",
	"validate_active_employee",
	"请至少添加一项实际发生变化的异动明细",
	"生效日期未到，不能提交人事异动",
	"调整部门时必须同时选择新岗位",
	"get_designations_for_department",
	"get_employee_business_options",
]) {
	assert(transferPy.includes(marker), `人事异动后端缺少业务校验: ${marker}`);
}
for (const marker of ['"employment_type": "工作性质"', "工作性质调整"]) {
	assert(transferPy.includes(marker), `工作性质异动缺少统一字段：${marker}`);
}
assert(!transferPy.includes("custom_personnel_status"), "异动页不应保留人员状态字段。");
assert(!propertyUpdate.includes("custom_personnel_status"), "异动编辑器不应保留人员状态选择器。");
for (const marker of ["growth_records", "_get_employee_growth_records", "工作性质调整"]) {
	assert(employeeApi.includes(marker) || detailJs.includes(marker), `成长记录未包含工作性质调整：${marker}`);
}
for (const forbidden of ["CROSS_COMPANY_TRANSFER_TYPE", "copy_employee_for_cross_company_transfer", "validate_company_change"] ) {
	assert(!transferPy.includes(forbidden), `人事异动后端仍残留首版停用流程: ${forbidden}`);
}

for (const marker of [
	'frappe.new_doc("Employee Transfer"',
	"employee_code_display: header.custom_employee_code",
	"employee_name: header.employee_name",
	"company: header.company",
	"department: header.department",
	"transfer_date: frappe.datetime.get_today()",
]) {
	assert(detailJs.includes(marker), `员工详情的异动入口没有完整预填: ${marker}`);
}
assert(employeeApi.includes('"company": doc.get("company")'), "员工详情接口必须返回公司用于预填异动单。");

console.log("Employee Transfer simplified business UI contract passed.");
