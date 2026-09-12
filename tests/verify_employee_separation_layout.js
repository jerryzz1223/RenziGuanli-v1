const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
	path.join(root, "hrms", "hr", "doctype", "employee_separation", "employee_separation.js"),
	"utf8",
);

for (const marker of [
	"function hide_standard_separation_sidebar(frm)",
	'.closest(".page-container")',
	'page_container.addClass("hrms-employee-separation-no-sidebar")',
	'hrms-employee-separation-no-sidebar-style',
	'.hrms-employee-separation-no-sidebar .form-sidebar { display: none !important; }',
	'.find(".layout-side-section, .form-sidebar")',
	'.attr("aria-hidden", "true")',
	'.css("display", "none")',
	'.find(".layout-main-section-wrapper")',
	'.removeClass("col-lg-10 col-md-9")',
	'.addClass("col-12")',
	"hide_standard_separation_sidebar(frm);",
	"function get_separation_parent_context(frm)",
	'frm?.doc?.docstatus === 1 && frm?.doc?.boarding_status === "Completed"',
	'new URLSearchParams(window.location.search).get("hrms_from")',
	'source === "employee-separation-records"',
	"function apply_separation_breadcrumb(frm)",
	'label: __("离职记录")',
	'route: "/desk/employee-separation-records"',
	'back_label: __("返回离职记录")',
	'label: __("离职管理")',
	'route: "/desk/employee-separation"',
	'append_breadcrumb_element("", employee_label, "title-text-form")',
	"function add_separation_back_button(frm)",
	"frm.add_custom_button(parent.back_label",
	'frappe.set_route("employee-separation-records")',
	'frappe.route_options = { docstatus: 1, boarding_status: "Pending" }',
	'frappe.set_route("List", "Employee Separation")',
	"apply_separation_breadcrumb(frm);",
]) {
	assert.ok(source.includes(marker), `离职表单右侧栏隐藏逻辑缺失: ${marker}`);
}

let button;
const routes = [];
const frappe = {
	ui: { form: { on() {} } },
	set_route(...args) {
		routes.push(args);
	},
};
const executable_source = source.replace(/^\{%.*?%\}\s*$/gm, "");
const sandbox = {
	frappe,
	window: { location: { search: "" } },
	document: {},
	URLSearchParams,
	$() {},
	__: (value) => value,
};
vm.runInNewContext(
	`${executable_source}\nthis.addSeparationBackButton = add_separation_back_button;`,
	sandbox,
);
const form = {
	doc: { docstatus: 1, boarding_status: "Pending" },
	add_custom_button(label, action) {
		button = { label, action };
		return { addClass() {} };
	},
};
sandbox.addSeparationBackButton(form);
assert.equal(button.label, "返回离职管理");
button.action();
assert.equal(JSON.stringify(frappe.route_options), JSON.stringify({ docstatus: 1, boarding_status: "Pending" }));
assert.deepEqual(routes, [["List", "Employee Separation"]]);

sandbox.window.location.search = '?hrms_from="employee-separation-records"';
sandbox.addSeparationBackButton({
	add_custom_button(label, action) {
		button = { label, action };
		return { addClass() {} };
	},
});
assert.equal(button.label, "返回离职记录");
button.action();
assert.equal(JSON.stringify(frappe.route_options), JSON.stringify({}));
assert.deepEqual(routes.at(-1), ["employee-separation-records"]);

sandbox.window.location.search = "";
form.doc.boarding_status = "Completed";
sandbox.addSeparationBackButton(form);
assert.equal(button.label, "返回离职记录");
button.action();
assert.deepEqual(routes.at(-1), ["employee-separation-records"]);

console.log("Employee separation right sidebar is hidden and the form expands to full width.");
