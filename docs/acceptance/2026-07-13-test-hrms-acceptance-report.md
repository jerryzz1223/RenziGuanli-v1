# TEST-HRMS 本地试用链独立验收报告

- 执行日期：2026-07-13（Asia/Shanghai）
- 站点：`hrms.localhost`
- 运行环境：Docker；Frappe `17.x.x-develop`、ERPNext `17.x.x-develop`、HRMS `17.0.0-dev`
- 安全范围：仅允许写入 `Company=TEST-HRMS` 的虚拟测试数据；禁止修改 `永新`、`1`，禁止迁移、部署、清卷及调用钉钉 API。

## 1. 写入前只读基线

| 检查项 | 实际结果 | 判定 |
|---|---:|---|
| Company 总数 | 2 | 通过 |
| Company 名称 | `1`、`永新` | 通过 |
| Employee 总数 | 205 | 通过 |
| `永新` Employee 数 | 205 | 受保护基线 |
| `永新` Employee 最大 modified | `2026-07-13 10:21:31.834574` | 受保护基线 |
| `1` Employee 数 | 0 | 受保护基线 |
| `TEST-HRMS` | 不存在 | 允许进入隔离写入阶段 |
| 已有 TEST 部门/岗位 | 0 / 0 | 通过 |

只读命令类别：`docker ps`、`bench --site hrms.localhost list-apps`、`frappe.client.get_count/get_list`、经 `bench ... mariadb` 执行的 `SELECT`。

## 2. 能力与隔离审计

| 阶段 | 当前能力 | 初步判定 | 依据 |
|---|---|---|---|
| 公司/组织/员工 | Company、Department、Designation、Employee 均存在且带 Company 关联 | 可直接创建 | Frappe DocType/DocField 元数据 |
| 实习/试用/转正 | Employee 含 `employment_type`、`custom_probation_months`、`custom_is_confirmed`、`scheduled_confirmation_date`、`final_confirmation_date` | 可直接创建/部分可验证 | 站点 Custom Field 与 Employee 字段 |
| 培训/资格待确认 | Training Event 存在；尚无单一“员工培训资格待确认”主记录字段 | 依赖核对 | Training Event 需要培训项目/参与子表；资格状态更多见于薪资福利来源记录 |
| 岗位/薪资异动 | Employee Promotion、Employee Transfer、HRMS Employee Salary Change 存在 | 可创建但需逐项验证 | DocType 存在；薪资异动 API 接受员工和生效日 |
| 日考勤/苹果树/异常 | 自定义 DocType 与计算函数存在 | 正式链路阻塞 | 导入批次无 `company`，接口自动产生非 `TEST-` 批次名 |
| 审批证据 | 请假/苹果记录含审批号、结果、状态、有效标记 | 同步验收阻塞 | 无审批明细导出；禁止调用钉钉 API |
| 月度锁定 | 月汇总只有 `status=草稿/已确认/已导入薪资` | 阻塞 | 无 lock 字段或独立锁定 API；生成器按月份全局删除重建 |
| 薪资试算 | 输入/结算生成函数存在 | 阻塞 | 输入与结算 DocType 无 Company；生成器按月份全局删除重建 |

### 隔离门禁结论

`import_attendance_workbook()` 自动创建随机命名批次；`generate_monthly_attendance_summary()`、`generate_payroll_input_records()`、`generate_payroll_settlement_records()` 都按月份删除既有记录，未按公司过滤。因此这些写接口不满足本任务安全边界，本次不调用。

## 3. 测试数据方案

统一使用虚拟值：公司 `TEST-HRMS`；部门 `TEST-HRMS-DEPT`；岗位均以 `TEST-` 开头；员工/工号为 `TEST-INT-001`、`TEST-PRO-002`、`TEST-REG-003`、`TEST-EXC-004`；虚拟手机号使用 `19900000001` 至 `19900000004`，邮箱使用 `example.invalid` 域；测试月份使用 `2099-01`，避免与真实业务月份重叠。

