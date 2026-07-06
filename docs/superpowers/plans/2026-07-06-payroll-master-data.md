# Payroll Master Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first rule-driven payroll phase: salary structure versions, salary grade rows, employee salary changes, and payroll center page/API integration.

**Architecture:** Keep the existing route `payroll-input-center` and extend it into a payroll management center. Add focused HR DocTypes under `hrms/hr/doctype`, add payroll master-data API functions in `hrms/api/payroll_input.py`, and add a `薪资主数据` tab to the existing Desk page. The settlement formula phase consumes the latest approved employee salary change rather than relying on hand-entered variables.

**Tech Stack:** Frappe DocType JSON, Frappe whitelisted Python APIs, openpyxl workbook parsing, Frappe Desk Page JavaScript, Node contract tests, Python/JavaScript syntax checks.

---

## File Structure

- Create `tests/verify_payroll_master_data.js`: contract test for phase-one payroll master data.
- Modify `hrms/api/payroll_input.py`: constants and whitelisted APIs for salary structure import/list and salary change list/create.
- Modify `hrms/hr/page/payroll_input_center/payroll_input_center.js`: rename copy to `薪酬管理中心` and add `薪资主数据` tab.
- Create DocTypes:
  - `hrms/hr/doctype/hrms_salary_structure_version`
  - `hrms/hr/doctype/hrms_salary_grade`
  - `hrms/hr/doctype/hrms_employee_salary_change`
- Modify `hrms/hr/page/hrms_workbench/hrms_workbench.js`: update payroll card copy to include salary master data.
- Modify `hrms/hr/page/hrms_workbench/hrms_workbench.py`: add quick route for `薪资主数据`.

## Task 1: Contract Test

**Files:**
- Create: `tests/verify_payroll_master_data.js`

- [ ] **Step 1: Write the failing contract test**

```javascript
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
function read(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) throw new Error(`Missing file: ${file}`);
  return fs.readFileSync(full, "utf8");
}
function mustInclude(source, marker, message) {
  if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}
const api = read("hrms/api/payroll_input.py");
for (const marker of [
  "SALARY_STRUCTURE_VERSION_DOCTYPE",
  "SALARY_GRADE_DOCTYPE",
  "EMPLOYEE_SALARY_CHANGE_DOCTYPE",
  "preview_salary_structure_workbook",
  "import_salary_structure_workbook",
  "list_salary_structure_versions",
  "list_salary_grades",
  "create_employee_salary_change",
  "list_employee_salary_changes",
  "get_active_salary_change_for_employee",
]) mustInclude(api, marker, `Payroll master API is missing marker: ${marker}`);
const pageJs = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
for (const marker of ["薪酬管理中心", "salary-master", "薪资主数据", "薪资架构版本", "员工薪资异动"]) {
  mustInclude(pageJs, marker, `Payroll master page is missing marker: ${marker}`);
}
for (const [folder, markers] of [
  ["hrms_salary_structure_version", ["HRMS Salary Structure Version", "薪资架构版本", "structure_version", "effective_from"]],
  ["hrms_salary_grade", ["HRMS Salary Grade", "薪资档位", "job_grade", "base_salary", "function_allowance", "full_salary"]],
  ["hrms_employee_salary_change", ["HRMS Employee Salary Change", "员工薪资异动", "effective_date", "change_reason", "approved_by"]],
]) {
  const json = read(`hrms/hr/doctype/${folder}/${folder}.json`);
  const py = read(`hrms/hr/doctype/${folder}/${folder}.py`);
  for (const marker of markers) mustInclude(json, marker, `${folder} DocType missing marker: ${marker}`);
  mustInclude(py, "Document", `${folder} controller must extend Document.`);
}
console.log("Payroll master data contract passed.");
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node tests/verify_payroll_master_data.js
```

Expected: FAIL with `Payroll master API is missing marker: SALARY_STRUCTURE_VERSION_DOCTYPE`.

## Task 2: DocTypes

