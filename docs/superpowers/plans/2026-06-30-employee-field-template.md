# Employee Field Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "员工属性设置" persist a real employee field template, create real Employee custom fields, and apply the template to the Employee form.

**Architecture:** Add a small backend API around a Single DocType template plus a child table of field items. Keep Frappe's native Employee DocType and Form route, create new custom attributes through Frappe `Custom Field`, and use `employee.js` to hide/show fields based on the saved template.

**Tech Stack:** Frappe DocType JSON, Python whitelisted methods, Frappe Custom Field, Frappe Page JavaScript, Employee Form JavaScript, Node verification tests.

---

## File Structure

- Create `tests/verify_employee_field_template.js`: contract test for the field template implementation.
- Create `hrms/hr/doctype/hrms_employee_field_template/hrms_employee_field_template.json`: Single DocType storing active field template rows.
- Create `hrms/hr/doctype/hrms_employee_field_template/hrms_employee_field_template.py`: Document class for the Single DocType.
- Create `hrms/hr/doctype/hrms_employee_field_template/__init__.py`: package marker.
- Create `hrms/hr/doctype/hrms_employee_field_template_item/hrms_employee_field_template_item.json`: child table for one field template item.
- Create `hrms/hr/doctype/hrms_employee_field_template_item/hrms_employee_field_template_item.py`: child table Document class.
- Create `hrms/hr/doctype/hrms_employee_field_template_item/__init__.py`: package marker.
- Create `hrms/api/employee_field_template.py`: whitelisted API and system field seed logic.
- Modify `hrms/hr/page/staff_attribute_settings/staff_attribute_settings.js`: replace in-memory mutation with backend calls.
- Modify `hrms/public/js/erpnext/employee.js`: load and apply field template on Employee form refresh.
- Modify `hrms/hooks.py`: bump asset query strings after JS changes.
- Modify `tests/verify_shell_and_staff_attributes.js`: update expectations from static template to backend-wired field template.

## Implementation Tasks

### Task 1: Add Failing Contract Test

**Files:**
- Create: `tests/verify_employee_field_template.js`

- [ ] **Step 1: Write the failing test**

Create `tests/verify_employee_field_template.js`:

```javascript
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
const employeeFormPath = path.join(root, "hrms", "public", "js", "erpnext", "employee.js");
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
const employeeForm = read(employeeFormPath);

if (templateJson.name !== "HRMS Employee Field Template" || templateJson.issingle !== 1) {
	throw new Error("HRMS Employee Field Template must be a Single DocType.");
}

if (itemJson.name !== "HRMS Employee Field Template Item" || itemJson.istable !== 1) {
	throw new Error("HRMS Employee Field Template Item must be a child table DocType.");
}

for (const fieldname of [
	"category",
	"field_label",
	"fieldname",
	"fieldtype",
	"description",
	"source",
	"enabled",
	"search_enabled",
	"options",
	"insert_after",
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
	"Custom Field",
	"custom_hrms_",
	"EMPLOYEE_TEMPLATE_CATEGORIES",
	"EMPLOYEE_SYSTEM_FIELDS",
]) {
	mustInclude(api, marker, `Employee field template API missing marker: ${marker}`);
}

for (const marker of [
	"hrms.api.employee_field_template.get_employee_field_template",
	"hrms.api.employee_field_template.create_employee_custom_field",
	"hrms.api.employee_field_template.save_employee_field_template",
	"hrms.api.employee_field_template.set_employee_template_field_enabled",
	"保存并继续添加",
	"启用搜索",
	"自定义选项",
]) {
	mustInclude(settingsPage, marker, `员工属性设置 page must call backend template API: ${marker}`);
}

if (settingsPage.includes("category.fields.push([")) {
	throw new Error("员工属性设置 must not mutate only in-memory category.fields.");
}

for (const marker of [
	"apply_employee_field_template",
	"hrms.api.employee_field_template.get_employee_field_template",
	"frm.toggle_display",
	"field.enabled",
	"field.fieldname",
]) {
	mustInclude(employeeForm, marker, `Employee form must apply field template: ${marker}`);
}

console.log("Employee field template contract is wired to real Frappe configuration.");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node tests/verify_employee_field_template.js
```

