const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

const apiPath = path.join(root, "hrms", "api", "employee_field_template.py");
const settingsPagePath = path.join(
	root,
	"hrms",
	"hr",
	"page",
	"staff_attribute_settings",
	"staff_attribute_settings.js",
);
const settingsCenterPath = path.join(
	root,
	"hrms",
	"hr",
	"page",
	"hr_settings_center",
	"hr_settings_center.js",
);
const employeeFormPath = path.join(root, "hrms", "public", "js", "erpnext", "employee.js");
const employeeTabMigrationPath = path.join(
	root,
	"hrms",
	"patches",
	"v16_0",
	"convert_employee_tabs_to_sections.py",
);
const employeeFormCssPath = path.join(root, "hrms", "public", "css", "hrms_top_nav.css");
const templateJsonPath = path.join(
	root,
	"hrms",
	"hr",
	"doctype",
	"hrms_employee_field_template",
	"hrms_employee_field_template.json",
);
const itemJsonPath = path.join(
	root,
	"hrms",
	"hr",
	"doctype",
	"hrms_employee_field_template_item",
	"hrms_employee_field_template_item.json",
);

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

const templateJson = JSON.parse(read(templateJsonPath));
const itemJson = JSON.parse(read(itemJsonPath));
const api = read(apiPath);
const settingsPage = read(settingsPagePath);
const settingsCenter = read(settingsCenterPath);
const employeeForm = read(employeeFormPath);
const employeeTabMigration = read(employeeTabMigrationPath);
const employeeFormCss = read(employeeFormCssPath);

if (templateJson.name !== "HRMS Employee Field Template" || templateJson.issingle !== 1) {
	throw new Error("HRMS Employee Field Template must be a Single DocType.");
}

if (itemJson.name !== "HRMS Employee Field Template Item" || itemJson.istable !== 1) {
	throw new Error("HRMS Employee Field Template Item must be a child table DocType.");
}

const fieldtypeField = itemJson.fields.find((field) => field.fieldname === "fieldtype");
for (const supportedFieldtype of ["Currency", "Int", "Text Editor", "Attach Image"]) {
	if (!fieldtypeField?.options?.includes(supportedFieldtype)) {
		throw new Error(`Template item fieldtype must allow Employee ${supportedFieldtype} fields.`);
	}
}

for (const fieldname of [
	"category",
	"field_label",
	"fieldname",
	"fieldtype",
	"description",
	"source",
	"enabled",
	"required",
	"search_enabled",
	"options",
	"insert_after",
	"aliases",
	"import_enabled",
	"export_enabled",
	"form_visible",
	"detail_visible",
	"roster_visible",
	"detail_block",
	"detail_block_order",
	"record_type",
]) {
	if (!itemJson.fields.some((field) => field.fieldname === fieldname)) {
		throw new Error(`Template item missing field: ${fieldname}`);
	}
}

for (const marker of [
	"@frappe.whitelist()",
	"get_employee_field_template",
	"save_employee_field_template",
	"create_employee_custom_field",
	"set_employee_template_field_enabled",
	"download_employee_import_template",
	"get_employee_import_export_schema",
	"get_employee_field_center",
	"get_hr_settings_center",
	"save_employee_field_center",
	"_field_aliases_for_row",
	"_template_row_bool",
	"_field_flag_enabled",
	"_get_detail_block_definitions",
	"parse_employee_roster_file",
	"download_employee_roster_export",
	"build_employee_import_template",
	"get_configurable_employee_fields",
	"make_property_setter",
	"_sync_employee_field_required_property",
	"_template_row_int",
	"row.get(\"required\")",
	"frappe.get_meta(EMPLOYEE_DOCTYPE)",
	"getattr(field, \"insert_after\", None)",
	"NON_CONFIGURABLE_FIELDTYPES",
	"DEFAULT_FIELD_CATEGORY_BY_SECTION",
	"Custom Field",
	"custom_hrms_",
	"EMPLOYEE_TEMPLATE_CATEGORIES",
	"provide_binary_file",
	"员工导入模板.xlsx",
	"员工花名册导出.xlsx",
	"员工花名册",
	"枚举字段",
	"填写说明",
	"COMPANY_ROSTER_CUSTOM_FIELDS",
	"COMPANY_ROSTER_FIELD_ORDER",
	"教育信息",
	"合同保险",
	"required",
	"aliases",
	"import_enabled",
	"export_enabled",
	"form_visible",
	"detail_visible",
	"roster_visible",
	"detail_block",
	"record_type",
]) {
	mustInclude(api, marker, `Employee field template API missing marker: ${marker}`);
}