**Files:**
- Create: `hrms/hr/doctype/hrms_salary_structure_version/__init__.py`
- Create: `hrms/hr/doctype/hrms_salary_structure_version/hrms_salary_structure_version.py`
- Create: `hrms/hr/doctype/hrms_salary_structure_version/hrms_salary_structure_version.json`
- Create: `hrms/hr/doctype/hrms_salary_grade/__init__.py`
- Create: `hrms/hr/doctype/hrms_salary_grade/hrms_salary_grade.py`
- Create: `hrms/hr/doctype/hrms_salary_grade/hrms_salary_grade.json`
- Create: `hrms/hr/doctype/hrms_employee_salary_change/__init__.py`
- Create: `hrms/hr/doctype/hrms_employee_salary_change/hrms_employee_salary_change.py`
- Create: `hrms/hr/doctype/hrms_employee_salary_change/hrms_employee_salary_change.json`

- [ ] **Step 1: Add salary structure version DocType**

Create fields:

```text
structure_version Data required list view
effective_from Date required
effective_to Date
status Select 草稿/已启用/已停用 default 草稿
source_file Attach
remarks Small Text
```

- [ ] **Step 2: Add salary grade DocType**

Create fields:

```text
salary_structure_version Link HRMS Salary Structure Version required
job_nature Data
job_grade Data list view
post_category Small Text list view
base_salary Currency
function_allowance Currency
full_salary Currency
grade_difference Currency
grade_difference_ratio Percent
education_allowance Currency
multi_skill_allowance Currency
full_attendance_bonus_standard Currency
rental_subsidy_standard Currency
large_night_shift_allowance Currency default 45
small_night_shift_allowance Currency default 24
certificate_allowance Currency
raw_row_json Code JSON
```

- [ ] **Step 3: Add employee salary change DocType**

Create fields:

```text
employee Link Employee
employee_code Data list view
employee_name Data list view
department Link Department
designation Link Designation
education_level_text Data
date_of_joining Date
effective_date Date required list view
change_reason Data
salary_grade Link HRMS Salary Grade
base_salary Currency
function_allowance Currency
certificate_allowance Currency
multi_skill_allowance Currency
full_salary Currency
housing_fund_enabled Check
social_insurance_enabled Check
company_cost_total Currency
prepared_by Data
reviewed_by Data
approved_by Data
status Select 草稿/待审核/已批准/已作废 default 草稿 list view
source_file Attach
remarks Small Text
```

- [ ] **Step 4: Run the test and verify DocType markers now pass but API/page markers still fail**

Run:

```bash
node tests/verify_payroll_master_data.js
```

Expected: FAIL moves from missing DocType files to missing API/page markers.

## Task 3: Payroll Master APIs

**Files:**
- Modify: `hrms/api/payroll_input.py`

- [ ] **Step 1: Add constants**

Add near existing payroll DocType constants:

```python
SALARY_STRUCTURE_VERSION_DOCTYPE = "HRMS Salary Structure Version"
SALARY_GRADE_DOCTYPE = "HRMS Salary Grade"
EMPLOYEE_SALARY_CHANGE_DOCTYPE = "HRMS Employee Salary Change"
```

- [ ] **Step 2: Add structure workbook preview**

Implement `preview_salary_structure_workbook(file_url)` to load `薪资架构`, count rows that contain `岗性`/`岗级` blocks or numeric salary rows, and return:

```python
{"sheet_name": "薪资架构", "found": True, "grade_rows": 0, "warnings": []}
```

If the sheet is absent, return `found: False` and warning `missing_salary_structure_sheet`.

- [ ] **Step 3: Add salary structure import**

Implement `import_salary_structure_workbook(file_url, structure_version, effective_from, effective_to="")`:

```python
# create HRMS Salary Structure Version
# parse 薪资架构 rows
# keep current job_nature from section labels such as 一.生产类直接人员
# create HRMS Salary Grade records for rows with a job grade
# store raw_row_json for audit
# commit and return {"version": doc.name, "grade_rows": len(created)}
```

- [ ] **Step 4: Add list APIs**

Implement:

```python
list_salary_structure_versions()
list_salary_grades(structure_version="")
list_employee_salary_changes(employee="", payroll_month="")
```

Each returns `frappe.get_all(..., fields=["*"], order_by="modified desc", limit_page_length=...)`.

- [ ] **Step 5: Add salary change create API**

Implement `create_employee_salary_change(**kwargs)` to insert one `HRMS Employee Salary Change` record. Resolve `employee_code`, `employee_name`, `department`, `designation`, and `date_of_joining` from Employee when `employee` is passed.

- [ ] **Step 6: Add active salary change resolver**

Implement `get_active_salary_change_for_employee(employee=None, employee_code="", payroll_month="")`:

