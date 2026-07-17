# TEST-HRMS 全模块演示种子设计

## 目标

为本地 `hrms.localhost` 提供可重复运行、可审计、无需手工 UI 的完整虚拟演示数据。唯一数据范围是 `Company=TEST-HRMS`，固定考勤/薪资月份是 `2099-01`；绝不修改、删除或引用 `永新`、`1` 的业务数据。

## 方案选择

采用 Frappe Python 种子服务，而不是 Shell 命令串或静态 fixtures：

- Python 服务可在写入前读取 DocType 元数据，按模块能力安全跳过未就绪阶段。
- 每条演示记录使用稳定业务键查询；已存在时只返回 `existing`，不覆盖字段。
- 每阶段返回 `created/existing/skipped/blocked/errors` 及记录清单，第二次运行应新增 0 条。
- Shell 只保留一个稳定运行入口：`bench --site hrms.localhost execute hrms.api.demo_seed.seed_test_hrms_demo`。

## 安全模型

1. 所有 Company 字段必须是 `TEST-HRMS`。
2. 无 Company 字段的全局主数据默认只能使用 `TEST-*` 名称；唯一例外是站点缺失时补建 ERPNext 标准 Employment Type `Retainer`，用于“退休返聘”标准筛选语义。该例外不链接或修改受保护公司的员工。
3. 员工以 `employee_number/custom_employee_code` 为业务键；内部 `HR-EMP-*` 仅作为 Frappe Link。
4. 现有 TEST 记录不更新，只校验业务键和 Company；冲突进入 `blocked`。
5. 写入前后快照 `永新`、`1` 的 Employee 数量和最大 `modified`；不一致则抛错并停止。
6. 不迁移、不部署、不清卷、不调用钉钉 API。
7. 考勤/审批/苹果树只有在批次、日核对、证据、苹果树、月汇总都具备 Company 字段且月锁 API 可用时创建。
8. 薪资只有在 TEST-HRMS 的 `2099-01` 月锁已存在且薪资记录具备 Company 字段时创建。

## 种子阶段

### 1. 基础组织

- 公司：复用或创建 `TEST-HRMS`。
- 部门：`TEST-HRMS-DEPT`、`TEST-研发部`、`TEST-生产部`、`TEST-人资部`。
- 岗位：复用既有 4 个 TEST 岗位，并补充 `TEST-外包岗位`、`TEST-返聘顾问`、`TEST-招聘专员`、`TEST-离职岗位`。
- 班次：`TEST-白班-0800-1700`、`TEST-夜班-2000-0430`。

### 2. 员工生命周期

保留现有 4 名员工，新增最多 4 名，共 8 人：

| 业务工号 | 演示状态 | 关键观察 |
|---|---|---|
| TEST-INT-001 | 实习 | 实习、3 个月、未转正 |
| TEST-PRO-002 | 试用 | 试用、待转正 |
| TEST-REG-003 | 正式 | 已转正、正常在职 |
| TEST-EXC-004 | 正式异常样例 | 后续考勤异常候选 |
| TEST-OUT-005 | 外包 | 外包 Employment Type |
| TEST-REH-006 | 退休返聘 | 返聘 Employment Type |
| TEST-MOV-007 | 转正/异动 | 转正日期、岗位异动与任职历史 |
| TEST-LEFT-008 | 离职 | Left、离职日期/离职流程 |

新增记录使用虚拟姓名、`example.invalid` 邮箱、`1990000000X` 手机号和虚拟证件信息。

人事菜单的数据可见性是硬验收，不以空菜单或仅有员工主档代替：

- 入职管理：至少 1 条 Employee Onboarding，链接 TEST 候选人、Offer 和对应员工。
- 转正管理：至少 1 条 Employee Promotion；若标准 Promotion 只能表达晋升而不能表达转正确认，明确标记“转正语义阻塞”，不伪称完整转正流程。
- 人事异动：至少 1 条已提交生效和 1 条已取消的 Employee Transfer，变更明细包含原/新部门、原/新岗位和 TEST 原因。
- 任职记录：必须由提交/取消 Transfer 或 Promotion 的 Employee Property History 明细产生，不直接手写 Employee 内部历史。
- 培训经历：至少 1 条 Employee Skill Map，包含 Training Event/日期与 TEST Skill。
- 奖惩记录：至少 1 条 Employee Grievance；该标准 DocType 的业务语义偏“申诉/投诉”，报告必须标注与“员工奖惩”中文菜单语义的差异。
- 离职管理：至少 1 条草稿 Employee Separation。
- 离职面谈：至少 1 条 `status=Pending` 的 Exit Interview，员工必须已设置虚拟 relieving_date。