if (api.includes("EMPLOYEE_SYSTEM_FIELDS = [")) {
	throw new Error("Employee field template must not rely on a hand-written subset of Employee fields.");
}

if (api.includes("not row.required")) {
	throw new Error("Template rows may come from databases that have not migrated the required child-field yet; use row.get(\"required\") instead of direct attribute access.");
}

for (const marker of [
	"EMPLOYEE_INTERNAL_FIELDNAMES",
	"_is_employee_internal_field",
	"_apply_employee_internal_field_policy",
	"naming_series",
]) {
	mustInclude(api, marker, `Internal Employee document fields must stay out of HR field governance: ${marker}`);
}

if (!employeeForm.includes('frm.toggle_display("naming_series", false);')) {
	throw new Error("Employee naming series must stay hidden; the HR-visible identifier is work number plus name.");
}

for (const marker of [
	'"fieldname": "custom_native_place",\n\t\t"fieldtype": "Select",',
	'"fieldname": "custom_ethnicity",\n\t\t"fieldtype": "Select",',
	'"fieldname": "custom_ethnicity",',
	"ETHNICITY_VALUE_ALIASES",
	'"汉": "汉族",',
	"_normalise_ethnicity_value",
	"员工籍贯所属的中国省级行政区",
	"中国 56 个民族",
	"北京市",
	"台湾省",
	"汉族",
	"基诺族",
	"LEGACY_ETHNICITY_VALUE_MAP",
	"_normalise_employee_ethnicity_values",
	"ensure_employee_china_profile_selectors",
]) {
	mustInclude(api, marker, `Chinese employee profile selector is missing marker: ${marker}`);
}

const importValueNormaliser = api.match(/def _normalise_import_value\(fieldname, value, field\):([\s\S]*?)\n\ndef _get_default_company/)?.[1] || "";
if (!importValueNormaliser.includes('if fieldname == "custom_ethnicity":') || !importValueNormaliser.includes("return _normalise_ethnicity_value(value)")) {
	throw new Error("花名册导入必须将“汉”规范为民族选择器的“汉族”值。");
}

if (api.includes('"fieldtype": "Autocomplete",')) {
	throw new Error("Frappe does not support Autocomplete employee custom fields; use Select.");
}

for (const marker of [
	"frappe.pages[\"hr-settings-center\"]",
	"字段管理中心",
	"字段别名配置",
	"导入映射设置",
	"详情资料块设置",
	"save_employee_field_center",
	"aliases",
	"import_enabled",
	"export_enabled",
	"form_visible",
	"detail_visible",
	"detail_block",
]) {
	mustInclude(settingsCenter, marker, `设置中心 must expose field governance behavior: ${marker}`);
}

for (const marker of [
	"hrms.api.employee_field_template.get_employee_field_template",
	"hrms.api.employee_field_template.create_employee_custom_field",
	"hrms.api.employee_field_template.save_employee_field_template",
	"hrms.api.employee_field_template.set_employee_template_field_enabled",
	"hrms.api.employee_field_template.download_employee_import_template",
	"智能导入",
	"自定义导出",
	"下载 Excel 模板",
	"网页填写员工",
	"保存并继续添加",
	"启用搜索",
	"是否必填",
	"自定义选项",
	"field_label: values.field_label",
	"required: values.required",
	"frappe.new_doc(\"Employee\")",
]) {
	mustInclude(settingsPage, marker, `员工属性设置 page must call backend template API: ${marker}`);
}

