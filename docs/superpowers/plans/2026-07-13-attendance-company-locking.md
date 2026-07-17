# Attendance Company Isolation and Locking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve DingTalk raw daily statistics and HR-adjusted daily statistics as separate attendance sources, while isolating all attendance data by company and preventing locked monthly summaries from being overwritten.

**Architecture:** Extend the existing attendance batch and day-check records with company and source provenance. Use an explicit monthly lock parent plus append-only audit records; the monthly generator selects only one company and the active draft version, and refuses to operate on a locked period. Payroll continues to consume the existing monthly summary fields `company`, `attendance_lock_version`, `lock_status`, and `source_checksum` without any attendance-driven payroll change.

**Tech Stack:** Frappe DocType JSON/controllers, Python attendance API, openpyxl parser, Node contract tests, Python fixture contract tests.

## Global Constraints

- Modify only attendance API, attendance DocTypes, attendance page/tests, and attendance documentation.
- Do not modify approval, payroll, employee, organization, or real data.
- `关联审批单` stays a source reference; approval effectiveness is not inferred.
- Raw `每日统计（钉钉导出）` and `每日统计（修改后）` remain separate records and source sheets.
- No monthly generator may delete, update, or regenerate a locked company/month/version.

---

### Task 1: Fixture contracts for source provenance and company scope

**Files:**
- Modify: `tests/verify_dingtalk_export_preview.py`
- Modify: `tests/verify_attendance_workbench.js`

**Interfaces:**
- Consumes: `/Users/lrj/Documents/SAD/YOngxin/人资/副本人资系统沟通表260713.xlsx`.
- Produces: `company_attendance_workbook_v1` preview with two daily sources and exact source field distinctions.

- [ ] **Step 1: Write failing parser assertions**

```python
preview = module._preview_company_attendance_workbook(workbook)
assert preview["source_type"] == "company_attendance_workbook_v1"
assert preview["daily_sources"]["dingtalk_raw"]["data_start_row"] == 5
assert preview["daily_sources"]["manual_adjustment"]["data_start_row"] == 3
assert "UserId" in preview["daily_sources"]["dingtalk_raw"]["headers"]
assert "UserId" not in preview["daily_sources"]["manual_adjustment"]["headers"]
```

- [ ] **Step 2: Run RED verification**

Run: `/Users/lrj/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 tests/verify_dingtalk_export_preview.py`

Expected: fail because the company-workbook parser does not exist.

- [ ] **Step 3: Add failing locking contract markers**

```javascript
for (const marker of [
  "HRMS Attendance Month Lock",
  "HRMS Attendance Lock Audit",
  "company",
  "lock_attendance_month",
  "unlock_attendance_month",
  "attendance_lock_version",
]) mustInclude(api, marker);
```

- [ ] **Step 4: Run RED verification**

Run: `node tests/verify_attendance_workbench.js`

Expected: fail because the lock APIs and source-provenance contract do not exist.

### Task 2: Parse both company daily sheets without writing records

**Files:**
- Modify: `hrms/api/attendance_import.py`
- Test: `tests/verify_dingtalk_export_preview.py`

**Interfaces:**
- Produces: `_preview_company_attendance_workbook(workbook) -> dict`.
- Produces: `_daily_rows_from_header_rows(sheet, header_rows, data_start_row) -> list[dict]`.

- [ ] **Step 1: Implement the smallest generic two-row header parser**

```python
def _daily_rows_from_header_rows(sheet, header_rows, data_start_row):
    headers = _flatten_dingtalk_headers(sheet, *header_rows)
    return _rows_from_headers(sheet, headers, data_start_row)
```

- [ ] **Step 2: Map required source fields**

```python
DINGTALK_DAILY_FIELD_MAPPING.update({
    "日期类型": "date_type", "上班缺卡": "missing_in_source",
    "下班缺卡": "missing_out_source", "请假/旷工(小时)": "absent_hours",
})
```

- [ ] **Step 3: Run GREEN verification**

Run: `/Users/lrj/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 tests/verify_dingtalk_export_preview.py`

Expected: both the real DingTalk export and company workbook fixture contracts pass with no database writes.

### Task 3: Add company and source provenance fields

