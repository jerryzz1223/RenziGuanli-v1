const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const schema = JSON.parse(read("hrms/hr/doctype/hrms_employee_reward_punishment/hrms_employee_reward_punishment.json"));
const controller = read("hrms/hr/doctype/hrms_employee_reward_punishment/hrms_employee_reward_punishment.py");
const form = read("hrms/hr/doctype/hrms_employee_reward_punishment/hrms_employee_reward_punishment.js");
const list = read("hrms/hr/doctype/hrms_employee_reward_punishment/hrms_employee_reward_punishment_list.js");
const ruleSchema = JSON.parse(read("hrms/hr/doctype/hrms_reward_punishment_rule/hrms_reward_punishment_rule.json"));
const ruleController = read("hrms/hr/doctype/hrms_reward_punishment_rule/hrms_reward_punishment_rule.py");
const sidebar = JSON.parse(read("hrms/workspace_sidebar/personnel.json"));
const workspace = JSON.parse(read("hrms/hr/workspace/personnel/personnel.json"));
const shell = read("hrms/public/js/hrms_home_redirect_v6.js");
const topNav = read("hrms/public/js/hrms_top_nav.js");
const employeeDetail = read("hrms/api/employee_field_template.py");
const intake = read("hrms/api/form_data_intake.py");
const hooks = read("hrms/hooks.py");
const demoSeed = read("hrms/api/demo_seed.py");

assert.strictEqual(schema.name, "HRMS Employee Reward Punishment");
assert.strictEqual(schema.autoname, "HR-RP-.YYYY.-.#####");
assert.strictEqual(schema.track_changes, 1, "Reward/punishment records must retain an edit timeline.");

const fields = new Map(schema.fields.map((field) => [field.fieldname, field]));
for (const fieldname of [
	"employee", "employee_code", "employee_name", "company", "department", "designation", "employee_code_display", "category_selector",
	"reward_punishment_type", "category", "occurred_on", "subject", "status", "reason",
	"rule", "standard", "decision_result", "full_salary", "rate_percent", "manual_amount_override", "amount",
	"conversion_count", "converts_to", "calculation_note", "handled_by", "approved_by", "approved_on",
	"payroll_welfare_source", "source_import_row", "source_import_batch", "attachment", "source_file", "remarks",
]) {
	assert(fields.has(fieldname), `Missing reward/punishment field: ${fieldname}`);
}
for (const required of ["employee_code_display", "company", "category_selector", "reward_punishment_type", "category", "occurred_on", "subject", "status", "reason", "full_salary"]) {
	assert.strictEqual(fields.get(required).reqd, 1, `${required} must be required.`);
}
assert(fields.get("status").options.includes("待审核") && fields.get("status").options.includes("已撤销"));
assert(schema.permissions.some((permission) => permission.role === "HR Manager" && permission.write === 1));
assert(schema.permissions.some((permission) => permission.role === "HR User" && permission.create === 1));

for (const marker of ["_set_employee_snapshot", "_apply_rule_and_calculation", "_employee_full_salary", "get_reward_punishment_context", "_validate_status_transition", "_set_approval_audit"]) {
	assert(controller.includes(marker), `Missing server-side record safeguard: ${marker}`);
}
for (const marker of ["提交审核", "确认生效", "驳回", "撤销记录", "管理奖惩规则", "recalculate_amount", "employee_code_display", "category_selector", "setup_business_form", "get_reward_punishment_rule_options"]) {
	assert(form.includes(marker), `Missing form workflow action: ${marker}`);
}
assert(list.includes("get_indicator") && list.includes("已生效"));
assert(list.includes("HRMS Reward Punishment Rule"));

assert.strictEqual(ruleSchema.name, "HRMS Reward Punishment Rule");
for (const fieldname of ["company", "reward_punishment_type", "category", "rate_percent", "standard_text", "conversion_count", "converts_to", "termination_action", "enabled"]) {
	assert(ruleSchema.fields.some((field) => field.fieldname === fieldname), `Missing reward rule field: ${fieldname}`);
}
for (const marker of ["嘉奖", "小功", "大功", "警告", "小过", "大过", "开除", "rate_percent\": 8", "rate_percent\": 14", "rate_percent\": 20", "rate_percent\": 100", "ensure_default_reward_punishment_rules"]) {
	assert(ruleController.includes(marker), `Missing reward/punishment rule contract: ${marker}`);
}

const sidebarLink = sidebar.items.find((link) => link.label === "奖惩记录");
const workspaceLink = workspace.links.find((link) => link.label === "奖惩记录");
assert.strictEqual(sidebarLink.link_to, "HRMS Employee Reward Punishment");
assert.strictEqual(workspaceLink.link_to, "HRMS Employee Reward Punishment");
for (const source of [shell, topNav]) {
	assert(source.includes("hrms-employee-reward-punishment"), "Personnel navigation must recognize the dedicated route.");
}
assert(!shell.includes('route: "/desk/employee-grievance"'), "The personnel reward menu must not open Employee Grievance.");

assert(employeeDetail.includes('"HRMS Employee Reward Punishment"'));
assert(employeeDetail.includes("reward_punishment_items"));
assert(employeeDetail.includes("新增奖惩记录"));
for (const marker of [
	'"entry_mode": "reward_punishment_drafts"',
	'"row_identity_keys": ["employee_code", "employee_name"]',
	'def _normalise_reward_punishment_data(data, company):',
	'if row.template_key == "reward_punishment":',
	'"target_doctype": "HRMS Employee Reward Punishment"',
	'"source_import_row": row.name',
	'created_records.append(target.name)',
	'"reward_punishment": "/desk/hrms-employee-reward-punishment"',
]) {
	assert(intake.includes(marker), `Reward import/archive integration is missing: ${marker}`);
}
assert(hooks.includes('"HRMS Employee Reward Punishment": "public/js/form_import_list_actions.js"'));
assert(demoSeed.includes('"HRMS Employee Reward Punishment"'));
assert(!demoSeed.includes("标准 DocType 语义为员工申诉"));

console.log("employee reward/punishment record contract passed");
