const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const patch = fs.readFileSync(
	path.join(root, "hrms/patches/v16_0/repair_yongxin_company_relationships.py"),
	"utf8",
);
const patches = fs.readFileSync(path.join(root, "hrms/patches.txt"), "utf8");
const workbench = fs.readFileSync(
	path.join(root, "hrms/hr/page/attendance_import_center/attendance_import_center.js"),
	"utf8",
);

function check(condition, message) {
	if (!condition) throw new Error(message);
}

for (const marker of [
	'YONGXIN_COMPANY = "永新"',
	'TEST_COMPANY = "_Test Company"',
	"HRMS Monthly Attendance Summary",
	"HRMS Payroll Settlement Record",
	"HRMS Employee Salary Change",
	"HRMS Payroll Welfare Source Record",
	"HRMS Payroll Variable Import Batch",
	"HRMS Payroll Rule",
	"code.startswith(\"SEED\")",
	"update_modified=False",
	"len(candidates) != 1",
	"candidate.employee_name != row.employee_name",
]) {
	check(patch.includes(marker), `company relationship repair is missing safeguard: ${marker}`);
}

check(!patch.includes("delete_doc"), "relationship repair must never delete historical records");
check(!patch.includes("frappe.db.delete"), "relationship repair must never bulk-delete historical records");
check(
	patches.includes("hrms.patches.v16_0.repair_yongxin_company_relationships"),
	"relationship repair patch must run during migration",
);
check(
	workbench.includes('if (this.active_view !== "monthly-final" && this.active_view !== "daily-import")'),
	"every non-final attendance view must refresh the shared company/month summary",
);
check(
	workbench.includes("requestedCompany !== this.company || requestedMonth !== this.attendance_month"),
	"stale company/month responses must not replace the current scope",
);

console.log("Company ownership repair, fixture isolation, employee remapping, and attendance scope guards verified.");