if (settingsPage.includes("category.fields.push([")) {
	throw new Error("员工属性设置 must not mutate only in-memory category.fields.");
}

if (settingsPage.includes("fieldname: \"field_label\",\n\t\t\t\t\tfieldtype: \"Data\",\n\t\t\t\t\tlabel: __(\"字段名称\"),\n\t\t\t\t\tdefault: field.field_label,\n\t\t\t\t\tread_only: 1")) {
	throw new Error("员工属性设置 must allow configured field labels to be renamed.");
}

for (const marker of [
	"apply_employee_field_template",
	"__hrms_employee_template_request_id",
	"prepare_employee_save_defaults",
	"remember_employee_list_return",
	"return_to_employee_roster_after_insert",
	"setup_employee_form_defaults",
	"setup_employee_gender_field",
	"EMPLOYEE_GENDER_VALUES",
	"hrms.api.employee_field_template.get_employee_field_template",
	"frm.toggle_display",
	"frm.set_df_property(field.fieldname, \"label\"",
	"frm.set_df_property(field.fieldname, \"reqd\"",
	"apply_configured_field_label",
	"apply_configured_field_required",
	"configured_field.enabled",
	"configured_field.required",
	"configured_field.form_visible",
	"field.fieldname",
	"configurable_template_fields",
	"managed_fieldnames.has",
	"field.fieldtype",
	"create_user_automatically",
	"frm.set_value(\"create_user_automatically\", 0)",
	"create_user_permission",
	"frappe.set_route(\"List\", \"Employee\")",
]) {
	mustInclude(employeeForm, marker, `Employee form must apply field template: ${marker}`);
}

if (employeeForm.includes('frm.toggle_display(field.fieldname, false);\n\t\t\t\t\treturn;')) {
	throw new Error("Employee form must not hide a field solely because a stale template response omits it.");
}

if (!employeeForm.includes("frm.__hrms_employee_template_request_id !== request_id")) {
	throw new Error("Employee form must ignore stale template responses during refresh.");
}

if (employeeForm.includes(".detach()") || employeeForm.includes(".remove()")) {
	throw new Error("Employee form must retain its one native control tree without moving or removing form pages.");
}

for (const marker of [
	"EMPLOYEE_TAB_FIELDNAMES",
	"frappe.db.delete",
	'"Property Setter"',
	'"fieldtype"',
	'"Section Break"',
	"frappe.clear_cache(doctype=EMPLOYEE_DOCTYPE)",
]) {
	mustInclude(employeeTabMigration, marker, `Employee tab metadata repair missing marker: ${marker}`);
}

if (employeeForm.includes("enable_employee_native_single_page") || employeeForm.includes("hrms-employee-single-page")) {
	throw new Error("Employee form must not use a second client-side page layout.");
}

for (const marker of [
	"show_employee_form_as_one_page",
	'$(frm.wrapper).addClass("hrms-employee-one-page")',
	"tab.wrapper.addClass(\"show active\")",
	"window.requestAnimationFrame",
]) {
	mustInclude(employeeForm, marker, `Employee native one-page display missing marker: ${marker}`);
}

mustInclude(
	employeeFormCss,
	"#employee-basic_details_tab",
	"Employee one-page display must remove the tab navigation bar.",
);
mustInclude(
	employeeFormCss,
	".hrms-employee-one-page .form-layout > .form-page.tab-pane",
	"Employee Select refresh must keep every native form pane visible.",
);

if (employeeForm.includes(".detach()") || employeeForm.includes(".remove()") || employeeFormCss.includes("display: contents !important")) {
	throw new Error("Employee one-page display must not move controls or flatten Frappe's grid containers.");
}

for (const marker of [
	'frm.set_query("gender"',
	'gender: ["in", EMPLOYEE_GENDER_VALUES]',
	'frm.set_df_property("gender", "only_select", 1)',
]) {
	mustInclude(employeeForm, marker, `Employee gender must use only the approved choices: ${marker}`);
}

console.log("Employee field template contract is wired to real Frappe configuration.");
