# TEST-HRMS Demo Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run an idempotent Frappe seed service that gives `TEST-HRMS` safe, visible demo data across all currently creatable HR modules while gating attendance and payroll behind Company isolation and the `2099-01` lock.

**Architecture:** Add one focused `hrms.api.demo_seed` module with stable manifests, a never-update get-or-create primitive, protected-company snapshots, per-phase capability gates, structured results, and whitelisted status/dry-run/seed entry points. A source-contract test defines the public API before implementation; live dry-run, first-run, second-run, and database invariant checks provide integration evidence.

**Tech Stack:** Python/Frappe v17, MariaDB via Frappe ORM, Node.js contract tests, Docker Bench CLI.

## Global Constraints

- Only `Company=TEST-HRMS`; fixed attendance/payroll month `2099-01`.
- Never modify or delete data belonging to `永新` or `1`.
- Existing TEST records are read and validated but never overwritten.
- Global master records created by the seed must use a `TEST-` business name, except the canonical ERPNext Employment Type `Retainer` when absent; that exception must not update or link protected-company employees.
- Do not migrate, deploy, clear volumes, call DingTalk APIs, or use global attendance/payroll write functions.
- Attendance/apple/approval seeding requires Company fields and a company-scoped monthly lock API.
- Payroll seeding requires a locked TEST-HRMS `2099-01` attendance version and Company fields on all source/output records.
- Every personnel menu listed in the design must have a TEST row or an explicit `blocked` result.

---

### Task 1: Seed service source contract

**Files:**
- Create: `tests/verify_demo_seed.js`
- Create: `hrms/api/demo_seed.py`

**Interfaces:**
- Produces: `get_test_hrms_demo_status() -> dict`, `seed_test_hrms_demo(phases=None, dry_run=0) -> dict`, constants `TEST_COMPANY`, `DEMO_MONTH`, and ordered `PHASES`.

- [x] **Step 1: Write the failing source-contract test**

Test that `hrms/api/demo_seed.py` exists and contains the public entry points, `TEST-HRMS`, `2099-01`, all seven phases, protected-company snapshot markers, never-update marker, capability gates, and eight personnel-list labels.

- [x] **Step 2: Run the contract test and verify RED**

Run: `node tests/verify_demo_seed.js`
Expected: FAIL because `hrms/api/demo_seed.py` does not exist.

- [x] **Step 3: Add the minimal module skeleton**

Create constants, ordered phase names, empty structured-result helpers, and whitelisted status/seed functions that raise `NotImplementedError` for execution.

- [x] **Step 4: Run the contract test and verify GREEN**

Run: `node tests/verify_demo_seed.js`
Expected: PASS.

### Task 2: Safety core, dry-run, foundation, and employees

**Files:**
- Modify: `hrms/api/demo_seed.py`
- Modify: `tests/verify_demo_seed.js`

**Interfaces:**
- Produces: `_protected_snapshot()`, `_assert_protected_unchanged(before)`, `_get_existing()`, `_create_if_missing()`, `_doctype_capability()`, `_seed_foundation()`, `_seed_employees()`.

- [x] **Step 1: Extend the contract test for safety behavior markers**

Require explicit protected companies, create-only semantics, Company assertions, TEST global-name assertions, dry-run event recording, and employee manifest business keys.

- [x] **Step 2: Run the contract test and verify RED**

Expected: FAIL on the first missing safety marker/function.

- [x] **Step 3: Implement minimal safety and foundation phases**

Use Frappe metadata and ORM. If a stable business key exists, return `existing` without `save`, `db_set`, or update. On mismatched Company, return `blocked`. Create missing TEST departments, designations, employment types, two shift types, and employees `TEST-OUT-005` through `TEST-LEFT-008` with fictional data.

- [x] **Step 4: Verify contract GREEN and dry-run no-write**

Run the contract test, snapshot TEST counts, call `seed_test_hrms_demo(dry_run=1)`, and re-query counts.
Expected: contract PASS; all counts unchanged; dry-run lists planned records.

### Task 3: Personnel list data and lifecycle history

**Files:**
- Modify: `hrms/api/demo_seed.py`
- Modify: `tests/verify_demo_seed.js`

**Interfaces:**
- Produces: `_seed_personnel_lists()` and structured menu results for Employee Onboarding, Employee Promotion, Employee Transfer, Employee Property History, Employee Skill Map, Employee Grievance, Employee Separation, and Exit Interview.

- [x] **Step 1: Extend the contract test for all menu requirements**

Require stable keys, `docstatus` expectations, transfer detail fields, TEST reasons, and explicit block reasons for unsupported semantics.

- [x] **Step 2: Run and verify RED**

Expected: FAIL before `_seed_personnel_lists()` exists.

