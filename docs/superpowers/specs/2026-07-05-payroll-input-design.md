# Payroll Input Center Design

## Goal

Build the second HR customization stage: a payroll input center that consolidates monthly attendance final data and payroll-related variable items before the system generates the formal salary settlement sheet.

## Scope

This phase does not create official `Salary Slip` records and does not replace the final salary settlement table. It prepares payroll inputs from validated monthly attendance and imported monthly variables:

- 全勤奖
- 住房补贴
- 学历补贴
- 宿舍扣款
- 社保个人承担
- 公积金个人承担
- 苹果树奖惩金额

The output is a per-employee monthly payroll input record that the next phase can use to build the salary settlement table.

## Data Model

Add company-specific HR DocTypes:

- `HRMS Payroll Variable Import Batch`: one uploaded workbook or manual import event.
- `HRMS Payroll Variable Record`: one monthly variable amount by employee and variable type.
- `HRMS Payroll Input Record`: one payroll-ready monthly row per employee.

The input record references monthly attendance summary data by employee/month and stores the current calculated payroll input fields. It intentionally remains separate from native Payroll DocTypes.

## Import Flow

The payroll input center supports `.xlsx` upload and recognizes company workbook sheets:

- `全勤奖`
- `住房补贴`
- `学历补贴`
- `社保名单`
- `每月员工住宿费用明细表`
- `人员住宿登记表`

The parser maps common headers: 工号、姓名、部门、金额、全勤奖、住房补贴、学历补贴、个人承担、当月扣款. Rows that cannot be matched to an amount are kept out of the generated variable records and reported in the preview counts.

## Generation Flow

For a selected month, `generate_payroll_input_records(payroll_month)` reads:

- `HRMS Monthly Attendance Summary`
- `HRMS Payroll Variable Record`

It creates one `HRMS Payroll Input Record` per employee/month with:

标准工时、实际出勤、调整后工时、1.5/2/3 倍加班、夜班、请假、旷工、苹果树金额、全勤奖、住房补贴、学历补贴、宿舍扣款、社保个人、公积金个人、应发前置合计、应扣前置合计、薪资结算状态。

## UI

Add `payroll-input-center` as the second-stage salary preparation page. The page has tabs:

- 变量导入
- 薪资输入表

The payroll module in the unified workbench links to the page.

## Testing

Add a file-level contract test for page route, API methods, DocType fields, required sheet names, and payroll module entry. Existing attendance and personnel tests must keep passing.
