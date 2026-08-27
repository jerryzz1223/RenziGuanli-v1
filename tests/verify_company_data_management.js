const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "hrms/api/data_operations.py"), "utf8");
const page = fs.readFileSync(
	path.join(root, "hrms/hr/page/hrms_data_operations/hrms_data_operations.js"),
	"utf8",
);
const company = fs.readFileSync(path.join(root, "hrms/public/js/erpnext/company.js"), "utf8");
const nav = fs.readFileSync(path.join(root, "hrms/public/js/hrms_top_nav.js"), "utf8");
const settings = fs.readFileSync(
	path.join(root, "hrms/hr/page/hr_settings_center/hr_settings_center.js"),
	"utf8",
);
const cleanupLog = fs.readFileSync(
	path.join(root, "hrms/hr/doctype/hrms_data_cleanup_log/hrms_data_cleanup_log.json"),
	"utf8",
);
const departmentIdentity = fs.readFileSync(
	path.join(root, "hrms/overrides/department_identity.py"),
	"utf8",
);

function check(condition, message) {
	if (!condition) throw new Error(message);
}

check(api.includes("DATA_CLEANUP_MODULES"), "cleanup catalog must be server-owned");
check(api.includes('"employees"'), "employee roster must be an explicit cleanup module");
check(api.includes('"risk": "critical"'), "employee roster must be marked critical risk");
check(api.includes("preview_company_data_cleanup"), "cleanup must have a preview endpoint");
check(api.includes("execute_company_data_cleanup"), "cleanup must have an execution endpoint");
check(api.includes("plan_token"), "cleanup must bind execution to its preview");
check(api.includes("_employee_link_blockers"), "employee cleanup must preview external linked records");
check(api.includes("HRMS Data Cleanup Log"), "successful cleanup must be audited");
check(api.includes("frappe.db.savepoint"), "cleanup must create an atomic savepoint");
check(api.includes("frappe.db.rollback(save_point=savepoint)"), "cleanup must roll back on failure");
check(api.includes("previous_in_test = frappe.in_test"), "large roster cleanup must avoid filling the background queue");
check(!api.includes('TEST_COMPANY = "TEST-HRMS"'), "durable cleanup must not hardcode TEST-HRMS");
check(!/"doctypes"\s*:\s*\([^)]*"Company"/.test(api), "Company must never be a cleanup target");
check(!/"doctypes"\s*:\s*\([^)]*"Department"/.test(api), "Department must never be a cleanup target");

check(page.includes("公司与数据空间"), "page must expose company management");
check(page.includes("永久保留"), "page must explain protected data");
check(page.includes('data-action="preview-cleanup"'), "page must require cleanup preview");
check(page.includes('data-action="execute-cleanup"'), "page must expose guarded execution");
check(page.includes("我已确认公司和数据范围"), "page must require explicit acknowledgement");
check(page.includes("一键加入前置模块"), "page must help resolve selectable employee dependencies");
check(page.includes("Promise.allSettled"), "queue failure must not block company management");
check(page.includes("page.body[0] || page.body"), "page events must bind to the real DOM element");

check(nav.includes("reload: reloadCompanyContext"), "company context must expose refresh after company creation");
check(company.includes("hrmsCompanyContext?.reload"), "Company save must refresh company context");
check(settings.includes("公司与数据空间管理"), "settings center must link to company data management");
check(cleanupLog.includes('"company_code"'), "audit log must keep a stable company snapshot");
check(!cleanupLog.includes('"options": "Company"'), "audit log must not block later Company deletion");
check(departmentIdentity.includes("get_department_document_name"), "Department links must use stable business names");
check(departmentIdentity.includes("without a company suffix"), "Department links must not append a company abbreviation");
check(departmentIdentity.includes('frappe.db.get_value("Department", target_name'), "Department business names must remain globally unambiguous");

console.log("Company data management contract verified.");
