# HR Settings Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified 设置中心 that owns employee field governance, aliases, import/export visibility, detail blocks, and future configurable HR modules.

**Architecture:** Reuse the existing HRMS Employee Field Template as the persistent field registry, extend it with governance flags, aliases, and detail block metadata, then expose a new Frappe Page as the single settings entry. Existing import, export, detail, roster, and Employee form code should consume the serialized field center schema instead of hard-coded switches where possible.

**Tech Stack:** Frappe Page JSON/JS, Frappe Single DocType child table, Python whitelisted APIs, existing Node contract tests.

---

### Task 1: Contract Tests

**Files:**
- Modify: `tests/verify_shell_and_staff_attributes.js`
- Modify: `tests/verify_employee_field_template.js`
- Modify: `tests/verify_employee_roster_import_export.js`
- Modify: `tests/verify_personnel_roster.js`

- [ ] Add assertions for the new `hr-settings-center` Page, top-nav More link, and field governance APIs.
- [ ] Add assertions for field aliases and import/export/detail/form flags.
- [ ] Run the tests and confirm they fail before production changes.

### Task 2: Field Registry Schema

**Files:**
- Modify: `hrms/hr/doctype/hrms_employee_field_template_item/hrms_employee_field_template_item.json`
- Modify: `hrms/api/employee_field_template.py`

- [ ] Add child-table fields: `aliases`, `import_enabled`, `export_enabled`, `form_visible`, `detail_visible`, `roster_visible`, `detail_block`, `detail_block_order`, `record_type`.
- [ ] Serialize these fields with backward-compatible defaults.
- [ ] Use aliases in header matching.
- [ ] Use `import_enabled` in import template and import parser.
- [ ] Use `export_enabled` in export field schema.
- [ ] Use `detail_visible` and `detail_block` in employee detail sections and related records.

### Task 3: Settings Center Page

**Files:**
- Create: `hrms/hr/page/hr_settings_center/hr_settings_center.json`
- Create: `hrms/hr/page/hr_settings_center/hr_settings_center.js`
- Create: `hrms/hr/page/hr_settings_center/__init__.py`
- Modify: `hrms/api/employee_field_template.py`
- Modify: `hrms/public/js/hrms_top_nav.js`
- Modify: `hrms/public/js/hrms_home_redirect_v6.js`
- Modify: `hrms/hooks.py`

- [ ] Add `hr-settings-center` to ensured personnel pages.
- [ ] Add 设置中心 to top-nav More.
- [ ] Build a Frappe-style settings page with modules for 字段管理中心, 员工属性设置, 字段别名配置, 详情资料块设置, 导入映射设置, 导出模板设置, 基础资料设置, 多行记录类型.
- [ ] Move staff attribute behavior into the settings center module while keeping the old page as a compatibility redirect.

### Task 4: Settings APIs

**Files:**
- Modify: `hrms/api/employee_field_template.py`

- [ ] Add `get_hr_settings_center`.
- [ ] Add `save_employee_field_center`.
- [ ] Add `get_employee_field_center`.
- [ ] Add reusable helpers for default detail blocks and record type configs.
- [ ] Ensure existing `get_employee_field_template` remains compatible.

### Task 5: Verification

**Files:**
- Test: existing contract tests

- [ ] Run all relevant Node contract tests.
- [ ] Run Python compile checks.
- [ ] Run JS syntax checks.
