# Employee Field Template Design

## Goal

Build a real employee field template system for the Chinese HR workspace so the "员工属性设置" page controls which Employee fields appear on the new/edit Employee form. The feature must use Frappe's DocType, Custom Field, form script, and whitelisted API mechanisms instead of static HTML or fake data.

## Current State

The current "员工属性设置" page is a Frappe Page, but its data is stored only in JavaScript arrays. Adding a field only pushes an item into an in-memory list and shows an alert. Editing, disabling, and deleting fields only show a message instead of changing persisted state. The Employee form still renders the standard ERPNext Employee DocType fields and does not read any employee attribute template.

## Reference Logic

The reference page at `https://2haohr.com/company-center/settings/staff-info/attribute` uses a field management model with these ideas:

- Employee fields are grouped by business category, such as 在职信息, 个人信息, 联系信息, 工资社保, and 个税申报.
- System fields can be enabled, disabled, and displayed, but they are not deleted.
- Custom fields can be added under a category with field name, field description, field type, and optional search enablement.
- Supported custom field types include text, date, custom options, and long text.
- The settings page is not just a display surface; field settings affect employee detail and employee creation flows.

This project should follow the business logic above while keeping the Frappe visual style and Frappe data model.

## Architecture

Use a new backend configuration layer to persist the employee field template and expose it through whitelisted methods. Custom fields created from the settings page must become real Frappe `Custom Field` rows for the `Employee` DocType. The Employee form script will load the saved template and apply display rules with Frappe form APIs.

The settings page remains a Frappe Page at `staff-attribute-settings`, but it changes from a static template into an interactive configuration client that calls backend methods.

## Data Model

Create a Frappe-managed configuration model for employee field templates.

Recommended DocTypes:

- `HRMS Employee Field Template`
  - Single DocType.
  - Stores the active template version and global flags.

- `HRMS Employee Field Template Item`
  - Child table.
  - Stores one field row per template field.

Item fields:

- `category`: Select. Values: 在职信息, 个人信息, 联系信息, 工资社保, 个税申报.
- `field_label`: Data. Display label shown in settings.
- `fieldname`: Data. Actual Employee DocField or Custom Field name.
- `fieldtype`: Select. Values: Data, Date, Select, Small Text, Check, Link.
- `description`: Small Text.
- `source`: Select. Values: 系统, 自定义.
- `enabled`: Check.
- `search_enabled`: Check.
- `options`: Small Text. Used for Select fields.
- `insert_after`: Data. Target field placement on the Employee form.
- `idx`: Int. Display order.

System fields are seeded by code, not manually typed by users. Custom fields are created from the UI and linked back to the generated `fieldname`.

## Field Mapping

Initial category to Employee field mapping:

### 在职信息

- 工号 -> `employee_number` or `name`, depending on available Employee metadata.
- 公司 -> `company`
- 部门 -> `department`
- 职位 -> `designation`
- 上级主管 -> `reports_to`
- 工作性质 -> `employment_type`
- 入职日期 -> `date_of_joining`
- 状态 -> `status`

### 个人信息

- 姓名 -> `employee_name`
- 性别 -> `gender`
- 出生日期 -> `date_of_birth`
- 证件类型 -> `custom_identification_document_type` if no native field exists.
- 证件号码 -> `passport_number` when the existing field matches the required document number use case; otherwise create `custom_hrms_identification_number`.

### 联系信息

- 手机号 -> `cell_number`
- 公司邮箱 -> `company_email`
- 个人电子邮件 -> `personal_email`
- 地址 -> existing address fields where available, otherwise custom fields.
- 紧急联系人姓名 -> `person_to_be_contacted`
- 紧急电话 -> `emergency_phone_number`

### 工资社保

- 薪资结构 and payroll-related fields stay linked to existing payroll DocTypes where available.
- Custom payroll attributes are not part of phase one except when the user explicitly adds them through the new custom field dialog.

### 个税申报

- Use HRMS/payroll regional fields where available.
- Otherwise create real Employee custom fields.

## Settings Page Behavior

The "员工属性设置" page should provide:

- Top tabs: 员工属性, 员工档案材料, 自定义设置.
- Employee attribute category tabs: 在职信息, 个人信息, 联系信息, 工资社保, 个税申报.
- Field table columns: 字段名称, 字段描述, 来源, 操作.
- Primary action: 添加属性字段.
- Add custom field dialog:
  - 所属分类
  - 字段类型
  - 字段名称
  - 字段描述
  - 启用搜索
  - 自定义选项, only when field type is Select
  - 保存
  - 保存并继续添加
- System fields:
  - Can be enabled or disabled.
  - Cannot be deleted.
  - Can have editable display description where safe.
- Custom fields:
  - Can be created.
  - Can be disabled.
  - Can be edited for label, description, and search setting.
  - Deletion is not included in the first implementation phase unless the field has no data.

## Employee Form Behavior

On Employee form load:

- Fetch the active field template through a whitelisted method.
- Hide disabled optional fields with `frm.toggle_display(fieldname, false)`.
- Keep required Frappe fields visible enough to allow save.
- Keep system-required fields such as company, employee name, gender, date of birth, date of joining, and status available unless Frappe metadata marks them optional.
- Show custom fields created by the settings page in their configured section.
- Keep existing Frappe form validation and save behavior intact.

The first implementation should not rewrite the core Employee DocType JSON. It should use Custom Field and client form script behavior to minimize upgrade risk.

## Backend API

Add whitelisted methods in a focused module such as `hrms/hr/page/staff_attribute_settings/staff_attribute_settings.py` or `hrms/api/employee_field_template.py`:

- `get_employee_field_template()`
  - Returns categories, fields, enabled state, source, fieldtype, options, and search flag.

- `save_employee_field_template(items)`
  - Saves display settings for existing template items.
  - Validates categories, source, fieldtype, and field names.

- `create_employee_custom_field(category, field_label, fieldtype, description=None, options=None, search_enabled=False)`
  - Creates a real Frappe Custom Field for Employee.
  - Adds a matching template item.
  - Returns the created field metadata.

- `set_employee_template_field_enabled(fieldname, enabled)`
  - Enables or disables a template item.

## Safety Rules

- Do not delete system fields.
- Do not hide required fields if hiding them would prevent saving an Employee.
- Do not create duplicate custom fields with the same field label/category pair.
- Generate custom fieldnames with a stable prefix such as `custom_hrms_`.
- If a custom field already exists, reuse it instead of creating another field.
- Do not hard-code 2号人事 demo employees, phone numbers, salaries, or counts.

## Testing

Use test-first implementation:

- Add a verification test proving the settings page no longer relies only on in-memory arrays.
- Add a verification test proving the settings page calls whitelisted backend methods.
- Add a verification test proving Employee form script loads and applies the template.
- Add a Python unit test for custom field creation if the local Frappe test runner is available.
- Run the existing JavaScript verification tests after changes.

## Phase One Scope

Phase one includes:

- Real persistent employee field template.
- Real custom field creation for Employee.
- Employee form display rules based on the template.
- Updated settings page wired to backend methods.
- No full redesign of payroll, approval, training, or performance modules.
- No destructive delete for fields with existing data.

## Out Of Scope

- Full 2号人事 UI recreation.
- Importing 2号人事 demo data.
- Replacing the Employee DocType with a custom DocType.
- Pixel-perfect copy of the reference site.
- Removing core Frappe metadata from the database.
