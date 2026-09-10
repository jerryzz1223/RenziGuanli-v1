const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const list = fs.readFileSync(path.join(root, "hrms/public/js/erpnext/department_list.js"), "utf8");
const navigation = fs.readFileSync(path.join(root, "hrms/public/js/hrms_home_redirect_v6.js"), "utf8");
const routes = [];
const context = { frappe: { listview_settings: {}, set_route: (...args) => routes.push(args) } };
vm.runInNewContext(list, context);
let hidden = 0;
const view = { page: { main: { hide() { hidden++; } } } };
context.frappe.listview_settings.Department.onload(view);
context.frappe.listview_settings.Department.refresh(view);
assert.deepEqual(routes, [["organizational-chart", "list"], ["organizational-chart", "list"]]);
assert.equal(hidden, 2);
assert(!list.includes("add_inner_button"), "Retired page must not recreate its toolbar.");

const redirect = navigation.slice(navigation.indexOf("function redirect_to_hrms_home()"), navigation.indexOf("function query_hrms_scope("));
function destination(pathname, hash = "") {
	let target;
	const scope = { window: { location: { pathname, hash, replace(value) { target = value; } } } };
	vm.runInNewContext(redirect + "\nredirect_to_hrms_home();", scope);
	return target;
}
for (const url of ["/desk/department", "/app/department", "/desk/department/", "/desk/department/view/List", "/desk/department/view/Tree", "/desk/department/view/Report"]) {
	assert.equal(destination(url), "/desk/organizational-chart/list");
}
assert.equal(destination("/desk", "#List/Department/List"), "/desk/organizational-chart/list");
assert.equal(destination("/desk/department/QE组"), undefined, "Administrative record access is not a duplicate list page.");
assert.equal(destination("/desk/organizational-chart/list"), undefined, "Redirect must not loop.");
assert.equal(destination("/desk/employee"), undefined);
assert(!navigation.includes('label: "花名册部门"'));
console.log("PASS: retired Department list/view links redirect; no duplicate toolbar; forms and unrelated routes unchanged.");