Expected: fails with a missing DocType/API file error.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/verify_employee_field_template.js
git commit -m "test: specify employee field template contract"
```

### Task 2: Add Template DocTypes

**Files:**
- Create: `hrms/hr/doctype/hrms_employee_field_template/hrms_employee_field_template.json`
- Create: `hrms/hr/doctype/hrms_employee_field_template/hrms_employee_field_template.py`
- Create: `hrms/hr/doctype/hrms_employee_field_template/__init__.py`
- Create: `hrms/hr/doctype/hrms_employee_field_template_item/hrms_employee_field_template_item.json`
- Create: `hrms/hr/doctype/hrms_employee_field_template_item/hrms_employee_field_template_item.py`
- Create: `hrms/hr/doctype/hrms_employee_field_template_item/__init__.py`

- [ ] **Step 1: Create `HRMS Employee Field Template` Single DocType**

Use this JSON structure:

```json
{
  "actions": [],
  "allow_rename": 0,
  "creation": "2026-06-30 00:00:00.000000",
  "doctype": "DocType",
  "editable_grid": 1,
  "engine": "InnoDB",
  "field_order": [
    "enabled",
    "template_items"
  ],
  "fields": [
    {
      "default": "1",
      "fieldname": "enabled",
      "fieldtype": "Check",
      "label": "启用员工字段模板"
    },
    {
      "fieldname": "template_items",
      "fieldtype": "Table",
      "label": "字段模板项",
      "options": "HRMS Employee Field Template Item"
    }
  ],
  "issingle": 1,
  "links": [],
  "modified": "2026-06-30 00:00:00.000000",
  "modified_by": "Administrator",
  "module": "HR",
  "name": "HRMS Employee Field Template",
  "owner": "Administrator",
  "permissions": [
    {
      "create": 1,
      "delete": 1,
      "email": 1,
      "print": 1,
      "read": 1,
      "role": "System Manager",
      "share": 1,
      "write": 1
    },
    {
      "create": 1,
      "email": 1,
      "print": 1,
      "read": 1,
      "role": "HR Manager",
      "share": 1,
      "write": 1
    }
  ],
  "sort_field": "modified",
  "sort_order": "DESC",
  "states": []
}
```

- [ ] **Step 2: Create the Single DocType Python class**

```python
import frappe
from frappe.model.document import Document


class HRMSEmployeeFieldTemplate(Document):
	pass
```

- [ ] **Step 3: Create `HRMS Employee Field Template Item` child table**

Use this JSON structure:

```json
{
  "actions": [],
  "allow_rename": 0,
  "creation": "2026-06-30 00:00:00.000000",
  "doctype": "DocType",
  "editable_grid": 1,
  "engine": "InnoDB",
  "field_order": [
    "category",
    "field_label",
    "fieldname",
    "fieldtype",
    "description",
    "source",
    "enabled",
    "search_enabled",
    "options",
    "insert_after"
  ],
  "fields": [
    {
      "fieldname": "category",
      "fieldtype": "Select",
      "in_list_view": 1,
      "label": "所属分类",
      "options": "在职信息\n个人信息\n联系信息\n工资社保\n个税申报",
      "reqd": 1
    },
    {
      "fieldname": "field_label",
      "fieldtype": "Data",
      "in_list_view": 1,
      "label": "字段名称",
      "reqd": 1
    },
    {
      "fieldname": "fieldname",
      "fieldtype": "Data",
      "in_list_view": 1,
      "label": "字段名",
      "reqd": 1
    },
    {
      "fieldname": "fieldtype",
      "fieldtype": "Select",
      "in_list_view": 1,
      "label": "字段类型",
      "options": "Data\nDate\nSelect\nSmall Text\nCheck\nLink",
      "reqd": 1
    },
    {
      "fieldname": "description",
      "fieldtype": "Small Text",
      "label": "字段描述"
    },
    {
      "fieldname": "source",
      "fieldtype": "Select",
      "in_list_view": 1,
      "label": "来源",
      "options": "系统\n自定义",
      "reqd": 1
    },
    {
      "default": "1",
      "fieldname": "enabled",
      "fieldtype": "Check",
      "in_list_view": 1,
      "label": "启用"
    },
    {
      "default": "0",
      "fieldname": "search_enabled",
      "fieldtype": "Check",
      "label": "启用搜索"
    },
    {
      "fieldname": "options",
      "fieldtype": "Small Text",
      "label": "选项"
    },
    {
      "fieldname": "insert_after",
      "fieldtype": "Data",
      "label": "插入到字段后"
    }
  ],
  "istable": 1,
  "links": [],
  "modified": "2026-06-30 00:00:00.000000",
  "modified_by": "Administrator",
  "module": "HR",
  "name": "HRMS Employee Field Template Item",
  "owner": "Administrator",
  "permissions": [],
  "sort_field": "modified",
  "sort_order": "DESC",
  "states": []
}
```

- [ ] **Step 4: Create child table Python class**

```python
from frappe.model.document import Document