```python
# filter status = 已批准
# match employee or employee_code
# effective_date <= last day of payroll_month
# order by effective_date desc, modified desc
# return first record as dict or {}
```

- [ ] **Step 7: Run syntax and contract tests**

Run:

```bash
python3 -m py_compile hrms/api/payroll_input.py
node tests/verify_payroll_master_data.js
```

Expected: API markers pass; page markers may still fail until Task 4.

## Task 4: Payroll Center Page

**Files:**
- Modify: `hrms/hr/page/payroll_input_center/payroll_input_center.js`
- Modify: `hrms/hr/page/hrms_workbench/hrms_workbench.js`
- Modify: `hrms/hr/page/hrms_workbench/hrms_workbench.py`

- [ ] **Step 1: Rename visible page copy**

Change page title and header text from `薪资输入中心` to `薪酬管理中心`, but keep `frappe.pages["payroll-input-center"]`.

- [ ] **Step 2: Add `salary-master` tab**

Add tab object:

```javascript
{ key: "salary-master", label: "薪资主数据" }
```

- [ ] **Step 3: Add master data tab loader**

Add branch in `load_active_tab()`:

```javascript
if (this.active_tab === "salary-master") {
  this.load_salary_master();
  return;
}
```

- [ ] **Step 4: Render salary master panels**

Add `load_salary_master()` that renders:

```text
薪资架构版本 table
薪资档位 table
员工薪资异动 table
上传薪资架构 Excel button
```

The upload button should call `preview_salary_structure_workbook`; importing can be a button in the preview panel with `structure_version` and `effective_from` inputs.

- [ ] **Step 5: Wire list calls**

Use:

```javascript
hrms.api.payroll_input.list_salary_structure_versions
hrms.api.payroll_input.list_salary_grades
hrms.api.payroll_input.list_employee_salary_changes
```

- [ ] **Step 6: Update workbench quick routes**

Add route:

```python
_route("薪资主数据", ["payroll-input-center", "salary-master"], "database")
```

Update the payroll card description to mention `薪资主数据`.

- [ ] **Step 7: Run page and contract checks**

Run:

```bash
node --check hrms/hr/page/payroll_input_center/payroll_input_center.js
node --check hrms/hr/page/hrms_workbench/hrms_workbench.js
node tests/verify_payroll_master_data.js
node tests/verify_payroll_input_center.js
node tests/verify_payroll_settlement_center.js
```

Expected: all listed commands pass.

## Task 5: Container Sync And Regression

**Files:**
- No new source files beyond Tasks 1-4.

- [ ] **Step 1: Run adjacent regression tests**

Run:

```bash
node tests/verify_attendance_workbench.js
python3 -m py_compile hrms/api/payroll_input.py hrms/hr/doctype/hrms_salary_structure_version/hrms_salary_structure_version.py hrms/hr/doctype/hrms_salary_grade/hrms_salary_grade.py hrms/hr/doctype/hrms_employee_salary_change/hrms_employee_salary_change.py
```

Expected: all pass.

- [ ] **Step 2: Migrate running Docker site**

Run:

```bash
docker exec docker-frappe-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site hrms.localhost migrate --skip-search-index && bench --site hrms.localhost clear-cache'
```

Expected: migrate exits 0.

- [ ] **Step 3: Verify DocTypes exist in running site**

Run:

```bash
docker exec docker-frappe-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site hrms.localhost execute frappe.db.exists --args "[\"DocType\", \"HRMS Salary Structure Version\"]" && bench --site hrms.localhost execute frappe.db.exists --args "[\"DocType\", \"HRMS Salary Grade\"]" && bench --site hrms.localhost execute frappe.db.exists --args "[\"DocType\", \"HRMS Employee Salary Change\"]"'
```

Expected output includes the three DocType names.

## Self-Review Notes

- Spec coverage: covers Phase 1 from `2026-07-06-payroll-rules-management-design.md`: salary structure version, salary grade, employee salary change, and payroll page integration.
- Deferred by design: education subsidy, rental subsidy, dormitory, insurance, formula refactor, source tracing, difference check, and export. These are separate phases and should not be mixed into this implementation.
- Type consistency: all DocType constants and folder names use `HRMS Salary Structure Version`, `HRMS Salary Grade`, and `HRMS Employee Salary Change`.