| 场景 | 计划输入 | 关键期望 |
|---|---|---|
| TEST-INT-001 | Intern、3 个月试用、未转正 | 员工档案可查，状态为试用/实习，培训资格保持待确认 |
| TEST-PRO-002 | Probation、岗位变更、已批准虚拟薪资异动 | 保留原/新岗位或属性历史；生效日可追溯 |
| TEST-REG-003 | Full-time、已转正、正常 8h、有效加班、有效绿苹果 | 仅当官方导入链满足公司隔离后才允许落库汇总 |
| TEST-EXC-004 | 请假、补卡、缺卡、撤销/无效审批 | 无效证据不得进入有效请假/苹果金额；缺卡应生成异常 |

## 4. 分段执行记录

### 4.1 员工与组织

实际命令：通过 `bench --site hrms.localhost execute frappe.client.insert` 依次创建 Company、Department、Designation、Employee；每段后以 MariaDB `SELECT` 复核 Company/Employee 归属及受保护基线。

| DocType | 创建数量 | 实际结果 |
|---|---:|---|
| Company | 1 | `TEST-HRMS` |
| Department（显式） | 1 | `TEST-HRMS-DEPT - TEST` |
| Designation | 4 | `TEST-实习岗位`、`TEST-试用岗位`、`TEST-正式岗位`、`TEST-异动岗位` |
| Employee | 4 | 内部主键 `HR-EMP-00206` 至 `HR-EMP-00209`；姓名、工号、自定义工号均为四个 `TEST-*` 场景号 |

ERPNext 创建 Company 时还自动创建该公司专属基础主数据：96 个 Account、2 个 Cost Center、5 个 Warehouse、13 个默认 Department。这些记录的名称使用 ERPNext 默认名并以公司缩写 `- TEST` 结尾，均归属 `TEST-HRMS`；未修改其他公司记录。

预期/实际：四名员工全部链接 `TEST-HRMS` 和 `TEST-HRMS-DEPT - TEST`；实际一致。`永新` 员工数仍为 205，最大 `modified` 仍为 `2026-07-13 10:21:31.834574`；`1` 员工数仍为 0。

### 4.2 人事生命周期

| 检查 | 预期 | 实际 | 状态 |
|---|---|---|---|
| TEST-INT-001 员工档案 | Intern、3 个月、未转正 | `employment_type=Intern`、`custom_probation_months=3`、`custom_is_confirmed=否` | 通过 |
| TEST-INT-001 培训待确认 | 公司隔离、TEST 名称、待处理 | 创建 `TEST-INT-001-培训资格待确认`；`Scheduled`，员工行 `Open` | 通过 |
| 正式 Employee Onboarding | 可追溯入职单 | DocType 强制依赖 Job Applicant 和 Job Offer；本场景未伪造招聘链 | 阻塞 |
| TEST-PRO-002 试用期 | Probation、6 个月、待转正 | 字段实际一致 | 通过 |
| 正式转正确认流程 | 产生转正确认/审批记录 | 当前仅有 Employee 日期/自定义确认字段，未发现独立转正确认 API | 失败 |
| 岗位异动/任职历史 | TEST 可追溯异动且历史可查看 | Employee Promotion/Transfer 固定 `HR-EMP-*` autoname，无法满足 TEST 前缀；任职历史契约测试另有失败 | 失败 |
| 薪资异动 | TEST 前缀且可追溯 | DocType 忽略显式名称并生成随机 ID `ug1s5iuu81`；该虚拟记录已立即删除，当前 TEST 薪资异动数 0 | 失败 |

### 4.3 考勤、苹果树与异常

未调用任何正式写接口，创建数量均为 0。原因不是缺少虚拟数据设计，而是隔离门禁失败：导入批次无 Company 字段，且 `import_attendance_workbook()` 在 `hrms/api/attendance_import.py:579-589` 自动产生批次名，不能保证 `TEST-` 前缀。

不落库的函数验证：

- “审批通过 + 已结束”返回有效 `1`；“审批通过 + 已撤销”返回无效 `0`。
- 正常 8h + 工作日加班 2h：`adjusted_working_hours=8`、`overtime_1_5_settlement_hours=2`、全勤扣款 0。
- 8h 事假、2 个红苹果：`adjusted_absence_hours=8`、全勤扣款 50、红苹果罚额 10。
- 上班缺卡且无有效请假：同时产生“忘打卡”（2 个红苹果）与“旷工”（扣缺勤 8h）候选。

这些结果只证明纯规则函数当前行为，不代表导入、审批同步、异常落库或月度终稿端到端通过。

### 4.4 审批证据

