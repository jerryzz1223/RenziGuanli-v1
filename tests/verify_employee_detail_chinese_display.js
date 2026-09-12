const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
	path.join(root, "hrms", "hr", "page", "employee_detail", "employee_detail.js"),
	"utf8",
);

for (const marker of [
	'format_employee_field_value("cell_number", header.cell_number)',
	'format_employee_field_value("gender", header.gender)',
	'Male: "男"',
	'Female: "女"',
	'Other: "其他"',
	'["cell_number", "emergency_phone_number"].includes(fieldname)',
	'replace(/^\\+86[\\s-]?/, "")',
	'this.format_employee_field_value(field.fieldname, field.value)',
]) {
	if (!source.includes(marker)) {
		throw new Error(`员工档案中文展示约定缺失：${marker}`);
	}
}

console.log("员工档案性别中文与手机号国家码展示验证通过。");