任何一项因必填模板、工作流或 DocType 语义不匹配而不能安全创建时，阶段结果写入 `blocked`，菜单验收不得标为通过。

### 3. 招聘链

招聘数据由权威入口 `hrms.api.recruitment_demo_seed.seed_recruitment_demo(company='TEST-HRMS')` 独占维护。全模块种子先探测 `TEST-REC` Staffing Plan、2 个 Job Opening、3 个 Applicant、3 个已提交 Interview/Feedback 和 2 个 Offer；完整时只报告 `existing`，不重建或覆盖。缺失时才调用该入口。入职管理链接其中 Accepted Offer 与对应员工 `TEST-MOV-007`。若 Appointment Letter 必须依赖未准备的模板/条款，则保留 Offer + Onboarding 作为“待入职/已入职”演示，Appointment Letter 标记能力阻塞。

### 4. 培训、资格、证书

- `TEST-入职安全培训` Training Program。
- 一个 Scheduled 和一个 Completed Training Event。
- Training Result、Skill、Employee Skill Map 在字段能力允许时创建。
- 证书/资格若无独立 Company 作用域 DocType，仅创建 TEST 命名的 Skill/培训结果，不向真实证书表写入。

### 5. 考勤、审批、苹果树

仅在公司隔离与月锁能力完整时创建 `2099-01` TEST 批次、正常日、有效加班、缺卡、有效/撤销审批、绿/红苹果及异常队列。任何门禁字段或官方 API 缺失时整个阶段返回 `blocked`，不手写月度终稿。

### 6. 薪资

仅消费 `TEST-HRMS/2099-01` 已锁定考勤版本；创建 TEST 员工薪资异动、福利/变量来源、薪资输入和试算。不得全月删除重建，不得读取其他公司员工。

### 7. 绩效

创建 `TEST-2099年度绩效模板`、`TEST-2099-Q1` 周期、员工 Appraisal 及一条 Employee Performance Feedback。所有记录显式链接 TEST 员工和 `TEST-HRMS`。

## 演示入口与角色

| 模块 | 演示角色 | 菜单入口 | 预期观察 |
|---|---|---|---|
| 组织/花名册 | HR Manager | 员工花名册、组织架构 | 8 名 TEST 员工及业务部门/岗位 |
| 生命周期 | HR Manager | 员工档案、任职历史、员工调动/离职 | 实习、试用、正式、外包、返聘、异动、离职 |
| 人事列表 | HR Manager | 入职管理、转正管理、人事异动、任职记录、培训经历、奖惩记录、离职管理、离职面谈 | 每个列表至少 1 条 TEST 数据；异动含生效和撤销 |
| 招聘 | HR Manager / Interviewer | 招聘需求、职位、候选人、面试、Offer、入职 | 同一候选人的两轮反馈和已入职员工 |
| 培训 | HR Manager | 培训计划、培训事件、培训结果、技能图谱 | Scheduled/Completed、资格/技能 |
| 考勤 | HR Manager | 考勤导入中心、异常、月度锁定 | 仅模块就绪时出现 TEST-HRMS/2099-01 |
| 薪资 | Payroll Manager | 薪资资料、变量、薪资试算 | 仅消费 TEST 锁定版 |
| 绩效 | HR Manager / Employee | 绩效周期、模板、考评、反馈 | Q1 周期、目标、结果与反馈 |

## 测试策略

1. 源码契约测试先失败：入口、常量、阶段、保护函数和运行命令不存在。
2. 最小实现后契约测试通过。
3. `dry_run=1` 只返回计划，不写库。
4. 首次真实运行记录各阶段创建数。
5. 第二次真实运行必须 `created=0`，既有记录数不变。
6. 每次运行前后验证 `永新`、`1` Employee 数量和最大 `modified` 不变。
7. 输出 TEST 数据清单与阻塞阶段，不把 skipped/blocked 声称为通过。