真实审批明细尚未导出，且本任务禁止调用钉钉 API，因此审批同步创建数量为 0。仅纯函数的有效/撤销判定通过；“审批已同步”明确不通过验收。

### 4.5 月度锁定

创建数量为 0。`HRMS Monthly Attendance Summary` 只有草稿/已确认/已导入薪资状态，无 `lock`/`is_locked` 字段或锁定 API；生成函数还会在 `attendance_import.py:796-799` 按月份全局删除重建，不具备公司隔离。验收判定为失败。

### 4.6 薪资试算

创建数量为 0。`generate_payroll_input_records()` 在 `payroll_input.py:2029-2034`、`generate_payroll_settlement_records()` 在 `payroll_input.py:2126-2131` 均按月份全局删除/读取，未以 Company 过滤；同时依赖未通过的月度终稿。为保护 `永新` 和 `1`，本次不调用，判定为失败/依赖阻塞。

### 4.7 仓库契约测试

| 命令 | 实际结果 |
|---|---|
| `node tests/verify_attendance_workbench.js` | 通过 |
| `node tests/verify_employee_property_history.js` | 失败：来源单据按钮应仅在 `source_doctype` 与 `source_name` 同时存在时渲染 |
| `node tests/verify_payroll_input_center.js` | 通过 |
| `node tests/verify_payroll_settlement_center.js` | 通过 |
| `node tests/verify_payroll_module_linkages.js` | 通过 |
| `node tests/verify_payroll_welfare_sources.js` | 通过 |

## 5. 最终验收矩阵

| 场景/阶段 | 状态 | 验收结论 |
|---|---|---|
| TEST-INT-001 员工档案、实习/试用字段 | 通过 | 隔离公司、虚拟姓名/工号、实习和试用字段均可追溯 |
| TEST-INT-001 培训待确认 | 通过 | 公司隔离的 Scheduled 培训和 Open 员工行已创建 |
| TEST-INT-001 正式入职单 | 阻塞 | 依赖 Job Applicant、Job Offer 招聘链 |
| TEST-PRO-002 试用档案 | 通过 | Probation、6 个月、待转正字段正确 |
| TEST-PRO-002 转正确认 | 失败 | 缺少独立转正确认记录/API，只存在员工日期/确认字段 |
| TEST-PRO-002 岗位异动与任职历史 | 失败 | 固定非 TEST autoname；任职历史前端契约测试失败 |
| TEST-PRO-002 薪资异动 | 失败 | 内部记录名无法按 TEST 前缀；试建记录已删除 |
| TEST-REG-003 正常考勤/有效加班/苹果奖励规则 | 通过 | 仅纯函数级通过，不含正式导入/落库 |
| TEST-REG-003 正式考勤到月度汇总 | 失败 | 批次无 Company、批次名不可控、月汇总全月全局处理 |
| TEST-EXC-004 撤销审批无效 | 通过 | 纯函数返回无效 0 |
| TEST-EXC-004 缺卡异常规则 | 通过 | 纯函数产生忘打卡 + 旷工候选 |
| TEST-EXC-004 请假/补卡/审批证据落库 | 阻塞 | 无审批明细导出，且正式导入不满足隔离门禁 |
| 审批同步 | 阻塞 | 未提供审批导出；禁止调用钉钉 API |
| 月度锁定 | 失败 | 锁定字段/API 未实现；生成器全月删除重建 |
| 薪资试算 | 失败 | 无 Company 作用域且依赖未通过的月度终稿 |
| 受保护数据不变 | 通过 | `永新` 205 人且最大修改时间不变；`1` 仍 0 人 |

状态说明：`通过` 仅覆盖对应行明示的测试层级；纯函数通过不外推为端到端通过。

## 6. TEST 数据清理清单

当前保留的 TEST 数据：

| 类型 | 数量/标识 |
|---|---|
| Training Event | 1：`TEST-INT-001-培训资格待确认` |
| Employee | 4：内部主键 `HR-EMP-00206` 至 `HR-EMP-00209`，业务工号为四个 TEST 场景号 |
| Department | 14：1 个显式 TEST 部门 + 13 个 Company 自动默认部门，均 `company=TEST-HRMS` |
| Designation | 4 个 `TEST-*` 岗位（全局主数据，需单独删除） |
| Warehouse | 5，均 `company=TEST-HRMS` |
| Cost Center | 2，均 `company=TEST-HRMS` |
| Account | 96，均 `company=TEST-HRMS` |
| Company | 1：`TEST-HRMS` |
| HRMS Employee Salary Change | 0（不合规试建记录已删除） |
| 考勤/审批/月汇总/薪资结果 | 0 |