- [x] **Step 3: Implement standard DocType operations**

Create drafts where appropriate. Submit one Employee Transfer for `TEST-MOV-007`, create and cancel a second transfer so source history remains traceable, and never hand-write internal work history. Create Pending Exit Interview only after the TEST leaver has a relieving date. If standard validation or dependencies prevent a row, catch and record the exact exception as `blocked` without ignoring mandatory fields.

- [x] **Step 4: Verify contract GREEN**

Expected: PASS.

### Task 4: Recruitment seed orchestration

**Files:**
- Modify: `hrms/api/demo_seed.py`
- Modify: `tests/verify_demo_seed.js`

**Interfaces:**
- Produces: `_seed_recruitment()` capability detection and delegation to `hrms.api.recruitment_demo_seed.seed_recruitment_demo(company='TEST-HRMS')`.

- [x] **Step 1: Add recruitment-chain contract assertions**

Require the authoritative module/entry marker, complete TEST-REC inventory checks, `TEST-HRMS` Company argument, and linkage of the accepted applicant/offer to `TEST-MOV-007` onboarding.

- [x] **Step 2: Run and verify RED**

- [x] **Step 3: Implement minimum ownership-safe orchestration**

If the complete TEST-REC chain exists, report it as `existing` without calling or updating it. If incomplete and the entry is callable, delegate once to the authoritative seed. Never duplicate its Job Requisition/Opening/Applicant/Interview/Feedback/Offer business keys. Record Appointment Letter as blocked if required template/terms are unavailable.

- [x] **Step 4: Verify contract GREEN**

### Task 5: Training, skills, grievances, and performance

**Files:**
- Modify: `hrms/api/demo_seed.py`
- Modify: `tests/verify_demo_seed.js`

**Interfaces:**
- Produces: `_seed_training()` and `_seed_performance()`.

- [x] **Step 1: Add contract assertions for visible demo states**

Require Scheduled/Completed training, Employee Skill Map training rows, Skill, Training Result capability handling, Grievance semantic warning, Appraisal Template goals, Appraisal Cycle, Appraisal, and Employee Performance Feedback.

- [x] **Step 2: Run and verify RED**

- [x] **Step 3: Implement company-scoped records and TEST global masters**

Populate only fields present in site metadata and satisfy standard mandatory child tables. If a required linked template or workflow is absent, return `blocked` for that record while continuing independent records.

- [x] **Step 4: Verify contract GREEN**

### Task 6: Attendance/month-lock and payroll capability gates

**Files:**
- Modify: `hrms/api/demo_seed.py`
- Modify: `tests/verify_demo_seed.js`

**Interfaces:**
- Produces: `_seed_attendance()` and `_seed_payroll()` with no unsafe fallback.

- [x] **Step 1: Add negative-gate contract assertions**

Require all relevant DocTypes to expose Company and require an official company-scoped lock function/result before any write; prohibit calling legacy global generators when the gate fails.

- [x] **Step 2: Run and verify RED**

- [x] **Step 3: Implement gate-first phases**

Return `blocked` with missing fields/functions on the current database. Only if the entire gate passes may the code create TEST source candidates through official module APIs; never hand-create a monthly final or payroll output.

- [x] **Step 4: Verify contract GREEN**

### Task 7: Live idempotency run, inventory, and acceptance report

**Files:**
- Modify: `docs/acceptance/2026-07-13-test-hrms-acceptance-report.md`

**Interfaces:**
- Consumes: completed seed service.
- Produces: first/second run JSON evidence, command, TEST inventory, menu/role/state matrix, protected invariants, and explicit blocked modules.

- [x] **Step 1: Capture pre-run inventories**

List existing TEST records and protected Employee counts/max modified.

- [x] **Step 2: Run the seed once**

Run: `bench --site hrms.localhost execute hrms.api.demo_seed.seed_test_hrms_demo`
Expected: safe phases create missing records; blocked phases report reasons; protected invariants unchanged.

- [x] **Step 3: Run the seed a second time**

Run the same command.
Expected: `created=0`; no counts change; all seed-owned records report `existing` or the same `blocked` reason.

- [x] **Step 4: Query every TEST record and menu minimum**

Verify at least one visible TEST row per required list or record an exact block. Verify recruitment linkage, training states, performance linkage, and no non-TEST Company on seeded records.

- [x] **Step 5: Run the full verification set**

Run `node tests/verify_demo_seed.js`, relevant existing personnel/recruitment/training/performance contracts, Python compile/import checks, `git diff --check`, and fresh database invariants.

- [x] **Step 6: Update the acceptance report**

Include submission files, exact run/status commands, created/existing/blocked counts, TEST data cleanup keys without deleting them, menu entry and demo role matrix, and do not promote blocked items to passed.
