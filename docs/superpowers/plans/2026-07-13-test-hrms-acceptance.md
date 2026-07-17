# TEST-HRMS Local Acceptance Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Independently verify the local `hrms.localhost` HR trial chain with traceable virtual data isolated under `Company=TEST-HRMS`.

**Architecture:** Read Frappe metadata and counts first, then create only company-scoped organization and employee lifecycle records whose identifying names start with `TEST-`. Attendance, approval, monthly-close, and payroll APIs are exercised only when their data model and queries are company-scoped and cannot delete or combine non-TEST records. Evidence is captured as commands, counts, expected/actual results, and a cleanup manifest.

**Tech Stack:** Docker Compose, Frappe/ERPNext/HRMS v17, MariaDB read-only metadata queries, `bench --site hrms.localhost execute`, Markdown evidence.

## Global Constraints

- Never create, modify, or delete data belonging to `Company=永新` or `Company=1`.
- Never clear Docker volumes, migrate, deploy, or call DingTalk APIs.
- Every new company, organization, employee name/number, approval number, and batch identifier starts with `TEST-` and contains virtual personal/payroll data only.
- If `TEST-HRMS` already exists, list existing TEST data and stop before writes.
- Never hand-edit a monthly final attendance or payroll result to claim a passing workflow.
- Do not modify attendance import, approval, monthly-close, or payroll core logic during acceptance.

---

### Task 1: Read-only site and metadata audit

**Files:**
- Create: `docs/acceptance/2026-07-13-test-hrms-acceptance-report.md`

**Interfaces:**
- Consumes: running Docker services and the `hrms.localhost` site.
- Produces: site/app inventory, protected-company baselines, `TEST-HRMS` precondition, DocType/field capability table.

- [ ] **Step 1: Record containers, installed apps, and protected counts**

Run read-only `docker ps`, `bench --site hrms.localhost list-apps`, and Frappe count/list calls.
Expected: one site; companies `永新` and `1`; employee baseline 205; no `TEST-HRMS`.

- [ ] **Step 2: Audit lifecycle, attendance, approval, monthly, and payroll fields**

Run read-only queries against `tabDocType`, `tabDocField`, and `tabCustom Field`.
Expected: classify each stage as directly creatable, missing, or dependent/unimplemented.

- [ ] **Step 3: Gate write execution**

Proceed only if `TEST-HRMS` is absent and every planned write has an explicit company link or a safely company-scoped parent. Otherwise stop and report the conflicting TEST inventory or isolation gap.

### Task 2: Reproducible virtual dataset and acceptance matrix

**Files:**
- Modify: `docs/acceptance/2026-07-13-test-hrms-acceptance-report.md`

**Interfaces:**
- Consumes: Task 1 capability table.
- Produces: four scenario fixtures, expected records, commands, assertions, and cleanup order.

- [ ] **Step 1: Define identifiers and virtual values**

Use `TEST-HRMS`, `TEST-HRMS-DEPT`, `TEST-HRMS-DESIG-*`, and employees `TEST-INT-001`, `TEST-PRO-002`, `TEST-REG-003`, `TEST-EXC-004`; use future/isolated dates and fictional contacts only.

- [ ] **Step 2: Define stage gates**

For each stage, state exact creation preconditions, expected counts/values, and whether the official business API is safe to call.

- [ ] **Step 3: Define protected-data invariants**

Snapshot company and employee counts per protected company before writes; after every stage, assert those counts and modification maxima remain unchanged.

### Task 3: Company-scoped organization and lifecycle execution

**Files:**
- Modify: `docs/acceptance/2026-07-13-test-hrms-acceptance-report.md`

**Interfaces:**
- Consumes: Task 2 fixture values.
- Produces: company, department, designations, employment types, four employees, and safe lifecycle records.

- [ ] **Step 1: Create TEST company and organization**

Insert only `Company=TEST-HRMS` and TEST-prefixed organization records through Frappe document APIs.
Expected: TEST objects exist and protected-company snapshots remain unchanged.

- [ ] **Step 2: Create four virtual employees**

Insert the four specified employee scenarios with TEST-prefixed employee numbers and virtual identity/contact data.
Expected: all employees link to `TEST-HRMS`; probation/regular fields reflect their scenario.

- [ ] **Step 3: Exercise safe lifecycle documents**

Create only lifecycle records whose schema and validation support TEST company/employee links. If onboarding, training qualification, promotion/transfer, or salary change lacks required dependencies, record `阻塞` rather than bypassing validation.

- [ ] **Step 4: Recheck protected invariants**

Run fresh counts and modification checks for `永新` and `1`.

### Task 4: Attendance-to-payroll safety gate and verification

**Files:**
- Modify: `docs/acceptance/2026-07-13-test-hrms-acceptance-report.md`

**Interfaces:**
- Consumes: Task 1 data-model audit and Task 3 employees.
- Produces: pass/fail/blocked evidence for attendance, apple reward, approval evidence, monthly close, payroll input, and payroll settlement.

- [ ] **Step 1: Verify official API isolation**

Inspect whether batch creation accepts TEST-prefixed identifiers, all records carry company scope, and delete/regenerate queries filter by company.
Expected: do not call any mutating API that fails this gate.

- [ ] **Step 2: Run non-mutating calculation/contract checks**