安全清理顺序（本次未执行）：

1. 用 Frappe 删除 `TEST-INT-001-培训资格待确认`。
2. 按 `company=TEST-HRMS` 删除四名 Employee；不要按 `HR-EMP-*` 范围批量删除。
3. 删除 `TEST-HRMS-DEPT - TEST` 与四个 `TEST-*` Designation。
4. 通过 Frappe/ERPNext Company 删除流程删除 `TEST-HRMS`，让系统处理其 96 个 Account、2 个 Cost Center、5 个 Warehouse、13 个默认 Department；禁止原始 SQL 级联删除。
5. 删除后重新核对 `永新` 205 人、`1` 0 人以及 Company 仅剩原两家。

## 7. 模块合入后的新增复测基线（待执行）

本节记录下一轮验收门禁，不表示对应模块已经通过。现有 `TEST-HRMS` 与四名 TEST 员工继续保留；不执行第 6 节清理步骤，不调用当前缺少 Company 作用域的全局考勤/薪资写接口。

### 7.1 来源工作簿只读基线

来源：`/Users/lrj/Documents/SAD/YOngxin/人资/副本人资系统沟通表260713.xlsx`。

| 检查 | 范围 | 只读复核结果 |
|---|---|---:|
| 花名册非空工号行 | `花名册!C4:C206` | 203 |
| 花名册唯一工号 | `花名册!C4:C206` | 203 |
| 花名册重复工号行 | `花名册!C4:C206` | 0 |
| 单日考勤非空工号行 | `每日统计（钉钉导出）!E5:E211` | 198 |
| 单日考勤唯一工号 | `每日统计（钉钉导出）!E5:E211` | 198 |
| 单日考勤重复工号行 | `每日统计（钉钉导出）!E5:E211` | 0 |
| 花名册与单日考勤匹配工号 | 两集合交集 | 193 |
| 单日考勤中缺失主档工号 | 考勤减花名册 | 5 |
| 花名册中当日无考勤工号 | 花名册减考勤 | 10 |

核对过程只输出聚合数量，不在报告中列出真实姓名、手机号、身份证或工号明细。

### 7.2 新增强制门禁

| 验收项 | 通过条件 | 当前状态 |
|---|---|---|
| 缺失主档 | 进入带 Company、业务工号、来源批次/文件/行号的异常队列；日核对、月锁、薪资均为 0 条 | 待模块合入复测 |
| 跨公司员工 | 进入原因明确的异常队列；不得使用、修改或复制 `永新`/`1` 员工数据 | 待模块合入复测 |
| 映射确认 | 只有人工确认且 Company 一致后才能进入日核对；保存确认人、时间、来源与目标员工；重跑不重复 | 待模块合入复测 |
| 工号展示 | TEST 花名册展示业务工号 `TEST-*`，不展示 `HR-EMP-*` 内部键 | 待任职历史/花名册模块合入复测 |
| 部门业务名 | 展示 `department_name` 业务名，如 `TEST-HRMS-DEPT`，不带内部 Company 后缀 | 待模块合入复测 |
| 身份证推导 | 仅以虚拟证件填充空白性别/出生日期/年龄；人工非空值不被覆盖；保留来源标记 | 待模块合入复测 |
| 状态统计 | `实习/试用/全职/外包/返聘` 分类过滤可解释、互斥口径明确、分类合计与总数一致 | 待模块合入复测 |
| 月锁 | 锁记录必须含 Company、月份、来源版本或哈希、锁定人、时间、源记录数；锁后不可原位改写 | 待月锁模块合入复测 |
| 锁定版薪资隔离 | 薪资只消费指定 `TEST-HRMS` 锁定版本，仅产生 TEST 工号；不得读取、删除或更新 `永新`/`1` 数据 | 待薪资 Company 隔离合入复测 |

### 7.3 复测执行约束

