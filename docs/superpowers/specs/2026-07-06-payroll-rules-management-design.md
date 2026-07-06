# Payroll Rules Management Design

## Goal

Build a company-specific payroll management center for Yongxin HR that turns the existing payroll Excel process into a rule-driven monthly workflow. The system must follow the source materials in `人资流程模块/5.薪资福利管理`, especially `5.1薪资福利.xlsx` and `5.2人资考勤.xlsx`, while keeping native ERPNext `Salary Slip` generation out of scope until the settlement table is stable.

## Source Materials

- `5.1薪资福利.xlsx`: payroll policy, salary structure, employee salary change form, education subsidy rules.
- `5.2人资考勤.xlsx`: attendance final draft and salary settlement table formulas.
- `5.5租房补贴.xlsx`: housing subsidy application, rental registration, monthly housing subsidy detail.
- `5.6员工宿舍.xlsx`: dormitory application, occupancy records, monthly dormitory utilities and deductions.
- `5.7员工保险.xlsx`: employee insurance process with monthly reduction before the 5th and addition before the 12th.
- `5.3职业卫生.xlsx`, `5.4劳动防护用品.xlsx`, `5.8 工伤管理.xlsx`, `5.9钉钉软件.xlsx`: compliance and evidence records. These can affect HR evidence and leave handling, but should not directly become payroll formula inputs unless a payroll amount is explicitly introduced.

## Current State

The project currently has a payroll input center with:

- `HRMS Payroll Variable Import Batch`
- `HRMS Payroll Variable Record`
- `HRMS Payroll Input Record`
- `HRMS Payroll Settlement Record`
- Page route `payroll-input-center`
- Tabs for variable import, payroll input records, and payroll settlement records

This is a useful foundation, but it is not yet a complete customized payroll management module. Salary structure, salary changes, welfare eligibility, dormitory deductions, insurance rules, source tracing, locking, confirmation, and export are incomplete.

## Target Module Shape

Rename the user-facing concept from "薪资输入中心" to "薪酬管理中心" while keeping the existing route `payroll-input-center` for compatibility. The page should become a work surface with these tabs:

1. 月度流程
2. 薪资主数据
3. 变量导入
4. 福利扣款
5. 薪资输入表
6. 薪资结算表
7. 差异检查/导出

The route remains a single Frappe Page to avoid more Desk registration issues. Each tab calls focused API methods and stores data in focused company-specific DocTypes.

## Phase 1: Payroll Master Data

Create salary master data before improving settlement calculations.

### Salary Structure Version

Stores one version of the company salary structure from `薪资架构`.

Required fields:

- structure_version
- effective_from
- effective_to
- status: 草稿, 已启用, 已停用
- source_file
- remarks

### Salary Grade

Stores rows from `薪资架构`.

Required fields:

- salary_structure_version
- job_nature: direct production, indirect production, staff/office, management, or imported text
- job_grade
- post_category
- base_salary
- function_allowance
- full_salary
- grade_difference
- grade_difference_ratio
- education_allowance
- multi_skill_allowance
- full_attendance_bonus_standard
- rental_subsidy_standard
- large_night_shift_allowance
- small_night_shift_allowance
- certificate_allowance

The source workbook has multiple salary architecture blocks with different post categories. The import must keep the original post category text instead of forcing it into a simplified enum.

### Employee Salary Change

Stores the `人事组薪资异动表` process.

Required fields:

- employee
- employee_code
- employee_name
- department
- designation
- education_level_text
- date_of_joining
- effective_date
- change_reason
- salary_grade
- base_salary
- function_allowance
- certificate_allowance
- multi_skill_allowance
- full_salary
- housing_fund_enabled
- social_insurance_enabled
- company_cost_total
- prepared_by
- reviewed_by
- approved_by
- status: 草稿, 待审核, 已批准, 已作废

Settlement should use the latest approved salary change effective on or before the payroll month. If no salary change exists, settlement should flag the row as missing salary master data instead of silently using zero.

## Phase 2: Welfare And Deduction Sources

Add source records for welfare and deductions. These records feed monthly payroll variables and settlement rows, but they stay separate so HR can audit the source.

### Education Subsidy

From `学历补贴工作月报管理办法`.

Rules:

- Eligible employees submit one monthly report.
- Eligibility lasts 24 monthly reports.
- New employees start from the month of joining.
- Employees before 2026-01-01 follow the transition rule described in the workbook.

