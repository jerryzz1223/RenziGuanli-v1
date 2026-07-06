# Attendance Workbench Design

## Goal

Build the first company-specific attendance workflow for Yongxin HR: restore the unified HR workbench entry, add an attendance import center, normalize DingTalk Excel exports, review daily attendance, handle attendance exceptions, and generate a monthly attendance final draft that can later feed payroll.

## Scope

This phase covers attendance data and payroll-ready attendance outputs only. It does not build the full payroll settlement sheet, does not replace DingTalk approvals, and does not integrate DingTalk APIs. DingTalk approval numbers, approval results, approval status, and approval records are stored as imported evidence.

## Reference Materials

The attendance workflow is based on these local source materials:

- `人资系统资料/人资流程模块/5.薪资福利管理/5.2人资考勤.xlsx`
  - `人资考勤制度作业规范`, document number `YXQC人资09`, version `V2.0`, dated `2025-11-28`.
  - Daily and monthly sheets: `1.1每日统计`, `1.2请假单`, `1.3苹果树`, `1.4每日统计`, `1.5出勤明细`, `1.6出勤异常`, `1.7苹果树`, `1.8工时汇总`, `1.9苹果树`, `1.10忘打卡`, `1.11考勤2稿`, `1.12考勤终稿`, `薪资结算表`.
- `人资系统资料/人资工作流程.xlsx`
  - `1.人资考勤` sheet, which gives the daily attendance judgment rules and the links between daily report, leave sheet, apple-tree data, exceptions, and monthly confirmation.
- `人资系统资料/人资流程模块/5.薪资福利管理/5.9钉钉软件.xlsx`
  - `钉钉使用管理办法`, document number `YXQC人资24`, version `V1.0`, dated `2025-11-28`, used as the DingTalk operation and approval-process support file.
- Reference screenshots from 2haoHR show the target operator structure: 考勤统计, 每日考勤, 月考勤表, 明细记录, 考勤报表, 字段管理, 考勤确认, 考勤管理, 考勤分组, 排班管理, 考勤规则, 打卡方式, 考勤设置, 假期管理.

## Unified Entry

`/desk/hrms-workbench` becomes the usable HR shell again instead of redirecting to `/desk/hr-setup`. The top module order is fixed as:

工作台、人事、组织、招聘、考勤假期、薪酬、审批、培训学习、绩效、更多。

The attendance module links to the attendance import center and the operational views for daily checks, exceptions, and monthly final summaries.

## Data Model

The implementation adds company-specific DocTypes under the HR module:

- `HRMS Attendance Import Batch`: one import event and month-level source metadata.
- `HRMS Attendance Day Check`: normalized employee-date attendance rows from `1.1每日统计`.
- `HRMS Attendance Exception`: reviewable attendance exceptions such as 忘打卡、迟到、早退、旷工、未申请加班.
- `HRMS Apple Reward Record`: normalized apple-tree reward/punishment rows from `1.3苹果树`.
- `HRMS Monthly Attendance Summary`: monthly final draft rows used by payroll later.

Existing Frappe HR DocTypes remain intact. Native `Attendance`, `Leave Application`, `Salary Slip`, and `Workflow` are not rewritten in this phase.

## Business Workflow

The company attendance process is broader than the first import page. The source procedure defines the high-level flow as:

系统排班 -> 工时计算 -> 出勤要求 -> 考勤报表 -> 请假 -> 异常处理。

The workbook operational flow has two layers:

- Daily attendance: DingTalk daily report, leave sheet, and apple-tree export feed `1.1每日统计`, `1.2请假单`, and `1.3苹果树`; HR performs judgment and manual correction into `1.4每日统计`, then produces department-level `1.5出勤明细`, `1.6出勤异常`, and `1.7苹果树`.
- Monthly attendance: HR exports the previous month's attendance and apple-tree data at month start, sends it to each department attendance owner, collects employee signatures, and consolidates `1.8工时汇总`, `1.9苹果树`, `1.10忘打卡`, `1.11考勤2稿`, and `1.12考勤终稿`.

Responsibility boundaries:

