# DingTalk Export V1 Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize a real DingTalk attendance export and provide a read-only preview of daily-statistics data without creating or updating any HRMS records.

**Architecture:** Keep the legacy `1.1每日统计/1.2请假单/1.3苹果树` path unchanged. Add a separate `dingtalk_export_v1` schema that is selected only when all four DingTalk sheets are present. Parse the `每日统计` row 3 and row 4 headers into stable column names, build a normalized preview in memory, and return only JSON for the Frappe page to render.

**Tech Stack:** Python, Frappe whitelisted API, openpyxl, Node contract test, Python fixture-driven test, Frappe Desk page JavaScript.

## Global Constraints

- Do not migrate DocTypes, write database records, or alter real attendance data.
- Do not modify approval, payroll, personnel, organization, or training modules.
- Preserve legacy template recognition and existing import behavior.
- Do not infer approval effectiveness from `关联审批单`.
- `原始记录` and `月度汇总` are counted for preview only in Phase 1.
- Empty actual-attendance cells are not converted to zero.

---

### Task 1: Establish the parsing contract

**Files:**
- Create: `tests/verify_dingtalk_export_preview.py`
- Modify: `tests/verify_attendance_workbench.js`

**Interfaces:**
- Consumes: `/Users/lrj/Desktop/考勤表.xlsx` when available; otherwise a generated equivalent workbook fixture.
- Produces: assertions for `detect_attendance_source`, `preview_dingtalk_export_v1`, and the Frappe page contract markers.

- [ ] **Step 1: Write the failing Python test**

```python
def test_preview_dingtalk_export_v1_reports_real_export_counts_and_headers():
    preview = module._preview_dingtalk_export_v1(workbook)
    assert preview["source_type"] == "dingtalk_export_v1"
    assert preview["record_counts"] == {
        "daily_statistics": 3029,
        "raw_records": 4058,
        "monthly_people": 233,
    }
    assert "请假/事假(小时)" in preview["field_mapping"]
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `python3 tests/verify_dingtalk_export_preview.py`

Expected: fail because the source recognizer and DingTalk preview parser do not exist.

- [ ] **Step 3: Extend the Node contract test with the V1 public markers**

```javascript
for (const marker of [
  "DINGTALK_EXPORT_V1_SHEETS",
  "dingtalk_export_v1",
  "每日统计",
  "打卡时间",
  "原始记录",
  "月度汇总",
  "_flatten_dingtalk_daily_headers",
  "_preview_dingtalk_export_v1",
]) {
  mustInclude(api, marker, `DingTalk V1 preview is missing marker: ${marker}`);
}
```

- [ ] **Step 4: Run the Node test and verify RED**

Run: `node tests/verify_attendance_workbench.js`

Expected: fail with a missing DingTalk V1 preview marker.

### Task 2: Add schema recognition and in-memory daily parsing

**Files:**
- Modify: `hrms/api/attendance_import.py`
- Test: `tests/verify_dingtalk_export_preview.py`

**Interfaces:**
- Consumes: `openpyxl.Workbook` with the four required DingTalk sheets.
- Produces: `_detect_attendance_source(workbook) -> str`, `_flatten_dingtalk_daily_headers(sheet) -> list[str]`, `_preview_dingtalk_export_v1(workbook) -> dict`.

- [ ] **Step 1: Implement only the functions required by the failing test**

```python
DINGTALK_EXPORT_V1_SHEETS = ["每日统计", "打卡时间", "原始记录", "月度汇总"]

def _detect_attendance_source(workbook):
    if all(_sheet_by_required_name(workbook, name) for name in DINGTALK_EXPORT_V1_SHEETS):
        return "dingtalk_export_v1"
    return "legacy_workbook"
```

- [ ] **Step 2: Merge row 3 and row 4 headers and preserve leave subfields**

```python
def _flatten_dingtalk_daily_headers(sheet):
    parent_row = list(sheet.iter_rows(min_row=3, max_row=3, values_only=True))[0]
    child_row = list(sheet.iter_rows(min_row=4, max_row=4, values_only=True))[0]
    return [
        _normalise_header(f"{_cell_text(parent)}/{_cell_text(child)}".strip("/"))
        for parent, child in zip(parent_row, child_row)
    ]