class HRMSEmployeeFieldTemplateItem(Document):
	pass
```

- [ ] **Step 5: Run the contract test**

Run:

```bash
node tests/verify_employee_field_template.js
```

Expected: still fails because `hrms/api/employee_field_template.py` does not exist.

- [ ] **Step 6: Commit DocTypes**

```bash
git add hrms/hr/doctype/hrms_employee_field_template hrms/hr/doctype/hrms_employee_field_template_item
git commit -m "feat: add employee field template doctypes"
```

### Task 3: Add Backend API

**Files:**
- Create: `hrms/api/employee_field_template.py`

- [ ] **Step 1: Implement seed data and API functions**

Create `hrms/api/employee_field_template.py` with these responsibilities:

```python
import json
import re

import frappe
from frappe import _
from frappe.custom.doctype.custom_field.custom_field import create_custom_field
from frappe.model.meta import get_meta


TEMPLATE_DOCTYPE = "HRMS Employee Field Template"
TEMPLATE_CHILD_TABLE = "HRMS Employee Field Template Item"
EMPLOYEE_DOCTYPE = "Employee"

EMPLOYEE_TEMPLATE_CATEGORIES = ["在职信息", "个人信息", "联系信息", "工资社保", "个税申报"]

EMPLOYEE_SYSTEM_FIELDS = [
	{"category": "在职信息", "field_label": "工号", "fieldname": "name", "fieldtype": "Data", "description": "员工唯一编号", "insert_after": "naming_series"},
	{"category": "在职信息", "field_label": "公司", "fieldname": "company", "fieldtype": "Link", "description": "员工所属公司", "insert_after": "employee_name"},
	{"category": "在职信息", "field_label": "部门", "fieldname": "department", "fieldtype": "Link", "description": "员工所属部门", "insert_after": "company"},
	{"category": "在职信息", "field_label": "职位", "fieldname": "designation", "fieldtype": "Link", "description": "员工当前职位", "insert_after": "department"},
	{"category": "在职信息", "field_label": "上级主管", "fieldname": "reports_to", "fieldtype": "Link", "description": "员工汇报对象", "insert_after": "designation"},
	{"category": "在职信息", "field_label": "工作性质", "fieldname": "employment_type", "fieldtype": "Link", "description": "全职、实习、外包等", "insert_after": "reports_to"},
	{"category": "在职信息", "field_label": "入职日期", "fieldname": "date_of_joining", "fieldtype": "Date", "description": "员工入职日期", "insert_after": "employment_type"},
	{"category": "在职信息", "field_label": "状态", "fieldname": "status", "fieldtype": "Select", "description": "员工当前状态", "insert_after": "date_of_joining"},
	{"category": "个人信息", "field_label": "姓名", "fieldname": "employee_name", "fieldtype": "Data", "description": "员工真实姓名", "insert_after": "naming_series"},
	{"category": "个人信息", "field_label": "性别", "fieldname": "gender", "fieldtype": "Link", "description": "员工性别", "insert_after": "employee_name"},
	{"category": "个人信息", "field_label": "出生日期", "fieldname": "date_of_birth", "fieldtype": "Date", "description": "员工出生日期", "insert_after": "gender"},
	{"category": "个人信息", "field_label": "证件号码", "fieldname": "passport_number", "fieldtype": "Data", "description": "身份证、护照等证件号码", "insert_after": "date_of_birth"},
	{"category": "联系信息", "field_label": "手机号", "fieldname": "cell_number", "fieldtype": "Data", "description": "主要联系电话", "insert_after": "personal_email"},
	{"category": "联系信息", "field_label": "公司邮箱", "fieldname": "company_email", "fieldtype": "Data", "description": "公司邮箱", "insert_after": "cell_number"},
	{"category": "联系信息", "field_label": "个人电子邮件", "fieldname": "personal_email", "fieldtype": "Data", "description": "个人邮箱", "insert_after": "prefered_email"},
	{"category": "联系信息", "field_label": "紧急联系人姓名", "fieldname": "person_to_be_contacted", "fieldtype": "Data", "description": "紧急联系人", "insert_after": "company_email"},
	{"category": "联系信息", "field_label": "紧急电话", "fieldname": "emergency_phone_number", "fieldtype": "Data", "description": "紧急联系人电话", "insert_after": "person_to_be_contacted"},
]

