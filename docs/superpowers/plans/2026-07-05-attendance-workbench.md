# Attendance Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the unified HR workbench and build the first company-specific attendance import, review, exception, and monthly final summary workflow.

**Architecture:** Keep Frappe HR native DocTypes intact and add focused company DocTypes for DingTalk/Excel-derived attendance data. Use one Frappe Page (`attendance-import-center`) as the first operator surface, with whitelisted Python APIs in a new `hrms.api.attendance_import` module for preview, import, listing, exception generation, and monthly summary generation. Keep `/desk/hrms-workbench` as the unified navigation shell and route attendance work to the new page.

**Business Source:** Use `人资系统资料/人资流程模块/5.薪资福利管理/5.2人资考勤.xlsx`, `人资系统资料/人资工作流程.xlsx`, and `人资系统资料/人资流程模块/5.薪资福利管理/5.9钉钉软件.xlsx` as the source of truth for workflow, judgment rules, sheet names, and approval evidence.

**Tech Stack:** Frappe Desk Page JavaScript, Frappe whitelisted Python APIs, Frappe DocType JSON, openpyxl-based workbook parsing, Node file-contract tests, Python and JavaScript syntax checks.

---

## File Structure

- Create `tests/verify_attendance_workbench.js`: contract for workbench restoration, attendance module routes, custom DocTypes, attendance API, and page markers.
- Modify `hrms/hr/page/hrms_workbench/hrms_workbench.js`: remove the redirect and render the module shell using existing backend APIs.
- Modify `hrms/hr/page/hrms_workbench/hrms_workbench.py`: add attendance module links for the import center, daily check, exception handling, and monthly final draft.
- Create `hrms/api/attendance_import.py`: Excel sheet detection, preview, import, list APIs, exception generation, and monthly summary generation.
- Create `hrms/hr/page/attendance_import_center/attendance_import_center.json`.
- Create `hrms/hr/page/attendance_import_center/attendance_import_center.js`.
- Create DocTypes:
  - `hrms/hr/doctype/hrms_attendance_import_batch`
  - `hrms/hr/doctype/hrms_attendance_day_check`
  - `hrms/hr/doctype/hrms_attendance_exception`
  - `hrms/hr/doctype/hrms_apple_reward_record`
  - `hrms/hr/doctype/hrms_monthly_attendance_summary`

## Business Flow To Preserve

- [ ] Preserve the source process: 系统排班 -> 工时计算 -> 出勤要求 -> 考勤报表 -> 请假 -> 异常处理.
- [ ] Treat `1.1每日统计`, `1.2请假单`, and `1.3苹果树` as source evidence.
- [ ] Treat `1.4每日统计` as HR-corrected daily attendance once manual judgment is introduced.
- [ ] Treat `1.5出勤明细`, `1.6出勤异常`, and `1.7苹果树` as daily communication and exception confirmation outputs.
- [ ] Treat `1.8工时汇总`, `1.9苹果树`, `1.10忘打卡`, `1.11考勤2稿`, and `1.12考勤终稿` as monthly confirmation and payroll-prep outputs.

## Task 1: Contract Test

- [ ] Write `tests/verify_attendance_workbench.js` with markers for `/desk/hrms-workbench`, `attendance-import-center`, the three required sheets, required DocTypes, and key APIs.
- [ ] Run `node tests/verify_attendance_workbench.js` and verify it fails on missing attendance import center markers.

## Task 2: Restore Unified Workbench

- [ ] Replace the redirect-only `hrms_workbench.js` with a real Desk page shell.
- [ ] Preserve module order: 工作台、人事、组织、招聘、考勤假期、薪酬、审批、培训学习、绩效、更多.
- [ ] Add attendance shortcuts in the shell for 考勤导入中心、每日考勤核对、考勤异常处理、月度考勤终稿.
- [ ] Run the workbench contract checks and JavaScript syntax check.

## Task 3: Attendance DocTypes

- [ ] Add the five HRMS attendance DocType JSON files and Python document classes.
- [ ] Include required fields for import batch, daily checks, exceptions, apple records, and monthly summaries.
- [ ] Run the contract test and Python syntax checks for new DocType controllers.

## Task 4: Attendance Import API

