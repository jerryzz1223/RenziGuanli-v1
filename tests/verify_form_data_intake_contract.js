const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "hrms/api/form_data_intake.py"), "utf8");
const page = fs.readFileSync(path.join(root, "hrms/hr/page/form_data_intake/form_data_intake.js"), "utf8");
const nav = fs.readFileSync(path.join(root, "hrms/public/js/hrms_top_nav.js"), "utf8");
const contextualActions = fs.readFileSync(path.join(root, "hrms/public/js/hrms_contextual_form_import.js"), "utf8");
const employeeList = fs.readFileSync(path.join(root, "hrms/public/js/erpnext/employee_list.js"), "utf8");
const onboardingList = fs.readFileSync(path.join(root, "hrms/hr/doctype/employee_onboarding/employee_onboarding_list.js"), "utf8");

const workbookSheets = [
	"模块", "花名册", "员工职务调动申请表", "人员职能资格认定表", "人事组员工劳动合同到期意愿调查表", "人事组员工辞职申请单", "26Q3组织架构图", "2026年度人员面试清单",
	"每日统计（钉钉导出）", "每日统计（修改后）", "出勤明细", "请假单（钉钉导出）", "出勤异常", "苹果树（钉钉导出）", "苹果树（修改后）", "考勤初稿", "考勤终稿（签字版）", "考勤终稿（财务版）",
	"薪资构成", "奖惩提报单（提交人事）", "奖惩提报单（提交财务）", "证书、多能工津贴名单", "全勤奖", "住房补贴终稿", "学历补贴", "宿舍费", "2606社保名单", "6月继续服务奖", "提案改善表", "离职人员薪资结算", "教育训练登记表", "证书管理清单", "年度工作总结及展望", "第一次260707",
];

for (const sheet of workbookSheets.slice(1)) {
	assert(api.includes(`"${sheet}"`), `source workbook sheet is not assigned: ${sheet}`);
}
assert(api.includes('FORM_IMPORT_BATCH_DOCTYPE = "HRMS Form Import Batch"'));
assert(api.includes('FORM_IMPORT_ROW_DOCTYPE = "HRMS Form Import Row"'));
assert(api.includes("def create_form_import_template_file(template_key: str)"));
assert(api.includes("def preview_form_import(file_url: str, template_key: str, company: str)"));
assert(api.includes("def import_form_workbook(file_url: str, template_key: str, company: str, notes: str = \"\")"));
assert(api.includes("缺少必填值"));
assert(api.includes("未匹配到当前公司在职员工工号"));
assert(api.includes('"department_name": department'), "Form imports must resolve the human-facing Department name, not only the internal Frappe link value.");
assert(api.includes("Spreadsheet templates use the human-facing department name"), "Department display-name matching must remain documented in the import contract.");
assert(api.includes("def _department_display_name(department):"), "Imports must expose a business-facing Department name without Frappe's suffix.");
assert(api.includes("def _matches_department_display_name(department, business_name):"), "Imports must verify business department names against the employee's current department link.");
assert(api.includes("current_department = frappe.db.get_value(\"Employee\", employee, \"department\")"), "Employee-linked department fallback is required for legacy Department metadata.");
assert(api.includes("签核型表单"));
assert(page.includes("create_form_import_template_file"));
assert(page.includes("preview_form_import"));
assert(page.includes("import_form_workbook"));
assert(page.includes("employee-roster-import"));
assert(page.includes("download_employee_import_template"));
assert(!nav.includes('label: "数据导入中心"'), "The retired unified import centre must not appear in the More navigation.");
assert(contextualActions.includes("window.hrmsFormImport"));
assert(contextualActions.includes("reset_action_button"), "Contextual import buttons must reset after cancel/failure.");
assert(contextualActions.includes('window.addEventListener("focus", reset_when_focus_returns'), "File chooser cancel must restore import button state when focus returns.");
assert(contextualActions.includes(".finally(reset_when_focus_returns)"), "Import action promises must restore button state after opening or failing.");
assert(contextualActions.includes('"Employee Transfer"'));
assert(contextualActions.includes('"Training Event"'));
assert(contextualActions.includes('"Appraisal"'));
assert(contextualActions.includes('"Employee Onboarding"'));
assert(contextualActions.includes("HRMS Form Import Row"));
assert(contextualActions.includes("导入入职衔接表"));
assert(employeeList.includes('__("表单导入")'));
assert(employeeList.includes('"employee_roster"'));
assert(api.includes('"target_doctype": "Employee Transfer"'));
for (const marker of [
	'EMPLOYEE_ONBOARDING_TEMPLATE_KEY = "employee_onboarding"',
	'"label": "员工入职衔接"',
	'"target_doctype": "Employee Onboarding"',
	"def _onboarding_import_context(data, company):",
	"def ensure_default_employee_onboarding_template(company: str):",
	'"job_applicant": onboarding.applicant.name',
	'"job_offer": onboarding.offer.name',
	'"employee_onboarding_template": template.name',
]) assert(api.includes(marker), `Onboarding import flow is missing: ${marker}`);
for (const marker of ["管理入职任务规则", "创建标准任务清单", "发起入职办理", "Employee Onboarding Template"]) {
	assert(onboardingList.includes(marker), `Onboarding rule management entry is missing: ${marker}`);
}
for (const marker of ["已接受候选人", "已接受 Offer", "入职任务清单", "已在员工花名册中的人员不要重复办理入职"]) {
	assert(onboardingList.includes(marker), `Onboarding start guidance is missing: ${marker}`);
}
for (const marker of ["frappe.show_alert", "已创建标准入职规则", "已打开现有入职规则"]) {
	assert(onboardingList.includes(marker), `Onboarding rule feedback is missing: ${marker}`);
}
assert(!onboardingList.includes('filters: [["boarding_status", "=", "Pending"]]'), "Onboarding list must not hide completed or draft records by default.");

console.log("form data intake contract verified: all workbook source sheets assigned, template/preview/import routes wired");
