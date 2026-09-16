const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const registrationApi = fs.readFileSync(
	path.join(root, "hrms/hr/doctype/hrms_employee_registration/hrms_employee_registration.py"),
	"utf8",
);
const registrationPage = fs.readFileSync(path.join(root, "hrms/www/employee-registration.html"), "utf8");
const organizationApi = fs.readFileSync(
	path.join(root, "hrms/hr/page/organizational_chart/organizational_chart.py"),
	"utf8",
);
const organizationExportApi = fs.readFileSync(path.join(root, "hrms/api/organization_chart_export.py"), "utf8");
const organizationPage = fs.readFileSync(
	path.join(root, "hrms/hr/page/organizational_chart/organizational_chart.js"),
	"utf8",
);

assert(registrationApi.includes("business_departments(department_rows)"));
assert(registrationApi.includes("组是组织内分组，不是员工所属部门"));
assert(registrationPage.includes("部门/课别"));
assert(organizationApi.includes("organization_report_from_tree(payload.get(\"root\") or {})"));
assert(!organizationApi.match(/def get_organization_report[\s\S]*?business_departments\(_get_departments/));
assert(organizationExportApi.includes("_append_organization_report"));
assert(organizationExportApi.includes("organization_report_from_tree(root)"));
assert(organizationPage.includes("Excel 可编辑架构图及组织报表"));
console.log("business department scope verified");
