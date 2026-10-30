const assert = require("assert");
const fs = require("fs");
const path = require("path");

const page = fs.readFileSync(
	path.join(__dirname, "..", "hrms", "hr", "page", "hrms_access_center", "hrms_access_center.js"),
	"utf8",
);

for (const method of [
	"hrms.access_control.disable_hrms_user_account",
	"hrms.api.employee_field_template.test_hrms_effective_permission",
]) {
	const callIndex = page.indexOf(`frappe.call("${method}"`);
	assert(callIndex >= 0, `Missing access-center RPC: ${method}`);
	const beforeCall = page.slice(Math.max(0, callIndex - 32), callIndex);
	assert(
		beforeCall.includes("Promise.resolve("),
		`${method} must normalize legacy Frappe Deferred responses before using finally()`,
	);
}

console.log("Access-center Deferred cleanup compatibility verified.");
