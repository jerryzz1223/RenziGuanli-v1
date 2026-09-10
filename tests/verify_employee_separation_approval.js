const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

const controller = read("hrms", "hr", "doctype", "employee_separation", "employee_separation.py");
const form = read("hrms", "hr", "doctype", "employee_separation", "employee_separation.js");
const list = read("hrms", "hr", "doctype", "employee_separation", "employee_separation_list.js");
const records = read(
	"hrms",
	"hr",
	"page",
	"employee_separation_records",
	"employee_separation_records.py",
);
const hooks = read("hrms", "hooks.py");
const sidebar = read("hrms", "public", "js", "hrms_home_redirect_v6.js");
const doctype = JSON.parse(
	read("hrms", "hr", "doctype", "employee_separation", "employee_separation.json"),
);

const systemManager = doctype.permissions.find(
	(permission) => permission.role === "System Manager",
);
assert(systemManager?.submit === 1, "最高权限账号必须具有离职审批提交权限。");
assert(!controller.includes("self_approval"), "离职流程不得阻止最高权限账号审批自己的申请。");
for (const role of ["HR Manager", "HR User"]) {
	assert(
		doctype.permissions.find((permission) => permission.role === role)?.submit === 1,
		`${role} 必须能将离职申请提交到待审批队列。`,
	);
}

for (const marker of [
	"def on_submit(self):",
	'self.db_set("boarding_status", "Pending")',
	"def approve_employee_separation(separation_name: str):",
	'frappe.only_for("System Manager")',
	"separation._set_employee_departure_state()",
	'values = {"boarding_status": "Completed"}',
	"is_departed = departure_date <= getdate(nowdate())",
	'work_nature = "离职" if is_departed else "待离职"',
	'employee.status = "Left" if is_departed else "Inactive"',
	"employee.relieving_date = departure_date",
	"def process_due_employee_separations():",
]) {
	assert(controller.includes(marker), `离职审批状态链缺少服务端逻辑: ${marker}`);
}
assert(!controller.includes("def on_update(self):"), "草稿保存不得提前将员工改为待离职。");

for (const marker of [
	"frm.doc.docstatus === 1",
	'frappe.user.has_role("System Manager")',
	'__("审批通过")',
	"approve_employee_separation",
	"未到离职日期的员工将变为“待离职”",
	"callback: () => frm.reload_doc()",
]) {
	assert(form.includes(marker), `离职审批页面缺少独立审批操作: ${marker}`);
}
assert(
	!controller
		.slice(
			controller.indexOf("def on_submit(self):"),
			controller.indexOf("def on_update_after_submit(self):"),
		)
		.includes("_set_employee_departure_state"),
	"未审批的离职申请不得改变员工工作性质。",
);

assert(list.includes('Pending: __("待审批")'), "离职管理列表缺少待审批状态。");
assert(list.includes('Completed: __("审批通过")'), "离职管理列表缺少审批通过状态。");
assert(list.includes('["docstatus", "=", 1]'), "离职管理只应默认展示已提交的申请。");
for (const marker of [
	"show_submitted_pending_separations",
	"filter_area.clear_filters()",
	"filter_area.set(preserved_filters)",
]) {
	assert(list.includes(marker), `离职管理未清理历史冲突筛选: ${marker}`);
}
assert(
	sidebar.includes('frappe.route_options = { docstatus: 1, boarding_status: "Pending" }'),
	"左侧离职管理入口必须重置为已提交待审批队列。",
);
assert(
	records.includes("_get_approved_separation_employee_names"),
	"离职记录必须只补充已审批离职单。",
);
assert(
	records.includes('filters["boarding_status"] = "Completed"'),
	"待审批离职单不得进入离职记录。",
);
assert(
	hooks.includes(
		'"hrms.hr.doctype.employee_separation.employee_separation.process_due_employee_separations"',
	),
	"审批通过的待离职员工必须注册到期自动离职任务。",
);

console.log("Employee separation approval contract passed.");
