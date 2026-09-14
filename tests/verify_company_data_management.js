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
check(api.includes("MONTHLY_CLEANUP_SCOPES"), "cleanup must use explicit per-doctype business month rules");
check(api.includes("_require_cleanup_month"), "cleanup month must be mandatory and validated");
check(api.includes('"cleanup_month": cleanup_month'), "cleanup preview token must bind the selected month");
check(api.includes('"employees"'), "employee roster must be an explicit cleanup module");
check(api.includes('"risk": "critical"'), "employee roster must be marked critical risk");
check(api.includes("preview_company_data_cleanup"), "cleanup must have a preview endpoint");
check(api.includes("execute_company_data_cleanup"), "cleanup must have an execution endpoint");
check(api.includes("plan_token"), "cleanup must bind execution to its preview");
check(api.includes("_employee_link_blockers"), "employee cleanup must preview external linked records");
check(api.includes("_record_scope_explanation"), "cleanup counts must explain their company scope");
check(api.includes('"scope_reason"'), "cleanup catalog must return a reason for every counted record type");
check(api.includes("CLEANUP_RECORD_LABELS"), "cleanup breakdown must use understandable business labels");
for (const doctype of [
	"HRMS Employee Contribution Change",
	"HRMS Apple Tree History Summary",
	"Cross Department Support Capability",
	"HRMS Payroll Manual Adjustment",
]) {
	check(api.includes(doctype), `${doctype} must be part of the cleanup catalog`);
	check(api.split(doctype).length >= 3, `${doctype} must be cataloged and approved for bounded cleanup`);
}
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
check(page.includes("清除已选数据"), "cleanup cards must keep a visible execution action in their header");
check(page.includes("canExecuteCleanup"), "header cleanup action must remain blocked until preview passes");
check(page.includes('data-cleanup-month'), "cleanup center must expose a month selector above module cards");
check(page.includes("cleanup_month: state.cleanupMonth"), "module preview must send the selected month");
check(page.includes("cleanup_month: preview.cleanup_month"), "execution must reuse the previewed month");
check(page.includes("不可按月清除"), "persistent master modules must be visibly excluded from monthly cleanup");
check(!page.includes("输入确认文本并执行清理"), "cleanup execution must not be hidden below the preview table");
check(page.includes("我已确认公司和数据范围"), "page must require explicit acknowledgement");
check(page.includes("一键加入前置模块"), "page must help resolve selectable employee dependencies");
check(page.includes("数量为什么会出现？"), "page must introduce the count explanation feature");
check(page.includes('data-explain-module'), "each cleanup module must expose its data breakdown");
check(page.includes("为什么计入"), "cleanup preview must display the record scope reason");
check(!page.includes('data-action="monthly-payroll-reset"'), "payroll monthly cleanup must use the unified module selector");
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