Required records:

- education subsidy eligibility
- monthly education report
- monthly education subsidy amount
- status: 待提交, 已提交, 已确认, 已失效

### Rental Housing Subsidy

From `5.5租房补贴.xlsx`.

Rules:

- Non-Suzhou registered employees renting in Suzhou may be eligible.
- Suzhou registered employees and employees owning a house in Suzhou are not eligible.
- Dormitory residents follow dormitory subsidy rules instead of external rental subsidy rules.
- Monthly housing subsidy detail feeds payroll variables.

Required records:

- rental contract
- rental subsidy application
- external rental registration
- monthly housing subsidy detail

### Dormitory

From `5.6员工宿舍.xlsx`.

Rules:

- Track dormitory application, check-in, check-out, dormitory type, room, and deduction start/end.
- Monthly dormitory deduction = accommodation charge + water/electricity charge.
- Source sheet states water is 4.25 per ton and electricity is 0.9 per unit.
- Monthly detail requires employee signature/confirmation.

Required records:

- dormitory application
- dormitory occupancy
- dormitory standard configuration
- monthly dormitory utility deduction
- dormitory repair record as a non-payroll evidence table

### Insurance And Housing Fund

From `5.7员工保险.xlsx` and `薪资结算表`.

Rules:

- Monthly insurance reduction should be completed before the 5th.
- Monthly insurance addition should be completed before the 12th.
- Settlement uses personal social security, personal housing fund, company social security, and company housing fund.
- The current Excel derives company social security from personal social security ranges:
  - personal < 524.96 => company 0
  - personal = 524.96 => company 1256.82
  - 520 < personal < 531 => company 1269
  - 531 < personal < 636 => company 1522.8
  - personal > 636 => company 1649.7

The range logic is odd because `524.96` also satisfies `520 < personal < 531`. The exact equality branch must be evaluated first to match Excel behavior.

### Other Monthly Variables

Keep these as monthly payroll variable records with source tracing:

- 提案改善奖
- 跨部门支援奖
- 保养奖励
- 继续服务奖
- 所得税
- 年终奖所得税
- 水电费及扣款
- 已发福利
- 生产奖
- 其他奖金
- 其他扣款

## Phase 3: Settlement Formula Rules

The salary settlement table must match `5.2人资考勤.xlsx -> 薪资结算表`.

### Core Columns

Identity:

- 部门
- 工号
- 姓名

Salary master:

- 底薪
- 职能津贴
- 证书及多能工津贴
- 薪资小计

Attendance:

- 标准工时
- 基本出勤工时
- 缺勤工时
- 调整前周末加班
- 调整后缺勤工时
- 缺勤工时对应的扣除金额
- 调整后周末加班
- 平日加班时数
- 节假日加班时数

Overtime and night shift:

- 平日加班费
- 周末加班费
- 节假日加班费
- 加班费小计
- 大夜班次数
- 小夜班次数
- 夜班津贴

Bonus and deduction:

- 出勤工资
- 提案改善奖
- 红绿苹果
- 全勤奖住房学历补贴
- 生产奖
- 奖金小计
- 旷工工时
- 旷工扣款
- 迟到金额+全勤奖扣款
- 惩处小计

Final pay:

- 应付工资
- 保险基金员工负担额
- 住房公积金
- 提案改善奖及生日福利金已发
- 计税工资
- 继续服务奖
- 所得税代扣款
- 年终奖所得税
- 水电费及扣款
- 实发工资
- 保险基金公司负担额
- 住房公积金公司负担
- 公司实际负担总计

### Formula Mapping

Use these formulas:

