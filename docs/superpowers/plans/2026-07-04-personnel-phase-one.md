# Personnel Phase One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first stable personnel workflow: employee roster, employee detail, report center, and custom export using real Frappe Employee data and employee field template configuration.

**Architecture:** Keep Frappe `Employee` as the source of truth. Add focused whitelisted APIs to `hrms/api/employee_field_template.py` for roster pagination, dynamic columns, detail sections, quick edit, and filter-aware export. Use existing Frappe Pages (`employee-archive`, `personnel-reports`, `employee-roster-export`) and existing Employee form hooks instead of introducing a new frontend framework.

**Tech Stack:** Frappe whitelisted Python APIs, Frappe Desk Page JavaScript, Frappe `frappe.client`/`frappe.db` APIs, openpyxl export helpers, Node contract tests, Python syntax verification.

---

## File Structure

- Modify `tests/verify_personnel_roster.js`: contract for roster filters, sorting, pagination, dynamic columns, quick edit, and detail navigation.
- Modify `tests/verify_personnel_reports.js`: contract for report sorting, export records, current-filter export, and saved report templates.
- Modify `hrms/api/employee_field_template.py`: roster APIs, detail APIs, quick edit API, filter-aware export helpers, and export record bookkeeping.
- Modify `hrms/hr/page/employee_archive/employee_archive.js`: replace the simple archive table with the phase-one roster shell.
- Create `hrms/hr/page/employee_detail/employee_detail.json`: Desk page route for employee detail.
- Create `hrms/hr/page/employee_detail/employee_detail.js`: employee detail tabs and editable sections.
- Modify `hrms/hr/page/employee_roster_export/employee_roster_export.js`: current-filter/all-employee export mode and export records.
- Modify `hrms/hr/page/personnel_reports/personnel_reports.js`: report sorting affordance and saved template paths.
- Modify workspace/sidebar files only if a route link is missing.

## Task 1: Roster Contract And API

- [ ] **Step 1: Write failing contract markers in `tests/verify_personnel_roster.js`**

Add checks for:

```javascript
for (const marker of [
	"get_employee_roster",
	"get_employee_roster_summary",
	"quick_update_employee_roster",
	"get_employee_detail",
	"get_employee_detail_navigation",
	"search_fields: [\"employee_name\", \"cell_number\", \"custom_employee_code\"]",
	"sort_options",
	"page_length",
	"selected_status_card",
	"department_filter",
	"dynamic_columns",
]) {
	mustInclude(api + employeeArchiveJs, marker, `Phase-one roster is missing: ${marker}`);
}
```

- [ ] **Step 2: Run failing test**

Run:

```bash
node tests/verify_personnel_roster.js
```

Expected: fails on missing `get_employee_roster`.

- [ ] **Step 3: Implement API**

Add whitelisted methods in `hrms/api/employee_field_template.py`:

```python
@frappe.whitelist()
def get_employee_roster(filters: str = "{}", search: str = "", sort_by: str = "modified", sort_order: str = "desc", page: int = 1, page_length: int = 20):
    ...

@frappe.whitelist()
def get_employee_roster_summary(filters: str = "{}"):
    ...

@frappe.whitelist()
def quick_update_employee_roster(employee: str, values: str = "{}"):
    ...
```

Use `_get_employee_import_fields(_get_template_doc())` for dynamic columns and only return enabled fields.

- [ ] **Step 4: Implement roster page**

Modify `hrms/hr/page/employee_archive/employee_archive.js` to call the roster API, render status cards, search, department filter, sort selector, pagination, quick edit, dynamic columns, and detail navigation.

- [ ] **Step 5: Verify**

Run:

```bash
node tests/verify_personnel_roster.js
python3 -m py_compile hrms/api/employee_field_template.py
node --check hrms/hr/page/employee_archive/employee_archive.js
```

Expected: all pass.

## Task 2: Employee Detail Page

- [ ] **Step 1: Write failing contract**

Extend `tests/verify_personnel_roster.js` to require `employee-detail` page files and markers:

```javascript
for (const marker of ["员工头像", "概览", "在职信息", "个人信息", "联系信息", "工资社保", "合同信息", "材料附件", "背景调查", "上一个员工", "下一个员工", "人事异动", "转正", "离职", "合同记录"]) {
	mustInclude(employeeDetailJs, marker, `Employee detail page is missing: ${marker}`);
}
```

- [ ] **Step 2: Run failing test**

Run:

```bash
node tests/verify_personnel_roster.js
```

Expected: fails on missing `employee_detail` page.

- [ ] **Step 3: Implement detail API**

Add:

```python
@frappe.whitelist()
def get_employee_detail(employee: str):
    ...

@frappe.whitelist()
def get_employee_detail_navigation(employee: str, filters: str = "{}"):
    ...
```

Return header fields plus sections grouped by employee field template category.

- [ ] **Step 4: Implement detail page**

Create `hrms/hr/page/employee_detail/employee_detail.json` and `employee_detail.js`. The page reads `frappe.get_route()[1]`, renders header, tabs, editable fields, previous/next buttons, and routes to native Frappe docs for transfer, promotion, separation, and contract-related records.

- [ ] **Step 5: Verify**

Run:

```bash
node tests/verify_personnel_roster.js
node --check hrms/hr/page/employee_detail/employee_detail.js
python3 -m py_compile hrms/api/employee_field_template.py
```

Expected: all pass.

## Task 3: Reports And Export

- [ ] **Step 1: Write failing contract**

Extend `tests/verify_personnel_reports.js` and `tests/verify_employee_roster_import_export.js` with markers for:

```javascript
"get_employee_export_records"
"log_employee_export_record"
"export_scope"
"current_filters"
"全部员工"
"当前筛选结果"
"导出记录"
"基础信息"
"联系信息"
"合同信息"
"工资社保"
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
node tests/verify_personnel_reports.js
node tests/verify_employee_roster_import_export.js
```

Expected: fails on missing export record/current-filter behavior.

- [ ] **Step 3: Implement export scope**

Modify `download_employee_roster_export` to accept `filters` and `export_scope`. When `export_scope == "current_filters"`, pass parsed filters into `_make_employee_export_workbook`.

- [ ] **Step 4: Implement export record readback**

Add a lightweight `get_employee_export_records` API returning recent saved `File` rows or cache-backed export events, and make export page show a “导出记录” section.

- [ ] **Step 5: Verify**

Run:

```bash
node tests/verify_personnel_reports.js
node tests/verify_employee_roster_import_export.js
python3 -m py_compile hrms/api/employee_field_template.py
node --check hrms/hr/page/employee_roster_export/employee_roster_export.js
node --check hrms/hr/page/personnel_reports/personnel_reports.js
```

Expected: all pass.

## Self-Review

- Spec coverage: Task 1 covers roster, filters, dynamic columns, quick edit, detail route. Task 2 covers employee detail tabs and actions. Task 3 covers reports, custom export, current-filter export, and export records.
- Known out of scope for phase one: organization chart, DingTalk attendance sync, mobile/DingTalk H5.
- Type consistency: all APIs live in `hrms.api.employee_field_template`, with JSON string inputs for Desk callers.