FIELD_TYPE_MAP = {
	"文本格式": "Data",
	"日期格式": "Date",
	"自定义选项": "Select",
	"长文本格式": "Small Text",
	"Data": "Data",
	"Date": "Date",
	"Select": "Select",
	"Small Text": "Small Text",
	"Check": "Check",
	"Link": "Link",
}
```

Then implement:

- `_get_template_doc()` to create the Single DocType record and seed system rows if missing.
- `_seed_system_fields(doc)` to append missing `EMPLOYEE_SYSTEM_FIELDS`.
- `_normalise_fieldtype(fieldtype)` to validate supported types.
- `_make_custom_fieldname(field_label)` to generate `custom_hrms_<slug>`.
- `_get_employee_meta_field(fieldname)` to safely detect required fields.
- `get_employee_field_template()`.
- `save_employee_field_template(items)`.
- `create_employee_custom_field(...)`.
- `set_employee_template_field_enabled(fieldname, enabled)`.

Use these validation rules:

```python
if category not in EMPLOYEE_TEMPLATE_CATEGORIES:
	frappe.throw(_("无效的员工属性分类: {0}").format(category))

if not field_label or len(field_label) > 30:
	frappe.throw(_("字段名称不能为空且不能超过 30 个字符"))

if fieldtype == "Select" and not options:
	frappe.throw(_("自定义选项字段必须填写选项"))
```

Use `create_custom_field` like this:

```python
create_custom_field(
	EMPLOYEE_DOCTYPE,
	{
		"fieldname": fieldname,
		"label": field_label,
		"fieldtype": fieldtype,
		"insert_after": insert_after,
		"description": description,
		"options": options if fieldtype == "Select" else None,
	},
)
```

- [ ] **Step 2: Run the contract test**

Run:

```bash
node tests/verify_employee_field_template.js
```

Expected: fails because the settings page and Employee form are not wired to the new API yet.

- [ ] **Step 3: Commit backend API**

```bash
git add hrms/api/employee_field_template.py
git commit -m "feat: add employee field template api"
```

### Task 4: Wire Settings Page to Backend

**Files:**
- Modify: `hrms/hr/page/staff_attribute_settings/staff_attribute_settings.js`
- Modify: `tests/verify_shell_and_staff_attributes.js`

- [ ] **Step 1: Replace static category arrays with remote state**

In `staff_attribute_settings.js`, keep the same Frappe Page route but use a state shape:

```javascript
const state = {
	main_tab: "员工属性",
	category: "在职信息",
	template: null,
	loading: true,
};
```

Add:

```javascript
function load_template() {
	state.loading = true;
	render();
	return frappe
		.call("hrms.api.employee_field_template.get_employee_field_template")
		.then((r) => {
			state.template = r.message;
			state.category = state.category || state.template.categories[0].label;
		})
		.finally(() => {
			state.loading = false;
			render();
		});
}
```

- [ ] **Step 2: Update add field dialog**

Replace the current `category.fields.push(...)` logic with:

```javascript
primary_action(values) {
	return frappe
		.call("hrms.api.employee_field_template.create_employee_custom_field", values)
		.then(() => {
			frappe.show_alert({ message: __("已添加到员工属性模板"), indicator: "green" });
			dialog.hide();
			return load_template();
		});
}
```

Add a secondary button:

```javascript
dialog.set_secondary_action_label(__("保存并继续添加"));
dialog.set_secondary_action(() => {
	const values = dialog.get_values();
	if (!values) return;
	frappe.call("hrms.api.employee_field_template.create_employee_custom_field", values).then(() => {
		frappe.show_alert({ message: __("已添加到员工属性模板"), indicator: "green" });
		dialog.set_value("field_label", "");
		dialog.set_value("description", "");
		dialog.set_value("options", "");
		return load_template();
	});
});
```

- [ ] **Step 3: Add enable/disable behavior**

Bind the disable button to:

```javascript
frappe.call("hrms.api.employee_field_template.set_employee_template_field_enabled", {
	fieldname,
	enabled: next_enabled,
}).then(load_template);
```

System fields should show "系统字段不可删除". Custom fields should not physically delete in phase one; the action should disable the field and explain that data is retained.

- [ ] **Step 4: Update verification expectations**

In `tests/verify_shell_and_staff_attributes.js`, add markers:

```javascript
for (const marker of [
	"hrms.api.employee_field_template.get_employee_field_template",
	"hrms.api.employee_field_template.create_employee_custom_field",
	"hrms.api.employee_field_template.set_employee_template_field_enabled",
	"保存并继续添加",
	"启用搜索",
	"自定义选项",
]) {
	mustInclude(pageJs, marker, `员工属性设置 Page must use backend template API: ${marker}`);
}

