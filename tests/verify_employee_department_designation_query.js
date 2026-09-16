const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const employeeForm = fs.readFileSync(path.join(root, "hrms/public/js/erpnext/employee.js"), "utf8");

for (const marker of [
	"setup_employee_designation_field(frm);",
	"department(frm)",
	"frm.set_query(\"designation\"",
	"get_designations_for_department",
	"filters: {",
	"department,",
	"company: frm.doc.company || \"永新\"",
	"__hrms_department_required__",
	"frm.set_value(\"designation\", \"\")",
]) {
	if (!employeeForm.includes(marker)) {
		throw new Error(`员工岗位部门联动缺少关键逻辑：${marker}`);
	}
}

console.log("Employee designation choices are scoped by the selected department.");