- 继续使用 `TEST-INT-001`、`TEST-PRO-002`、`TEST-REG-003`、`TEST-EXC-004`；Frappe 内部 autoname 无需以 `TEST-` 开头，隔离以 Company、业务工号和来源字段为准。
- 五类状态无法由四名员工同时覆盖时，允许对一名 TEST 员工做可回滚的分阶段状态迁移，并验证迁移前后两个分类各增减 1、总数不变；禁止为了凑数创建真实或跨公司员工。
- 跨公司用例必须使用 TEST-only 来源公司字段或另行获批的第二 TEST Company；若合入后的模型无法安全表达，标记 `阻塞`，不得借用 `永新` 或 `1` 员工作为测试对象。
- 每个写步骤前后都保存 `永新`/`1` 的记录数与最大 `modified`；任何变化立即终止复测。

## 8. TEST-HRMS 全模块虚拟演示种子执行报告

### 8.1 提交内容与运行入口

新增文件：

- `hrms/api/demo_seed.py`：全模块幂等编排、Company 安全门禁、dry-run、状态清单。
- `tests/verify_demo_seed.js`：公共入口、安全门禁、模块覆盖和禁止调用全局写函数的契约测试。
- `docs/superpowers/specs/2026-07-13-test-hrms-demo-seed-design.md`：设计与数据状态说明。
- `docs/superpowers/plans/2026-07-13-test-hrms-demo-seed.md`：TDD 实施与复测计划。

运行命令：

```bash
# 只读状态
docker exec docker-frappe-1 bash -lc \
  "cd /home/frappe/frappe-bench && bench --site hrms.localhost execute hrms.api.demo_seed.get_test_hrms_demo_status"

# 不写库预演
docker exec docker-frappe-1 bash -lc \
  "cd /home/frappe/frappe-bench && bench --site hrms.localhost execute hrms.api.demo_seed.seed_test_hrms_demo --kwargs '{\"dry_run\":1}'"

# 幂等补齐全部安全阶段
docker exec docker-frappe-1 bash -lc \
  "cd /home/frappe/frappe-bench && bench --site hrms.localhost execute hrms.api.demo_seed.seed_test_hrms_demo"

# 只补一个阶段；可用阶段见 PHASES
docker exec docker-frappe-1 bash -lc \
  "cd /home/frappe/frappe-bench && bench --site hrms.localhost execute hrms.api.demo_seed.seed_test_hrms_demo --kwargs '{\"phases\":[\"personnel_lists\"]}'"
```

招聘链由既有权威入口独占：`hrms.api.recruitment_demo_seed.seed_recruitment_demo(company='TEST-HRMS')`。全模块种子检测到完整 TEST-REC 数据后只报告 `existing`，未重建或覆盖。

### 8.2 TDD 与幂等证据

1. `node tests/verify_demo_seed.js` 首次因 `hrms/api/demo_seed.py` 不存在而失败。
2. 添加最小种子服务后契约测试通过，Python `py_compile` 通过。
3. `dry_run=1` 前后计数一致：Employee 4、Department 14、Training Event 1、Job Opening 2。
4. 首次真实补齐：基础主数据 10、员工 4、培训/技能可见记录 5、人事列表记录 6、绩效记录 5；随后以最小修复补建 Grievance Type/Employee Grievance 2 条。
5. 第二次完整运行所有阶段 `created=0`；记录全部为 `existing` 或保持相同 `blocked` 原因。

### 8.3 当前 TEST 数据清单

| 模块 | 数据与状态 |
|---|---|
| 公司 | `TEST-HRMS` 1 家 |
| 部门 | 4 个显式业务部门：`TEST-HRMS-DEPT`、`TEST-研发部`、`TEST-生产部`、`TEST-人资部`；另有 Company 自动默认部门 |
| 岗位 | 8 个 TEST 人事岗位；招聘独立种子另有 2 个 `TEST-REC-*` 岗位 |
| 班次 | `TEST-白班-0800-1700`、`TEST-夜班-2000-0430` |
| 员工 | 8 人：实习、试用、正式、异常样例、外包、返聘、转正/异动、离职各有覆盖 |
| 招聘 | 1 Staffing Plan、2 Job Opening、3 Applicant、3 submitted Interview、3 submitted Feedback、2 Offer |
| 培训 | 1 Training Program、3 Training Event、1 Employee Skill Map、TEST Skill；Training Result 阻塞 |
| 入职/转正 | 1 Employee Onboarding、1 submitted Employee Promotion |
| 异动/任职 | 1 submitted Transfer、1 cancelled Transfer；Transfer 属性历史 3 行，Promotion 另含转正/岗位属性历史 |
| 奖惩菜单 | 1 Employee Grievance；标准语义是员工申诉，不等同正式奖惩单 |
| 离职 | 1 draft Employee Separation、1 Pending Exit Interview |
| 绩效 | 1 KRA、1 Appraisal Template、1 In Progress Cycle、1 Appraisal、1 Performance Feedback |
| 考勤/月锁 | 0；Company/锁字段门禁未通过 |
| 薪资 | 0；Company/锁字段门禁未通过 |