if (pageJs.includes("category.fields.push([")) {
	throw new Error("员工属性设置 Page must not add fields only to in-memory arrays.");
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
node tests/verify_shell_and_staff_attributes.js
node tests/verify_employee_field_template.js
```

Expected: `verify_shell_and_staff_attributes.js` passes; `verify_employee_field_template.js` still fails until Employee form wiring is implemented.

- [ ] **Step 6: Commit settings page wiring**

```bash
git add hrms/hr/page/staff_attribute_settings/staff_attribute_settings.js tests/verify_shell_and_staff_attributes.js
git commit -m "feat: persist employee attribute settings"
```

### Task 5: Apply Template on Employee Form

**Files:**
- Modify: `hrms/public/js/erpnext/employee.js`
- Modify: `hrms/hooks.py`

- [ ] **Step 1: Load template on Employee form refresh**

In `employee.js`, call template logic from `refresh`:

```javascript
refresh: function (frm) {
	apply_employee_field_template(frm);
	setup_personnel_employee_detail(frm);
	...
}
```

Add:

```javascript
function apply_employee_field_template(frm) {
	frappe
		.call("hrms.api.employee_field_template.get_employee_field_template")
		.then((r) => {
			const template = r.message;
			if (!template || !template.enabled) return;

			const required_fields = new Set(
				(frm.meta.fields || [])
					.filter((field) => field.reqd)
					.map((field) => field.fieldname),
			);

			(template.fields || []).forEach((field) => {
				if (!field.fieldname || !frm.fields_dict[field.fieldname]) return;
				if (required_fields.has(field.fieldname)) return;
				frm.toggle_display(field.fieldname, Boolean(field.enabled));
			});
		});
}
```

- [ ] **Step 2: Keep save-critical fields visible**

Extend the required-field set:

```javascript
const save_critical_fields = new Set([
	"employee_name",
	"company",
	"gender",
	"date_of_birth",
	"date_of_joining",
	"status",
]);
```

Do not hide a field if it is in either `required_fields` or `save_critical_fields`.

- [ ] **Step 3: Bump asset query string**

In `hrms/hooks.py`, bump the Employee form JS cache marker if the current hook uses asset query strings for other scripts. If `doctype_js` does not support query strings in the current repo, leave the path unchanged and bump only app include assets that are query-stringed.

- [ ] **Step 4: Run tests**

Run:

```bash
node tests/verify_employee_field_template.js
node tests/verify_personnel_roster.js
node tests/verify_shell_and_staff_attributes.js
```

Expected: all three pass.

- [ ] **Step 5: Commit Employee form application**

```bash
git add hrms/public/js/erpnext/employee.js hrms/hooks.py tests/verify_employee_field_template.js
git commit -m "feat: apply employee field template to form"
```

### Task 6: Optional Frappe Runtime Verification

**Files:**
- No required source edits unless runtime errors are found.

- [ ] **Step 1: Run migration if bench is available**

Run from the bench root if this repository is inside a bench:

```bash
bench --site frontend migrate
```

If the active site name is not `frontend`, run:

```bash
bench --site <site-name> migrate
```

Expected: DocTypes install without migration errors.

- [ ] **Step 2: Clear cache and restart if needed**

```bash
bench --site <site-name> clear-cache
bench restart
```

Expected: server restarts and `/desk/staff-attribute-settings` loads.

- [ ] **Step 3: Browser verification**

Manually verify:

- Open `/desk/staff-attribute-settings`.
- Click 添加属性字段.
- Add a Data field under 个人信息.
- Open `/desk/employee/new-employee`.
- Confirm the new custom field exists on the Employee form.
- Disable the field from 员工属性设置.
- Reload the Employee form.
- Confirm the field is hidden but the Employee form can still save required fields.

- [ ] **Step 4: Commit runtime fixes only if needed**

```bash
git add <changed-files>
git commit -m "fix: stabilize employee field template runtime"
```

## Self-Review

- Spec coverage: The plan covers persistent template storage, Custom Field creation, Employee form display rules, settings page backend wiring, and test-first verification.
- Scope check: Payroll, approval, training, and performance modules remain out of scope.
- Placeholder scan: The implementation steps include exact paths, function names, commands, and expected outcomes.
- Type consistency: API names match the contract test and the planned JavaScript call sites.
