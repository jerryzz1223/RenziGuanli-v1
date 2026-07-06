# Payroll Input Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the payroll input preparation layer after attendance finalization and before formal salary settlement.

**Architecture:** Add small company-specific payroll input DocTypes and a new `hrms.api.payroll_input` module. Keep native Frappe payroll untouched in this phase. Use one Frappe Page (`payroll-input-center`) for uploading monthly variable workbooks and generating monthly payroll input rows from `HRMS Monthly Attendance Summary`.

**Tech Stack:** Frappe DocType JSON, Frappe whitelisted Python APIs, openpyxl workbook parsing, Frappe Desk Page JavaScript, Node contract tests, Python/JavaScript syntax checks.

---

## File Structure

- Create `tests/verify_payroll_input_center.js`.
- Create `hrms/api/payroll_input.py`.
- Create `hrms/hr/page/payroll_input_center/payroll_input_center.json`.
- Create `hrms/hr/page/payroll_input_center/payroll_input_center.js`.
- Create `hrms/hr/page/payroll_input_center/payroll_input_center.css`.
- Create DocTypes:
  - `hrms/hr/doctype/hrms_payroll_variable_import_batch`
  - `hrms/hr/doctype/hrms_payroll_variable_record`
  - `hrms/hr/doctype/hrms_payroll_input_record`
- Modify `hrms/hr/page/hrms_workbench/hrms_workbench.js` and `.py` to add 薪资输入中心.

## Task 1: Contract Test

- [ ] Add `tests/verify_payroll_input_center.js` requiring the payroll input page, API markers, DocType markers, and workbench payroll entry.
- [ ] Run `node tests/verify_payroll_input_center.js` and verify it fails because the page/API/DocTypes are missing.

## Task 2: DocTypes

- [ ] Add `HRMS Payroll Variable Import Batch` with payroll month, source file, status, imported row counts.
- [ ] Add `HRMS Payroll Variable Record` with payroll month, employee identity, variable type, amount, source sheet, raw row JSON.
- [ ] Add `HRMS Payroll Input Record` with attendance fields, payroll variable fields, preliminary earning/deduction totals, and settlement status.

## Task 3: API

- [ ] Implement `preview_payroll_variable_workbook(file_url)`.
- [ ] Implement `import_payroll_variable_workbook(file_url, payroll_month)`.
- [ ] Implement `generate_payroll_input_records(payroll_month)`.
- [ ] Implement `list_payroll_variable_records(payroll_month)` and `list_payroll_input_records(payroll_month)`.

## Task 4: Page

- [ ] Add `payroll-input-center` route.
- [ ] Add upload/preview/import UI for variable workbooks.
- [ ] Add 薪资输入表 tab with generate action and table.
- [ ] Link payroll module cards to the page.

## Task 5: Verification

- [ ] Run `node tests/verify_payroll_input_center.js`.
- [ ] Run `node tests/verify_attendance_workbench.js`.
- [ ] Run `node --check hrms/hr/page/payroll_input_center/payroll_input_center.js`.
- [ ] Run `python3 -m py_compile hrms/api/payroll_input.py`.
