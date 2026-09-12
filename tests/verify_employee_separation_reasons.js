const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const doctype = JSON.parse(
	read("hrms", "hr", "doctype", "employee_separation", "employee_separation.json"),
);
const controller = read(
	"hrms",
	"hr",
	"doctype",
	"employee_separation",
	"employee_separation.py",
);
const intake = read("hrms", "api", "form_data_intake.py");
const employeeDetail = read("hrms", "hr", "page", "employee_detail", "employee_detail.js");
const field = (fieldname) => doctype.fields.find((item) => item.fieldname === fieldname);

assert.equal(field("separation_reason_section")?.label, "选择离职原因");
assert.equal(field("separation_reason_type")?.reqd, 1);
assert.equal(field("separation_reason_type")?.options, "\n主动离职\n被动离职\n自定义");
assert.match(field("separation_reason")?.mandatory_depends_on || "", /!= '自定义'/);
assert.match(field("custom_separation_reason")?.mandatory_depends_on || "", /== '自定义'/);
assert.equal(field("separation_reason_detail")?.fieldtype, "Small Text");
assert.equal(field("separation_reason_detail")?.reqd || 0, 0);
assert.match(field("separation_reason_detail")?.label || "", /详细原因/);

const handlers = {};
const frappe = {
	ui: {
		form: {
			on(doctypeName, formHandlers) {
				assert.equal(doctypeName, "Employee Separation");
				Object.assign(handlers, formHandlers);
			},
		},
	},
};
const source = read(
	"hrms",
	"hr",
	"doctype",
	"employee_separation",
	"employee_separation.js",
).replace(/^\{%.*?%\}\s*$/gm, "");
vm.runInNewContext(source, { frappe, window: {}, __: (value) => value, console });

const changes = [];
const frm = {
	doc: {
		separation_reason_type: "主动离职",
		separation_reason: "协议解除",
		custom_separation_reason: "旧自定义原因",
	},
	set_df_property(fieldname, property, value) {
		this.options = { fieldname, property, value };
	},
	set_value(fieldname, value) {
		changes.push([fieldname, value]);
		this.doc[fieldname] = value;
	},
};
handlers.separation_reason_type(frm);
assert.equal(
	frm.options.value,
	"\n家庭原因\n个人原因\n发展原因\n合同到期不续签\n其他",
);
assert.deepEqual(changes, [
	["separation_reason", ""],
	["custom_separation_reason", ""],
]);

assert.match(controller, /SEPARATION_REASONS_BY_TYPE = \{/);
assert.match(controller, /if self\.separation_reason_type == "自定义":/);
assert.match(controller, /请选择与“\{0\}”对应的离职原因/);
assert.doesNotMatch(controller, /EmployeeBoardingController/);
assert.doesNotMatch(controller, /super\(\)\.on_cancel/);
assert.match(intake, /"separation_reason_type": "自定义"/);
assert.match(intake, /"custom_separation_reason": data\.get\("reason"\) or ""/);
for (const marker of [
	"open_separation_reason_picker",
	'frappe.ui.Dialog({',
	'主动原因',
	'被动原因',
	'data-reason-type="自定义"',
	'请输入自定义离职原因。',
	'separation_reason_type: reason_type',
	'custom_separation_reason: reason_type === "自定义" ? custom_reason : ""',
	'const reason_detail = String(dialog.$wrapper.find(".hrms-separation-reason-detail").val() || "").trim()',
	'separation_reason_detail: reason_detail',
	'详细原因（选填）',
]) {
	assert.ok(employeeDetail.includes(marker), `员工档案离职原因弹窗缺少逻辑: ${marker}`);
}

console.log("Employee separation reason contract passed.");