员工业务状态：

| 工号 | 工作性质/状态 | 演示观察 |
|---|---|---|
| TEST-INT-001 | Intern / Active | 实习、未转正 |
| TEST-PRO-002 | Probation / Active | 试用、待转正 |
| TEST-REG-003 | Full-time / Active | 正式员工 |
| TEST-EXC-004 | Full-time / Active | 后续考勤异常样例 |
| TEST-OUT-005 | Contract / Active | 外包 |
| TEST-REH-006 | Retainer / Active | 退休返聘 |
| TEST-MOV-007 | Full-time / Active | 由 Promotion 转正，再通过 Transfer 转部门/岗位 |
| TEST-LEFT-008 | Full-time / Left | 离职、草稿离职单、待安排离职面谈 |

### 8.4 人事列表验收

| 列表 | 演示角色 | 菜单入口 | 状态 | 可预期观察 |
|---|---|---|---|---|
| 入职管理 | HR Manager | `/desk/employee-onboarding` | 通过 | TEST 候选人 + Accepted Offer + TEST-MOV-007 |
| 转正管理 | HR Manager | `/desk/employee-promotion` | 通过（语义说明） | submitted Promotion 将 Probation 改为 Full-time、写入转正日期和岗位 |
| 人事异动 | HR Manager | `/desk/employee-transfer` | 部分通过 | 1 条 submitted、1 条 cancelled；原/新部门岗位可见 |
| 任职记录 | HR Manager | `/desk/employee-property-history` | 通过 | 来自 Promotion/Transfer 的属性历史，不手写员工历史 |
| 培训经历 | HR Manager | `/desk/employee-skill-map` | 通过 | TEST-MOV-007 的 Skill 与已完成培训经历 |
| 奖惩记录 | HR Manager | `/desk/employee-grievance` | 通过（语义警告） | 1 条 TEST 记录；标准 DocType 实际是员工申诉 |
| 离职管理 | HR Manager | `/desk/employee-separation` | 通过 | TEST-LEFT-008 的 draft 离职单 |
| 离职面谈 | HR Manager | `/desk/exit-interview` | 通过 | TEST-LEFT-008，`status=Pending` |

明确阻塞：标准 Employee Transfer/Employee Property History 没有“异动原因”字段，因此无法同时满足截图要求的原因展示；种子没有将原因伪造成属性变更。Training Result 要求 Training Event 已提交，而既有 TEST 完成事件是草稿；种子遵守“不覆盖既有 TEST 数据”要求，未改写或强制提交该事件。

### 8.5 其他模块入口与观察结果

| 模块 | 演示角色 | 菜单入口 | 预期结果 |
|---|---|---|---|
| 花名册/组织 | HR Manager | 员工花名册、组织架构 | 8 名 TEST 员工；业务工号、部门、岗位与五类工作性质 |
| 招聘 | HR Manager / Interviewer | 招聘需求、职位、候选人、面试、Offer | TEST-REC 完整链，包含录用、待回复和淘汰候选人 |
| 培训 | HR Manager | 培训计划、事件、技能图谱 | Scheduled/Completed 与员工培训经历 |
| 绩效 | HR Manager / Employee | 绩效模板、周期、考评、反馈 | `TEST-2099-Q1` 及 TEST-REG-003 考评/反馈 |
| 考勤 | HR Manager | 考勤导入中心、异常、月度锁定 | 阻塞；不显示伪造的 TEST 月终稿 |
| 薪资 | Payroll Manager | 薪资资料、变量、试算 | 阻塞；没有 TEST 锁定考勤，不生成薪资 |

### 8.6 安全复测结论