- 薪资小计 = 底薪 + 职能津贴 + 证书及多能工津贴
- 缺勤工时 = 标准工时 - 基本出勤工时
- 调整后缺勤工时 = max(缺勤工时 - 调整前周末加班, 0)
- 缺勤扣除金额 = round(薪资小计 / 174 * 调整后缺勤工时, 2)
- 调整后周末加班 = 调整前周末加班 - 缺勤工时 + 调整后缺勤工时
- 平日加班费 = round(底薪 / 174 * 平日加班时数 * 1.5, 2)
- 周末加班费 = round(底薪 / 174 * 调整后周末加班 * 2, 2)
- 节假日加班费 = round(底薪 / 174 * 节假日加班时数 * 3, 2)
- 加班费小计 = 平日加班费 + 周末加班费 + 节假日加班费
- 夜班津贴 = 大夜班次数 * 45 + 小夜班次数 * 24
- 全勤奖住房学历补贴 = 全勤奖 + 住房补贴 + 学历补贴
- 奖金小计 = 提案改善奖 + 红绿苹果 + 全勤奖住房学历补贴 + 生产奖
- 旷工扣款 = round(薪资小计 / 174 * 旷工工时 * 3, 2)
- 惩处小计 = 旷工扣款 + 迟到金额+全勤奖扣款
- 应付工资 = 薪资小计 - 缺勤扣除金额 + 加班费小计 + 夜班津贴 + 奖金小计 - 惩处小计
- 计税工资 = 应付工资 - 社保个人 - 公积金个人 + 已发福利
- 实发工资 = 计税工资 - 所得税 - 年终奖所得税 - 水电费及扣款 + 继续服务奖 - 已发福利
- 公司社保 = Excel range rule based on 社保个人
- 公司公积金 = 个人公积金 unless manually overridden
- 公司实际负担总计 = 应付工资 + 公司社保 + 公司公积金 + 继续服务奖 + 已发福利

### Attendance Dependency

Settlement must read from `HRMS Monthly Attendance Summary`, not raw daily attendance. Attendance must already be finalized before payroll settlement.

The current `HRMS Monthly Attendance Summary` needs these fields to feed settlement reliably:

- basic_attendance_hours
- pre_adjust_weekend_overtime_hours
- adjusted_weekend_overtime_hours
- adjusted_absence_hours
- absence_deduction_hours
- weekday_overtime_settlement_hours
- weekend_overtime_settlement_hours
- holiday_overtime_settlement_hours
- full_attendance_bonus
- late_full_attendance_deduction

If attendance finalization has not produced these fields, payroll should show a missing-source warning rather than recomputing daily attendance inside payroll.

## Source Tracing

Every settlement amount must have a source type:

- attendance_final
- salary_master
- welfare_record
- variable_import
- manual_adjustment
- formula

Every settlement row should store source warnings. Examples:

- missing_salary_master
- missing_attendance_final
- missing_social_security
- missing_housing_fund
- manual_tax_required
- unresolved_company_social_security_rule

## Monthly Workflow

The `月度流程` tab should show:

1. Attendance final status
2. Salary master status
3. Welfare and deduction source status
4. Variable import status
5. Settlement generation status
6. Difference check status
7. Lock/confirm/export status

Payroll month states:

- 草稿
- 数据收集中
- 待生成
- 已生成
- 已复核
- 已锁定
- 已导出

Locked months cannot be regenerated unless explicitly unlocked by HR Manager or System Manager.

## Difference Checks

Before payroll lock, show these checks:

- Employee has attendance but no salary master.
- Employee has salary master but no attendance.
- Employee has dormitory occupancy but no dormitory deduction.
- Employee has rental subsidy eligibility but no monthly housing subsidy.
- Employee has social insurance enabled but no social security amount.
- Employee has housing fund enabled but no housing fund amount.
- Settlement net pay is negative.
- Company social security was inferred by range instead of explicit source.
- Manual tax is missing for employees with taxable salary.

## Export

Export should support a company salary settlement workbook matching the main columns in `薪资结算表`.

The export should not mutate records. It should render from locked or generated settlement records and include:

- settlement sheet
- source warning sheet
- variable source sheet

## Out Of Scope For This Stage

- Generating official ERPNext `Salary Slip`
- Posting accounting entries
- Payroll bank payment files
- DingTalk API integration
- Full replacement of occupational health, labor protection, and work injury records

## Implementation Order

1. Add payroll master data DocTypes and import/list APIs.
2. Add welfare/deduction source DocTypes for education subsidy, rental subsidy, dormitory, and insurance.
3. Refactor settlement formula to match Excel formulas exactly.
4. Add source tracing and missing-source warnings.
5. Replace the current page copy and layout with the customized payroll management center.
6. Add difference check and export.

## Validation

Contract tests must cover:

- All page tabs.
- All new DocType files.
- Required salary master fields.
- Required welfare/deduction source fields.
- Formula marker coverage for the settlement calculations.
- Source tracing and warning markers.

Runtime verification must include:

- JavaScript syntax checks.
- Python compile checks.
- Existing payroll input tests.
- Attendance workbench contract test.
- Container migration on `hrms.localhost` after DocType changes.