- HR owns daily attendance management, data export, statistics, month-end consolidation, and system operation.
- Department heads and attendance owners announce rules, verify department attendance data, gather employee signatures, and submit correction feedback.
- Employees must clock in/out, submit DingTalk leave, overtime, outing, and补卡 approvals, and confirm monthly attendance.

## Import Flow

The attendance import center accepts `.xlsx` files exported from the company workbook or DingTalk-derived sheets. It recognizes three required sheets:

- `1.1每日统计`
- `1.2请假单`
- `1.3苹果树`

The first implementation supports file upload, sheet/header detection, compact preview counts, and import into the custom DocTypes. The import stores raw row JSON for traceability and maps common headers used in the provided workbook.

The next implementation should distinguish source import from HR-corrected workpapers:

- Source evidence: `1.1每日统计`, `1.2请假单`, `1.3苹果树`.
- Corrected daily output: `1.4每日统计`, which should become the authoritative day-check state after HR review.
- Department daily communication: `1.5出勤明细`, with current headcount, attendance count, leave count, leave person, leave type/time/reason, and pending-leaver notes.
- Exception confirmation: `1.6出勤异常`, including employee, work date, unit, expected shift, actual clock-in/out, exception type, handling method, remarks, and signature confirmation.
- Monthly confirmation: `1.8工时汇总`, `1.9苹果树`, `1.10忘打卡`, `1.11考勤2稿`, and `1.12考勤终稿`.

## Daily Check

Daily check rows are keyed conceptually by employee code/name and attendance date. The view exposes:

姓名、工号、部门、日期、班次、上班时间、下班时间、标准工时、实际出勤、请假、工作日加班、休息日加班、节假日加班、大夜班、小夜班、旷工、迟到、早退、上班缺卡、下班缺卡。

The system keeps the DingTalk source values visible. It does not silently discard source columns that are not yet mapped; those values remain available in raw row JSON.

Daily check logic from the source materials:

- `1.1每日统计` source columns include employee identity, attendance group, department, job, DingTalk UserId, date, date type, shift, clock-in/out times, missing clock-in/out, absence, standard hours, actual attendance hours, approval summary, workday overtime, rest-day overtime, holiday overtime, large night shift, small night shift, leave hours by leave type, missing-card counts, late count, and early-leave count.
- `1.2请假单` must be filtered by approval status. Rows with `审批通过` and `已结束` are valid evidence. Rows with `终止` or not approved are treated as no valid leave for attendance judgment.
- `1.3苹果树` must also be filtered by approval result/status. Rows that are not approved or are terminated should not affect green/red apple totals.
- `1.4每日统计` is the corrected daily attendance table after HR judgment and should be modeled separately from the raw DingTalk daily export once the workflow moves beyond the first import phase.
- The 2haoHR-style daily view should expose both daily results and raw evidence: 出勤结果, 出勤时长, 最早上班时间, 最晚下班时间, and detail drill-down to clock, leave, outing, business-trip, overtime, and补卡 records.

## Exception Handling

Exceptions are generated from daily check rows and imported补卡/approval evidence when available. Each exception stores:

异常类型、处理方式、备注、确认状态、签字人/确认人、关联每日核对行、来源批次。

Initial exception types are 忘打卡、迟到、早退、旷工、未申请加班. Confirmation status starts as 待确认 and can become 已确认 or 已驳回.

Exception judgment rules from the source workbook:

- 忘打卡: check both workday and weekend clock-in/out cards. Employees submit a DingTalk补卡 application. Month-end statistics apply 2 red apples per occurrence unless the missed card is caused by force majeure such as power outage or device failure and HR approval confirms it can be treated as clocked.
- 迟到: on workdays, compare the actual clock-in time against the scheduled shift start. If `0 < late <= 0.5H`, deduct full-attendance bonus by 10 yuan and count 0.5H absence. If late time is greater than 0.5H, count absence by actual late duration. Late arrivals must submit DingTalk personal-leave evidence, otherwise the case can become absence. Expanded morning meeting lateness uses 07:43 as the threshold and is recorded as 1 red apple without full-attendance deduction.
- 旷工: workday no clock and no valid leave is absence. Formal employees reaching 24H or 3 occurrences, and probation employees reaching 8H or 1 occurrence, are severe disciplinary cases. Payroll deduction is 3 times the absence hours.
- 未申请加班: on weekdays, indirect employees whose attendance goes beyond basic 8H without overtime approval should be highlighted; on weekends, indirect employee attendance without overtime approval should also be highlighted.
- 未请假/早退: employees leaving work without leave or supervisor notice should be treated as absence for early-leave missing hours.