- [ ] Implement `preview_attendance_workbook(file_url)` with sheet detection for `1.1每日统计`, `1.2请假单`, and `1.3苹果树`.
- [ ] Implement `import_attendance_workbook(file_url, attendance_month)` to create a batch and normalized records.
- [ ] Implement `generate_attendance_exceptions(batch)` for 忘打卡、迟到、早退、旷工、未申请加班.
- [ ] Implement `generate_monthly_attendance_summary(attendance_month)` with aggregated payroll-ready columns.
- [ ] Run Python syntax checks and contract tests.

## Task 4A: Attendance Rule Refinements

- [ ] Normalize `1.2请假单` into leave evidence rows instead of only counting rows.
- [ ] Filter leave evidence by approval result/status: valid leave requires `审批通过` and `已结束`; `终止` or unapproved rows must not suppress absence.
- [ ] Normalize `1.3苹果树` with the same approval filter before monthly green/red apple aggregation.
- [ ] Join leave evidence to daily checks by employee/name, date range, and leave hours/type.
- [ ] Generate 忘打卡 from missing clock-in/out and补卡 evidence, with a place to record force-majeure HR approval.
- [ ] Generate 迟到 using shift start and actual clock-in. Apply the source thresholds: `0 < late <= 0.5H` counts 0.5H absence and 10 yuan full-attendance deduction; `late > 0.5H` counts actual late duration.
- [ ] Generate 旷工 when a workday has no valid clock/leave evidence; escalate invalid or missing personal-leave evidence from late/early-leave cases into absence when required.
- [ ] Generate 未申请加班 by comparing weekday/weekend overtime attendance to valid overtime approval evidence, especially for indirect employees.

## Task 5: Attendance Import Center Page

- [ ] Add upload and preview UI.
- [ ] Add import action and import result summary.
- [ ] Add tabs for 每日考勤核对、考勤异常处理、月度考勤终稿.
- [ ] Wire list APIs and generation actions.
- [ ] Run JavaScript syntax checks and contract tests.

## Task 5A: 2haoHR-Aligned Operator Views

- [ ] Add daily attendance result columns aligned with the screenshots: 出勤结果, 出勤时长, 最早上班时间, 最晚下班时间.
- [ ] Add detail tabs or drill-downs for 打卡记录, 补卡记录, 请假记录, 外出记录, 出差记录, and 加班记录.
- [ ] Add monthly attendance cards for total attendance population, new hires, transfers, resignations, full-attendance count, and absence count.
- [ ] Add report entry points for汇总统计表, 明细记录表, 排班明细表, 异常考勤汇总表, 补卡统计表, 剩余假期统计表, 请假汇总表, 外勤汇总表, 加班汇总表, and employee daily attendance hours reports.
- [ ] Add field-management support for calculated attendance fields such as daily attendance hours, total hours, night-shift allowance, remaining compensatory-leave hours, due/actual attendance days, due/actual attendance hours, and clock-day counts.

## Task 5B: Monthly Formula Parity

- [ ] Implement workbook formula parity for `1.11考勤2稿` and `1.12考勤终稿`.
- [ ] Compute actual clock attendance as DingTalk actual attendance minus病假 50%, 特休, 工伤, 丧假, and婚假.
- [ ] Compute paid leave补工时 for病假 50%, 特休, 工伤, 丧假, and婚假.
- [ ] Offset workday排休 absence against 1.5x overtime and personal-leave/病假 deductions against 2x weekend overtime where applicable.
- [ ] Preserve 3x holiday overtime as holiday overtime settlement hours.
- [ ] Compute adjusted 1x settlement hours, adjusted 1x absence hours, remaining 1.5x overtime, remaining 2x overtime, and 3x overtime.
- [ ] Compute large night shift and small night shift allowance using 45 yuan and 24 yuan per occurrence.
- [ ] Keep payroll settlement as a separate phase, but expose the payroll-prep fields needed by `薪资结算表`: standard hours, adjusted attendance hours, overtime buckets, night shifts, absence hours, apple values, housing/full-attendance related values, and remarks/signature status.

## Task 6: Final Verification

- [ ] Run `node tests/verify_attendance_workbench.js`.
- [ ] Run `node tests/verify_hrms_workbench_nav.js`.
- [ ] Run `python3 -m py_compile hrms/api/attendance_import.py hrms/hr/page/hrms_workbench/hrms_workbench.py`.
- [ ] Run `node --check hrms/hr/page/hrms_workbench/hrms_workbench.js`.
- [ ] Run `node --check hrms/hr/page/attendance_import_center/attendance_import_center.js`.
