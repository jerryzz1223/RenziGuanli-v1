# TEST-HRMS 完整薪资试点操作说明

## 目的

该试点在本地模拟公司 `TEST-HRMS` 的 `2099-03` 月度薪资结算。它不写入永新公司数据，使用系统实际的导入、锁定、试算和确认接口，不从 Excel 结算终稿直接复制金额。

## 一键运行

在 `人资管理系统` 目录执行：

```bash
./scripts/hrms-local.sh start
./scripts/hrms-local.sh migrate
./scripts/hrms-local.sh seed-full-payroll
./scripts/hrms-local.sh seed-full-payroll-status
```

先看预计动作、不写数据：

```bash
./scripts/hrms-local.sh seed-full-payroll-dry-run
```

查看所有可编辑记录及其 Frappe 表单路由：

```bash
./scripts/hrms-local.sh seed-full-payroll-records
```

若需从头重新跑该试点，只清除 `TEST-HRMS / 2099-03`：

```bash
./scripts/hrms-local.sh seed-reset-full-payroll
./scripts/hrms-local.sh seed-full-payroll
```

## 模拟范围

| 项目 | 试点内容 | 最终写入 |
| --- | --- | --- |
| 组织与人员 | 4 个部门、8 名实习/试用/正式/外包/返聘/离职状态员工 | `Department`、`Employee` |
| 考勤导入 | 176 条 `1.1每日统计`、2 条已审批请假、2 条苹果树记录 | 导入批次、每日考勤、请假证据、苹果树记录 |
| 考勤异常 | 忘打卡、迟到、早退、旷工、未申请加班 | `HRMS Attendance Exception`，全部复核后锁定 |
| 手动考勤调整 | `TEST-MOV-007` 0.5 小时事假，保留原始行和更正版本 | `HRMS Attendance Day Check` |
| 月度锁定 | 4 个部门确认后锁定月度终稿 | 月度考勤终稿、月度锁定、锁定审计 |
| 薪资主数据 | 8 条 Excel 薪资异动，含底薪、职能、证书、多能工和薪资小计 | `HRMS Employee Salary Change` |
| 手动调薪 | `TEST-TRN-004` 于 2099-03-15 调整为底薪 3500 | `HRMS Employee Salary Change` |
| 福利扣款 | 学历、租房、宿舍、社保公积金、生产奖、提案、继续服务、所得税、水电、离职结算等 | `HRMS Payroll Welfare Source Record` |
| 变量导入与修改 | 导入全勤奖和奖惩；将 `TEST-REG-003` 全勤奖由 200 手动改为 180 | 变量批次、`HRMS Payroll Variable Record` |
| 结算确认 | 生成 8 条薪资输入、8 条薪资结算并确认 | `HRMS Payroll Input Record`、`HRMS Payroll Settlement Record` |

## 数据流与边界

1. 考勤 Excel 先进入每日统计、请假证据、苹果树记录。
2. 所有异常确认，部门确认完成后才锁定 `2099-03` 考勤版本。
3. 薪资异动和福利扣款 Excel 进入来源记录；福利来源同步为月度变量。
4. 手工变更只能修改薪资异动、福利来源或变量明细，不修改结算结果。
5. 薪资输入表只读取同一 `company + payroll_month + attendance_lock_version` 的已锁定考勤终稿和变量。
6. 结算表由系统公式生成，确认后不能覆盖。每条输入和结算记录均保存考勤、变量及薪资异动的追溯 JSON/哈希。

## 预期验收结果

- 公司：`TEST-HRMS`
- 月份：`2099-03`
- 考勤锁定状态：`已锁定`
- 考勤终稿、薪资输入、薪资结算：各 8 人
- 结算状态：8 条均为 `已确认`
- `TEST-TRN-004` 结算底薪：`3500`
- 异常类型必须同时包含：`忘打卡`、`迟到`、`早退`、`旷工`、`未申请加班`

## 可编辑位置

使用 `seed-full-payroll-records` 返回的 `edit_route` 打开相应表单。允许在测试公司中编辑部门、员工、考勤更正、薪资异动、福利来源和变量；重新生成前必须先执行完整试点清理，避免已确认结算被覆盖。

结算页只用于查看和确认。要改变金额，请返回其来源记录：考勤终稿、薪资异动、福利扣款来源或薪资变量，再重新生成本月输入表和结算表。