Run existing repository contract tests and pure-function checks for approval validity, exception calculation, monthly calculation, and payroll arithmetic without database writes.

- [ ] **Step 3: Record blocked end-to-end stages**

Mark official-import, approval-sync, monthly-lock, and payroll-trial stages blocked or failed with exact missing fields/functions and source locations. Never create a manual monthly summary or settlement record as a substitute.

### Task 5: Final verification and cleanup manifest

**Files:**
- Modify: `docs/acceptance/2026-07-13-test-hrms-acceptance-report.md`

**Interfaces:**
- Consumes: all prior evidence.
- Produces: final matrix, TEST-only cleanup list/order, protected invariants, and commands used.

- [ ] **Step 1: Query every TEST-created record**

List names, DocTypes, company/employee links, and counts; include reverse dependency cleanup order without deleting anything unless separately authorized.

- [ ] **Step 2: Run fresh verification**

Re-run protected company/employee counts, TEST company links, repository tests, and report placeholder scan.

- [ ] **Step 3: Publish status matrix**

For every requested stage and scenario, assign exactly one of `通过`, `失败`, `阻塞`, or `不适用`, with command evidence and dependency notes.

### Task 6: Post-merge roster, mapping, lock, and payroll isolation retest

**Files:**
- Modify: `docs/acceptance/2026-07-13-test-hrms-acceptance-report.md`

**Interfaces:**
- Consumes: merged employee-history, real attendance import with company isolation, monthly lock, and company-scoped payroll modules; source workbook `/Users/lrj/Documents/SAD/YOngxin/人资/副本人资系统沟通表260713.xlsx`; the existing four TEST employees.
- Produces: source-baseline reconciliation, mapping exception evidence, roster presentation assertions, employment-status statistics, immutable company-scoped lock evidence, and payroll isolation evidence.

- [ ] **Step 1: Reconfirm source workbook aggregate baseline without exposing personal data**

Read only the business employee-code columns from `花名册!C4:C206` and `每日统计（钉钉导出）!E5:E211`.
Expected: roster has 203 non-empty rows, 203 unique codes, and 0 duplicates; daily attendance has 198 non-empty rows, 198 unique codes, and 0 duplicates; 193 codes match, 5 attendance codes are absent from the roster, and 10 roster codes have no row for the day.

- [ ] **Step 2: Verify missing-master mapping gate**

Import a TEST-only attendance source row whose business code has no TEST-HRMS Employee mapping.
Expected: exactly one traceable exception-queue record contains Company, business code, source batch/file/row, reason `缺失主档`, and unresolved status; no day-check, monthly-lock input, payroll input, or payroll settlement record is created for that row.

- [ ] **Step 3: Verify cross-company mapping gate**

Use a TEST-only source row whose source Company does not match the mapped employee Company; do not map to or mutate an employee belonging to `永新` or `1`.
Expected: exactly one traceable exception-queue record contains reason `跨公司员工`; the row is excluded from day-check, month lock, and payroll. If the merged schema cannot express this fixture without a second TEST company or a source-company field, mark the fixture dependency `阻塞` and request explicit authorization rather than using protected-company data.

- [ ] **Step 4: Verify mapping confirmation transition**

Confirm each TEST exception through the official mapping workflow.
Expected: only an explicitly confirmed, company-matching mapping can transition from the exception queue into daily checks; the confirmation stores resolver, timestamp, source record, employee, business code, and Company. Re-running import is idempotent and does not duplicate the daily row.

- [ ] **Step 5: Verify roster business presentation**

Query the roster API/UI for the four existing TEST employees.
Expected: the displayed employee code is `TEST-INT-001`, `TEST-PRO-002`, `TEST-REG-003`, or `TEST-EXC-004`, never the internal `HR-EMP-*` key; the displayed department is the business `department_name` such as `TEST-HRMS-DEPT`, without an internal Company suffix.

- [ ] **Step 6: Verify identity inference without overwriting manual values**

Use valid-format synthetic TEST identity numbers only. First verify blank gender, birth date, and age are inferred; then set distinct manual TEST values and re-run the inference/import path.
Expected: derived values fill blanks, record their source, and never overwrite non-empty manually maintained values. No real identity number is displayed in evidence.

- [ ] **Step 7: Verify employment-status statistics**

Reconcile the categories `实习`, `试用`, `全职`, `外包`, and `返聘` against the underlying Employee filters and total. Use only the four TEST employees for mutations; when five simultaneous categories cannot be represented by four employees, run a documented staged transition on one TEST employee and verify the source/target category counts move by exactly one without changing the total.

- [ ] **Step 8: Verify locked-version attendance and payroll isolation**

Create and lock a TEST-HRMS-only monthly version through the merged official API, then generate payroll input/trial settlement from that immutable version.
Expected: lock stores Company, month, source version/hash, actor, timestamp, and immutable source counts; post-lock source changes are rejected or create a new version. Payroll reads only the selected `TEST-HRMS` lock, contains only the four TEST business codes, and does not delete, update, or include any `永新`/`1` monthly or payroll record.

- [ ] **Step 9: Recheck protected invariants and retain TEST fixtures**

Compare protected Company counts and modification maxima before/after every mutating step. Expected: no change to `永新` or `1`. Retain TEST-HRMS data for subsequent retests; do not execute cleanup.
