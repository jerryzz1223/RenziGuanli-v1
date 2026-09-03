const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const template = fs.readFileSync(path.join(root, "hrms", "api", "employee_field_template.py"), "utf8");
const employee = fs.readFileSync(path.join(root, "hrms", "overrides", "employee_master.py"), "utf8");
const employeeForm = fs.readFileSync(path.join(root, "hrms", "public", "js", "erpnext", "employee.js"), "utf8");
const transfer = fs.readFileSync(
	path.join(root, "hrms", "hr", "doctype", "employee_transfer", "employee_transfer.py"),
	"utf8",
);
const patch = fs.readFileSync(
	path.join(root, "hrms", "patches", "v16_0", "ensure_employee_work_nature_source.py"),
	"utf8",
);
const patches = fs.readFileSync(path.join(root, "hrms", "patches.txt"), "utf8");

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}

mustInclude(template, 'for internal_fieldname in ("employment_type", "status"):', "系统字段必须从人事表单隐藏。");
mustInclude(template, '_sync_company_roster_fields(doc, {"custom_work_nature"})', "上线补丁必须安装工作性质字段。");
mustInclude(template, '"fieldname": "custom_work_nature"', "工作性质必须是持久化字段。");
mustInclude(template, '_backfill_employee_work_nature()', "上线补丁必须回填已有员工的工作性质。");
mustInclude(employeeForm, 'const EMPLOYEE_WORK_NATURE_VALUES = ["在职·正式", "在职·试用期", "退休返聘", "待离职", "离职"]', "原工作性质控件必须固定为五项业务取值。");
mustInclude(employeeForm, 'custom_work_nature(frm)', "页面选择必须监听保存的工作性质字段。");
mustInclude(employeeForm, 'apply_employee_work_nature_choice(frm, frm.doc.custom_work_nature)', "页面选择必须映射到所有底层员工字段。");
mustInclude(employeeForm, 'frm.set_df_property("custom_work_nature", "options"', "页面必须使用持久化的工作性质选择框。");
mustInclude(employeeForm, '"在职·正式": { employment_type: "Full-time", status: "Active", custom_is_confirmed: "是"', "正式在职必须匹配雇佣类型、状态和转正字段。");
mustInclude(employeeForm, '"在职·试用期": { employment_type: "Full-time", status: "Active", custom_is_confirmed: "否"', "试用在职必须匹配雇佣类型、状态和转正字段。");
mustInclude(employeeForm, '"退休返聘": { employment_type: "Retainer", status: "Active"', "返聘必须匹配雇佣类型和状态字段。");
mustInclude(employeeForm, '"待离职": { employment_type: "Full-time", status: "Inactive"', "待离职必须匹配实际状态字段。");
mustInclude(employeeForm, '"离职": { employment_type: "Full-time", status: "Left"', "离职必须匹配实际状态字段。");
mustInclude(employeeForm, 'function sync_employee_work_nature_dependent_fields(frm)', "工作性质必须同步离职日期的页面显示规则。");
mustInclude(employeeForm, 'frm.toggle_display("relieving_date", is_leaving)', "离职时必须显示离职日期字段。");
mustInclude(employeeForm, 'frm.set_df_property("relieving_date", "reqd", is_leaving)', "离职时必须将离职日期设为必填。");
mustInclude(employeeForm, 'data-fieldname", "relieving_date"', "离职日期必须放入在职信息编辑区。");
mustInclude(employeeForm, 'get_employee_work_nature_display', "页面必须将已有员工的内部值显示为工作性质。");
mustInclude(employee, 'WORK_NATURE_OPTIONS = ("在职·正式", "在职·试用期", "退休返聘", "待离职", "离职")', "服务端五项工作性质口径缺失。");
mustInclude(employee, 'employee.get("custom_work_nature")', "服务端必须以保存的工作性质为准。");
mustInclude(employee, 'employee.status = "Active"', "在职和返聘选择必须同步为在职。");
mustInclude(employee, 'employee.status = "Inactive"', "待离职选择必须同步实际状态。");
mustInclude(employee, 'employee.status = "Left"', "离职选择必须同步实际状态。");
mustInclude(employee, 'employee.custom_is_confirmed = "是"', "正式在职选择必须同步转正状态。");
mustInclude(employee, 'employee.custom_is_confirmed = "否"', "试用在职选择必须同步转正状态。");
mustInclude(transfer, '_set_if_present(employee, "custom_work_nature", canonical_work_nature)', "人事异动必须直接同步工作性质字段。");
mustInclude(patch, 'ensure_employee_work_nature_setup()', "迁移补丁必须安装工作性质选择器。");
mustInclude(patches, 'hrms.patches.v16_0.ensure_employee_work_nature_source', "迁移补丁未登记。");

console.log("employee work-nature selector contract verified");