- 2026-07-13 12:49 再次完整运行，各阶段 `created=0`；基础/员工/培训/招聘/人事/绩效分别识别已有 16/4/5/6/8/5 项，业务键幂等成立。
- `永新` Employee 仍为 205，最大 `modified=2026-07-13 10:21:31.834574`，与写入前基线一致。
- `1` Employee 仍为 0；Company modified 基线未变化。
- TEST-HRMS 当前 8 人；没有任何 TEST 业务工号链接到其他 Company。
- 未调用钉钉 API、未迁移、未部署、未清卷。
- 未调用全局考勤/月汇总/薪资生成函数；`2099-01` 考勤和薪资记录均为 0。

种子专项验证命令均返回 0：`verify_demo_seed.js`、`verify_recruitment_demo_seed.js`、`verify_employee_property_history.js`、`verify_personnel_roster.js`、`verify_payroll_company_isolation.js`、Python `py_compile` 和限定文件的 `git diff --check`。数据库复核得到：入职 1、转正 1、已生效异动 1、已撤销异动 1、任职属性历史 6 行、培训经历 1、申诉/奖惩菜单记录 1、草稿离职 1、待安排离职面谈 1；招聘链数量保持 1/2/3/3/3/2。

### 8.7 仓库全量契约结果

26 个 Node 契约中 24 个通过、2 个失败；失败均保持为模块阻塞，本任务未修改核心逻辑：

- `verify_attendance_workbench.js`：`attendance_import.py` 只有 `HRMS Attendance Month Lock` 常量，缺少契约要求的 `lock_attendance_month`/`unlock_attendance_month` 实现；当前站点元数据也仍缺 Company/`is_locked` 门禁字段。因此考勤、异常、苹果树和月锁不能进入演示写入。
- `verify_dingtalk_integration.js`：缺少契约要求的 `"sync_mode": "内网服务器主动拉取API"` 标记。真实钉钉文件的只读预览契约 `verify_dingtalk_export_preview.py` 使用工作区 Python 环境通过，但没有调用钉钉 API，也没有导入真实资料。

其余花名册、任职历史、招聘、绩效、人事报表、薪资公司隔离及薪资各工作台契约均通过。考勤/月锁失败继续阻塞薪资种子；不得据此声称“全模块均通过”。

### 8.8 TEST 数据保留与未来安全清理清单

本轮按指令保留全部 TEST 数据，没有执行清理。新增/补齐范围以以下业务键为准：

- 员工：原 4 名 `TEST-INT-001` 至 `TEST-EXC-004`，新增 `TEST-OUT-005`、`TEST-REH-006`、`TEST-MOV-007`、`TEST-LEFT-008`；清理时必须同时限定 `company=TEST-HRMS`，不能按内部 `HR-EMP-*` 号段删除。
- 人事事务：`HR-EMP-ONB-2026-00001`、`HR-EMP-PRO-2026-00001`、`HR-EMP-TRN-2026-00001/00002`、`HR-GRIEV-2026-00001`、`HR-EMP-SEP-2026-00002`、`HR-EXIT-INT-00001`，以及它们的标准子表/任职历史。
- 培训/绩效：`TEST-安全作业能力`、`TEST-入职安全培训`、两个 `TEST-2099-*` 培训事件、TEST Employee Skill Map、`TEST-交付质量`、`TEST-2099年度绩效模板`、`TEST-2099-Q1`、`HR-APR-2026-00001`、`HR-PF-2026-00001`。
- 招聘：由权威招聘种子维护的 `TEST-REC-*` 主数据与 1/2/3/3/3/2 事务链；全模块种子不拥有、未覆盖这些记录。
- 组织主数据：3 个新增 TEST 业务部门、4 个新增 TEST 岗位、2 个 TEST 班次及 Company 自动主数据。`Retainer` 是标准全局 Employment Type；未来不得因清理 TEST-HRMS 而直接删除，必须先确认全站无引用。
- 考勤/审批/苹果树/月锁/薪资：本轮没有创建 2099-01 记录，无需清理。

若未来明确授权清理，应先删除/取消 TEST 事务与其子表，再删除 8 名 TEST Employee，随后删除只由 TEST 使用的 TEST 全局主数据，最后通过 Frappe/ERPNext Company 删除流程处理 `TEST-HRMS` 的默认账户、成本中心、仓库和部门；全过程前后仍需复核 `永新=205`、`1=0`，禁止原始 SQL 级联或按内部 autoname 范围批量删除。