```

- [ ] **Step 3: Parse only data rows starting at row 5 and calculate preview quality flags**

```python
quality_warnings = {
    "missing_employee_code": 0,
    "missing_attendance_group": 0,
    "planned_hours_without_actual": 0,
    "duplicate_userid_workdate": 0,
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `python3 tests/verify_dingtalk_export_preview.py`

Expected: pass with `3029`, `4058`, `233`, and `请假/事假(小时)` assertions.

### Task 3: Route preview requests while preserving the legacy result

**Files:**
- Modify: `hrms/api/attendance_import.py`
- Test: `tests/verify_dingtalk_export_preview.py`

**Interfaces:**
- Consumes: `preview_attendance_workbook(file_url: str)`.
- Produces: legacy response unchanged or V1 response with `source_type`, `sheets`, `record_counts`, `field_mapping`, and `quality_warnings`.

- [ ] **Step 1: Add a failing test for the public response shape**

```python
def test_preview_response_identifies_dingtalk_v1_without_database_calls():
    result = module._preview_dingtalk_export_v1(workbook)
    assert result["source_type"] == "dingtalk_export_v1"
    assert result["missing_sheets"] == []
    assert result["database_writes"] == 0
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `python3 tests/verify_dingtalk_export_preview.py`

Expected: fail because the public preview result lacks the required field.

- [ ] **Step 3: Return the V1 preview only when all four DingTalk sheets exist**

```python
@frappe.whitelist()
def preview_attendance_workbook(file_url: str):
    workbook = _load_workbook(file_url)
    if _detect_attendance_source(workbook) == "dingtalk_export_v1":
        return _preview_dingtalk_export_v1(workbook)
    return _preview_legacy_attendance_workbook(workbook)
```

- [ ] **Step 4: Run focused Python and Node contract tests**

Run: `python3 tests/verify_dingtalk_export_preview.py`

Expected: pass.

Run: `node tests/verify_attendance_workbench.js`

Expected: pass.

### Task 4: Surface the read-only source context in the import page

**Files:**
- Modify: `hrms/hr/page/attendance_import_center/attendance_import_center.js`
- Test: `tests/verify_attendance_workbench.js`

**Interfaces:**
- Consumes: `preview_attendance_workbook` response.
- Produces: preview UI with source type, sheet rows, mapping, and warning counts; no import button for `dingtalk_export_v1`.

- [ ] **Step 1: Add the failing Node markers**

```javascript
for (const marker of ["来源类型", "字段映射", "数据质量告警", "dingtalk_export_v1"]) {
  mustInclude(attendancePageJs, marker, `Attendance page is missing V1 preview marker: ${marker}`);
}
```

- [ ] **Step 2: Run Node test and verify RED**

Run: `node tests/verify_attendance_workbench.js`

Expected: fail with a missing V1 page marker.

- [ ] **Step 3: Implement read-only presentation and block import for V1**

```javascript
const canImport = result.source_type !== "dingtalk_export_v1";
const action = canImport ? `<button data-import>确认导入</button>` : `<div class="alert alert-info">Phase 1 仅支持预览，不写入考勤数据。</div>`;
```

- [ ] **Step 4: Run Node test and JavaScript syntax verification**

Run: `node tests/verify_attendance_workbench.js`

Expected: pass.

Run: `node --check hrms/hr/page/attendance_import_center/attendance_import_center.js`

Expected: exit code 0.

### Task 5: Final Phase 1 verification

**Files:**
- Modify: `hrms/api/attendance_import.py`
- Modify: `hrms/hr/page/attendance_import_center/attendance_import_center.js`
- Modify: `tests/verify_attendance_workbench.js`
- Create: `tests/verify_dingtalk_export_preview.py`

- [ ] **Step 1: Compile only the modified Python module**

Run: `python3 -m py_compile hrms/api/attendance_import.py`

Expected: exit code 0.

- [ ] **Step 2: Run all Phase 1 tests**

Run: `python3 tests/verify_dingtalk_export_preview.py`

Expected: pass with the real export fixture or a generated equivalent.

Run: `node tests/verify_attendance_workbench.js`

Expected: `Attendance workbench contract passed.`

- [ ] **Step 3: Inspect the actual file through the parser in preview-only mode**

Run: `python3 tests/verify_dingtalk_export_preview.py --fixture /Users/lrj/Desktop/考勤表.xlsx --show-preview`

Expected: source type `dingtalk_export_v1`, daily `3029`, raw `4058`, monthly `233`, and warning counts without database writes.

## Review Checklist

- The legacy three-sheet preview still takes the legacy branch.
- The DingTalk V1 branch requires all four source sheets.
- The daily header merge exposes `请假/事假(小时)` and all requested identity, time, overtime, approval, and leave columns.
- Daily row parsing begins at Excel row 5.
- Preview returns no database calls or write operations.
- No files outside the attendance API, attendance page, attendance tests, and this plan are modified.
