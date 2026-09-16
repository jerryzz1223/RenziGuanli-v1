const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const employeeForm = fs.readFileSync(path.join(root, "hrms/public/js/erpnext/employee.js"), "utf8");

for (const marker of [
	"setup_employee_company_field(frm);",
	'frm.set_value("company", "永新")',
	'frm.set_df_property("company", "hidden", 1)',
	'frm.set_df_property("company", "reqd", false)',
	'frm.toggle_display("company", false)',
]) {
	if (!employeeForm.includes(marker)) {
		throw new Error(`员工表单缺少公司字段单公司处理：${marker}`);
	}
}

if (employeeForm.indexOf("setup_employee_company_field(frm);") === employeeForm.lastIndexOf("setup_employee_company_field(frm);")) {
	throw new Error("公司字段隐藏逻辑必须在普通刷新和字段模板异步刷新后都执行。");
}

console.log("Employee company field defaults to Yongxin and stays hidden in the form.");
