const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const api = fs.readFileSync(path.join(root, "hrms/api/form_data_intake.py"), "utf8");
const page = fs.readFileSync(path.join(root, "hrms/hr/page/form_data_intake/form_data_intake.js"), "utf8");
const nav = fs.readFileSync(path.join(root, "hrms/public/js/hrms_top_nav.js"), "utf8");
const contextualActions = fs.readFileSync(path.join(root, "hrms/public/js/hrms_contextual_form_import.js"), "utf8");
const employeeList = fs.readFileSync(path.join(root, "hrms/public/js/erpnext/employee_list.js"), "utf8");

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
assert(api.includes("签核型表单"));
assert(page.includes("create_form_import_template_file"));
assert(page.includes("preview_form_import"));
assert(page.includes("import_form_workbook"));
assert(page.includes("employee-roster-import"));
assert(page.includes("download_employee_import_template"));
assert(nav.includes('"form-data-intake"'));
assert(contextualActions.includes("window.hrmsFormImport"));
assert(contextualActions.includes('"Employee Transfer"'));
assert(contextualActions.includes('"Training Event"'));
assert(contextualActions.includes('"Appraisal"'));
assert(contextualActions.includes("HRMS Form Import Row"));
assert(employeeList.includes('__("表单导入")'));
assert(employeeList.includes('"employee_roster"'));
assert(api.includes('"target_doctype": "Employee Transfer"'));

console.log("form data intake contract verified: all workbook source sheets assigned, template/preview/import routes wired");