**Files:**
- Modify: `hrms/hr/doctype/hrms_attendance_import_batch/hrms_attendance_import_batch.json`
- Modify: `hrms/hr/doctype/hrms_attendance_day_check/hrms_attendance_day_check.json`
- Create: `hrms/hr/doctype/hrms_attendance_month_lock/*`
- Create: `hrms/hr/doctype/hrms_attendance_lock_audit/*`
- Modify: `tests/verify_attendance_workbench.js`

**Interfaces:**
- Batch requires `company`, `source_type`, `source_checksum`.
- DayCheck requires `company`, `source_kind`, `source_sheet`, `source_row_number`, `correction_version`.
- Month Lock key is `company + attendance_month`; audit rows are append-only.

- [ ] **Step 1: Create DocType contract test before JSON edits**

```javascript
mustInclude(batchJson, '"fieldname": "company"');
mustInclude(dayCheckJson, '"fieldname": "source_kind"');
mustExist("hrms/hr/doctype/hrms_attendance_month_lock/hrms_attendance_month_lock.json");
```

- [ ] **Step 2: Run RED verification**

Run: `node tests/verify_attendance_workbench.js`

Expected: fail on missing attendance lock DocType.

- [ ] **Step 3: Add fields and DocTypes**

```text
Month Lock status: 草稿, 已锁定, 已重开
Audit action: 锁定, 解锁, 创建更正版本
```

- [ ] **Step 4: Run GREEN verification**

Run: `node tests/verify_attendance_workbench.js`

Expected: attendance contract passes.

### Task 4: Scope generator and enforce lock transitions

**Files:**
- Modify: `hrms/api/attendance_import.py`
- Test: `tests/verify_dingtalk_export_preview.py`
- Test: `tests/verify_attendance_workbench.js`

**Interfaces:**
- `generate_monthly_attendance_summary(company: str, attendance_month: str)`.
- `lock_attendance_month(company: str, attendance_month: str, reason: str = "")`.
- `unlock_attendance_month(company: str, attendance_month: str, reason: str)`.

- [ ] **Step 1: Write failing scope test**

```python
assert module._attendance_scope_filters("Company A", "2026-07", "1") == {
    "company": "Company A", "attendance_month": "2026-07",
    "attendance_lock_version": "1",
}
```

- [ ] **Step 2: Run RED verification**

Run: `/Users/lrj/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 tests/verify_dingtalk_export_preview.py`

Expected: fail because the scoped filter helper does not exist.

- [ ] **Step 3: Implement no-delete scoped generation**

```python
if lock.status == "已锁定":
    frappe.throw(_("考勤月份已锁定，不能重新生成。"))
filters = _attendance_scope_filters(company, attendance_month, lock.active_version)
```

- [ ] **Step 4: Implement explicit lock/unlock audit insertion**

```python
_append_lock_audit(lock, "锁定", reason)
_append_lock_audit(lock, "解锁", reason)
```

- [ ] **Step 5: Run GREEN verification**

Run: `/Users/lrj/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 tests/verify_dingtalk_export_preview.py`

Expected: company scope and parser assertions pass.

### Task 5: Final verification

**Files:**
- Modify: `hrms/api/attendance_import.py`
- Modify: attendance DocType JSON/controllers and tests only.

- [ ] **Step 1: Run focused contracts**

Run: `/Users/lrj/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 tests/verify_dingtalk_export_preview.py`

Expected: parser and scope contract passed.

Run: `node tests/verify_attendance_workbench.js`

Expected: `Attendance workbench contract passed.`

- [ ] **Step 2: Run syntax checks**

Run: `/Users/lrj/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m py_compile hrms/api/attendance_import.py hrms/hr/doctype/hrms_attendance_month_lock/hrms_attendance_month_lock.py hrms/hr/doctype/hrms_attendance_lock_audit/hrms_attendance_lock_audit.py`

Expected: exit code 0.

- [ ] **Step 3: Run whitespace validation**

Run: `git diff --check -- hrms/api/attendance_import.py hrms/hr/doctype tests/verify_dingtalk_export_preview.py tests/verify_attendance_workbench.js`

Expected: exit code 0.

## Self-Review

- Source parsing has one task for raw `R3:R4 / R5` and one for manual `R1:R2 / R3` data.
- Company is present on Batch, DayCheck, MonthSummary, Lock, and Audit. MonthSummary is already owned by the payroll thread and is read, not edited here.
- Locking blocks generator mutation and preserves versioned history; no global month delete remains.
- Payroll handoff stays limited to shared company/month/lock-version fields.
