# Attendance Demo Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide repeatable `TEST-HRMS` attendance demo data that proves raw DingTalk rows, manual corrections, exceptions, monthly generation, and locked payroll-ready output work together.

**Architecture:** Keep all demo writes under `Company=TEST-HRMS` and an attendance-only period `2099-02`. The attendance API owns source records, effective-row selection, lock checks, and audit; the existing generic demo seed continues to own company and employee creation.

**Tech Stack:** Frappe Python API and DocTypes, existing local Docker/Bench launcher, Python fixture contracts, Node source contracts.

## Global Constraints

- Do not write production companies, real employees, approval records, or payroll records.
- Do not add real-time DingTalk API calls; use deterministic simulated DingTalk source rows only.
- `关联审批单` remains a reference and never becomes approval evidence.
- The seed is idempotent and only permits `TEST-HRMS`.
- Locking must reject unresolved attendance exceptions and preserve locked history.

### Task 1: Add the demo contract first

**Files:**
- Modify: `tests/verify_attendance_workbench.js`
- Modify: `tests/verify_dingtalk_export_preview.py`

- [ ] Assert that the API declares `TEST-HRMS`, `2099-02`, `seed_test_attendance_demo`, and a lock readiness check.
- [ ] Run the two attendance contracts and confirm the new contract fails because the seed entry point does not exist.

### Task 2: Enforce source and company validity

**Files:**
- Modify: `hrms/api/attendance_import.py`
- Test: `tests/verify_dingtalk_export_preview.py`

- [ ] Reject imported daily rows whose resolved employee belongs to a company other than the selected batch company.
- [ ] Keep unmatched rows out of generated monthly summaries; expose their count as an import warning.
- [ ] Check that a month has no pending exception before locking.
- [ ] Run the focused parser and source contracts.

### Task 3: Seed a sealed attendance demonstration month

**Files:**
- Modify: `hrms/api/attendance_import.py`
- Modify: `scripts/hrms-local.sh`
- Test: `tests/verify_attendance_workbench.js`

- [ ] Create a deterministic batch for `TEST-HRMS / 2099-02`.
- [ ] Create raw and manual rows for the same employee/date, plus a confirmed anomaly row for a second employee.
- [ ] Generate the month, mark the seeded exception confirmed, lock the month, and append lock audit records.
- [ ] Add `seed-attendance` and `seed-attendance-dry-run` launcher commands.

### Task 4: Verify the local closure

- [ ] Run parser, workbench, syntax, JSON, and whitespace checks.
- [ ] If Docker is available, run `migrate`, then dry-run and actual attendance seed, and read back its status.
- [ ] Report the exact seeded company/month, records created or reused, and any environment blocker.