## Monthly Final Draft

The monthly summary aggregates daily checks and apple records by employee and month:

标准工时、实际出勤、1.5倍加班、2倍加班、3倍加班、请假、旷工、大夜班、小夜班、调整后工时、绿苹果、红苹果、苹果树金额。

This aligns with the attendance final draft and payroll settlement prerequisites in the source material, but it stops before generating the salary settlement table.

Monthly calculation rules from `1.11考勤2稿`, `1.12考勤终稿`, and `薪资结算表`:

- Standard hours are normal workdays multiplied by 8. Minimum working-hour unit is 0.5H.
- Basic attendance verification in the workbook uses: `actual clock attendance = DingTalk actual attendance -病假/2 -特休 -工伤 -丧假 -婚假`.
- Paid leave补工时 includes病假 50%, 特休, 工伤, 丧假, and婚假. 病假扣工时 is also 50%; 事假 produces full leave deduction hours.
- Workday排休 produces 1.5x absence hours. Personal leave and病假 deduction hours are first offset by 2x weekend overtime where applicable.
- Adjusted 1x settlement hours are calculated after offsetting absence hours against available 1.5x and 2x overtime buckets. Remaining 1.5x and 2x overtime become settlement overtime.
- Holiday overtime remains 3x overtime. Absence payroll deduction uses 3x absence hours.
- Night allowance values in the procedure are large night shift 45 yuan each and small night shift 24 yuan each.
- The payroll settlement table uses full salary divided by 174 hours for absence deduction calculations and uses base salary divided by 174 for overtime pay calculations.
- Apple-tree amount in the current system implementation is `(green apples - red apples) * 5`, but the payroll settlement workbook also carries apple values into the bonus/penalty area and should be verified against finance's final payroll rules before locking.

## 2haoHR Reference Mapping

The screenshots provide a useful target navigation and field model:

- 考勤分组 should support per-group attendance method, workdays/rest days, shift time, attendance rules, overtime rules, outing rules,补卡 rules, and applicable employees.
- 字段管理 should support attendance statistics fields such as daily attendance hours, total hours, night-shift allowance, remaining compensatory-leave hours, night-shift days, due attendance days, actual attendance days, due/actual attendance hours, and clock-day counts. Some fields are system fields; user-defined fields can use formulas.
- 考勤报表 should include汇总统计表, 明细记录表, 排班明细表, 异常考勤汇总表, 补卡统计表, 剩余假期统计表, 请假汇总表, 外勤汇总表, 加班汇总表, and employee daily attendance hours reports.
- 明细记录 should separate clock records,补卡 records, leave records, outing records, business-trip records, and overtime records.
- 月考勤表 should show month-level headcount and employment movement context, including total attendance population, new hires, transfers, resignations, full-attendance count, and absence count.

## Current Gaps

- `1.2请假单` rows are counted during import but not yet normalized into leave evidence records or joined to daily checks by employee and date range.
- The current exception generator does not yet apply the approval-status filters, late-time thresholds, invalid-leave-to-absence escalation, or overtime approval matching.
- The current monthly summary aggregates source fields but does not yet implement the full workbook formulas for paid leave补工时, absence offsets, adjusted hours, full-attendance deduction, red-apple penalties, or night-shift allowance.
- The first page does not yet model attendance groups, shift setup, clocking methods, daily corrected outputs, department confirmation signatures, or monthly second-draft/final-draft review status.

## Testing

Contract tests verify page routes, module labels, DocType files, API names, required field markers, and worksheet names. Syntax checks cover Python and JavaScript files. The tests are intentionally file-level because this repository is being customized without a running Frappe site in the current environment.
