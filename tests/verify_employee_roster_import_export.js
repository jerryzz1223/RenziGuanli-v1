const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const apiPath = path.join(root, "hrms", "api", "employee_field_template.py");
const employeeListPath = path.join(root, "hrms", "public", "js", "erpnext", "employee_list.js");
const importJsonPath = path.join(root, "hrms", "hr", "page", "employee_roster_import", "employee_roster_import.json");
const importJsPath = path.join(root, "hrms", "hr", "page", "employee_roster_import", "employee_roster_import.js");
const exportJsonPath = path.join(root, "hrms", "hr", "page", "employee_roster_export", "employee_roster_export.json");
const exportJsPath = path.join(root, "hrms", "hr", "page", "employee_roster_export", "employee_roster_export.js");
const cssPath = path.join(root, "hrms", "public", "css", "hrms_top_nav.css");

function read(file) {
	if (!fs.existsSync(file)) {
		throw new Error(`Missing file: ${path.relative(root, file)}`);
	}
	return fs.readFileSync(file, "utf8");
}

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) {
		throw new Error(message || `Missing marker: ${marker}`);
	}
}

const api = read(apiPath);
const employeeList = read(employeeListPath);
const importJson = JSON.parse(read(importJsonPath));
const importJs = read(importJsPath);
const exportJson = JSON.parse(read(exportJsonPath));
const exportJs = read(exportJsPath);
const css = read(cssPath);

if (importJson.name !== "employee-roster-import" || importJson.title !== "智能花名册导入") {
	throw new Error("智能花名册导入 Page route/title is incorrect.");
}
if (exportJson.name !== "employee-roster-export" || exportJson.title !== "自定义导出") {
	throw new Error("自定义导出 Page route/title is incorrect.");
}

for (const marker of [
	"get_employee_import_export_schema",
	"parse_employee_roster_file",
	"preview_employee_roster_import",
	"import_employee_roster",
	"download_employee_roster_failed_rows",
	"download_employee_roster_export",
	"get_employee_export_records",
	"log_employee_export_record",
	"export_scope",
	"current_filters",
	"download_employee_import_template",
	"MULTI_RECORD_EXPORT_TABLE_MAP",
	"_make_employee_export_workbook",
	"_format_employee_export_value",
	"_safe_sheet_title",
	"员工花名册",
	"说明",
	"枚举字段",
	"MULTI_RECORD_EXPORT_CATEGORIES",
	"COMPANY_ROSTER_CUSTOM_FIELDS",
	"COMPANY_ROSTER_FIELD_ORDER",
	"EMPLOYEE_MINIMUM_IMPORT_REQUIRED_COLUMNS",
	"_is_employee_import_required_field",
	"custom_employee_code",
	"custom_contract_no",
	"_match_uploaded_headers",
	"HEADER_FIELD_ALIASES",
	"现职务",
	"职位",
	"上级主管",
	"直接上级",
	"职级",
	"员工等级",
	"分支机构",
	"reports_to",
	"grade",
	"branch",
	"_field_aliases_for_row",
	"_field_flag_enabled(row, \"import_enabled\"",
	"_field_flag_enabled(row, \"export_enabled\"",
	"现居住地",
	"_read_xlsx_first_sheet_rows",
	"_build_headers_from_rows",
	"_score_header_candidate",
	"_detect_uploaded_headers(rows, fields)",
	"_column_name_to_index",
	"_ensure_employee_base_records",
	"_validate_employee_import_row",
	"_make_employee_roster_failure_workbook",
	"_find_or_create_department",
	"_find_or_create_designation",
	"EMPLOYEE_ROSTER_QUICK_EDIT_FIELDS",
	"_find_or_create_employment_type",
	"_find_or_create_gender",
	"match_by",
	"custom_employee_code",
	"passport_number",
	"cell_number",
	"fieldname",
	"field_label",
	"failed_rows",
	"EXCEL_ERROR_VALUES",
	"GENDER_VALUE_ALIASES",
]) {
	mustInclude(api, marker, `Employee roster API missing marker: ${marker}`);
}

for (const marker of [
	'if fieldname == "department":',
	"department_names = _get_department_display_names",
	"department_name = _strip_department_company_suffix(value)",
	'headers = ["工号", "员工姓名"]',
	"employee_code.get(row.parent, row.parent)",
]) {
	mustInclude(api, marker, `导出必须使用业务部门名和工号，不能泄露内部 Employee/Department 名称：${marker}`);
}

for (const marker of [
	'"first_name": "姓名"',
	'"custom_employee_code": "工号"',
	'"department": "部门"',
	'"designation": "岗位"',
	'"date_of_joining": "入职日期"',
	'"cell_number": "手机号码"',
]) {
	mustInclude(api, marker, `首版最小导入字段集缺少: ${marker}`);
}

if (api.includes("if field.get(\"required\") and fieldname in meta_fields and _is_blank_value(values.get(fieldname))")) {
	throw new Error("导入行校验不能直接复用字段中心 required，否则会导致整表失败。");
}

if (api.includes("if _is_blank_value(raw_value) and field.get(\"required\")")) {
	throw new Error("导入值解析不能把字段中心所有必填项当作逐行必填项，否则空白的可选档案字段会导致整行失败。");
}

for (const marker of [
	"_is_employee_import_required_field(fieldname, field)",
	"fieldname in meta_fields",
	"fieldname not in deferred_fields",
]) {
	mustInclude(api, marker, `导入行校验必须只校验首版最小导入字段，并支持暂缓填写：${marker}`);
}

mustInclude(api, '"employee_code": ("custom_employee_code",)', "工号必须保持为跨模块稳定匹配键。");

for (const marker of [
	'"出生年月": "date_of_birth"',
	'"直/间接": "custom_direct_indirect"',
	'"紧急联系人": "person_to_be_contacted"',
	'"院校": "custom_graduation_school"',
	"_derive_identity_card_values",
	'"试用期": "Probation"',
	'"返聘": "Retainer"',
]) {
	mustInclude(api, marker, `花名册基线字段映射或身份证推导缺失: ${marker}`);
}

for (const marker of [
	"frappe.set_route(\"employee-roster-import\")",
	"frappe.set_route(\"employee-roster-export\")",
]) {
	mustInclude(employeeList, marker, `Employee list must route import/export to custom page: ${marker}`);
}

for (const marker of [
	"frappe.pages[\"employee-roster-import\"]",
	"手动匹配字段",
	"导入映射设置",
	"批量添加员工",
	"批量修改信息",
	"覆盖当前花名册",
	"start-replace",
	"frappe.confirm",
	"导入花名册",
	"上传文件",
	"匹配表头",
	"预览导入结果",
	"查看导入结果",
	"frappe.ui.FileUploader",
	"hrms.api.employee_field_template.parse_employee_roster_file",
	"hrms.api.employee_field_template.preview_employee_roster_import",
	"hrms.api.employee_field_template.import_employee_roster",
	"hrms.api.employee_field_template.download_employee_roster_failed_rows",
	"hrms.api.employee_field_template.download_employee_import_template",
	"match_by",
	"按工号",
	"按身份证",
	"按手机号",
	"下载失败行",
	"下载错误行及修改建议",
	"download-preview-failed",
	"Excel 位置",
	"修改方法",
	"编辑本行",
	"edit-error-row",
	"row_overrides",
	"保存并重新校验",
	"仅显示需要人工校正的数据",
	"暂不填写时可输入“-”",
	'fieldtype: "Data"',
	"继续导入其他花名册",
	"当前内容",
	"仅显示需要人工校正的数据",
	"render_result",
]) {
	mustInclude(importJs, marker, `Import page missing behavior: ${marker}`);
}

const restartHandler = importJs.match(/if \(action === "restart"\) \{([\s\S]*?)\n\t\t\}/)?.[1] || "";
if (!restartHandler.includes('state.mode = "";') || !restartHandler.includes('state.match_by = "employee_code";') || !restartHandler.includes("render_landing();")) {
	throw new Error("继续导入必须先回到新增/修改方式选择页，不能沿用上一次导入模式。");
}

mustInclude(api, "_get_employee_roster_preview_code", "预览列表必须使用业务工号，而不是 Frappe 内部 Employee 名称。");
mustInclude(api, '"employee_code": _get_employee_roster_preview_code(values, existing)', "预览列表必须返回员工工号。");

for (const marker of ["_excel_cell_reference", "_employee_import_fix_suggestion", "_is_employee_import_deferred_placeholder", "EMPLOYEE_IMPORT_NON_DEFERRABLE_FIELDS", '"suggestion"', '"excel_cell"', "row_overrides"]) {
	mustInclude(api, marker, `错误行必须提供定位与修改建议：${marker}`);
}

for (const marker of [
	'"replace"',
	"_get_employee_roster_replace_candidates",
	'"archived"',
	'doc.status = "Left"',
]) {
	mustInclude(api, marker, `覆盖当前花名册缺少安全同步行为：${marker}`);
}

mustInclude(
	api,
	'if mode == "insert":\n\t\t\treturn "skip", existing',
	"后续新增人员时，已有工号必须跳过，不能覆盖现有资料。",
);

if (importJs.includes("下一步将接入批量写入员工资料。当前已完成文件上传和表头匹配。")) {
	throw new Error("导入第二步不能停留在占位提示，必须调用后端导入并进入结果页。");
}

for (const marker of [
	"frappe.pages[\"employee-roster-export\"]",
	"get_employee_import_export_schema",
	"导出模板设置",
	"保存导出模板",
	"员工属性",
	"全部员工",
	"当前筛选结果",
	"导出记录",
	"保存为人事报表",
	"排序并导出",
	"multi_record_categories",
	"selected_tables",
	"data-table-name",
	"download_employee_roster_export",
]) {
	mustInclude(exportJs, marker, `Export page missing behavior: ${marker}`);
}

if (exportJs.includes('type="checkbox" disabled')) {
	throw new Error("工作表分类 checkbox 不应禁用，必须可以选择。");
}

if (!exportJs.includes("${render_multi_record_categories()}") || exportJs.includes("${render_active_fields()}\n\t\t\t\t\t\t${render_multi_record_categories()}")) {
	throw new Error("工作表分类必须作为公共区域渲染，不能放在每个字段分类内容里。");
}

for (const marker of [
	".hrms-import-landing",
	".hrms-upload-box",
	".hrms-import-steps",
	".hrms-export-layout",
	".hrms-export-field-grid",
	".hrms-export-repeat-section",
	".hrms-export-footer",
]) {
	mustInclude(css, marker, `Employee roster import/export CSS missing marker: ${marker}`);
}

console.log("Employee roster import/export pages are wired to template-driven Frappe APIs.");
