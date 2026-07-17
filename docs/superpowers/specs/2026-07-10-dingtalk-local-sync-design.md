# 钉钉本地数据同步设计

## 目标

在 Mac 本地以 Docker 启动 HRMS；由 HRMS 服务端主动读取钉钉企业内部应用的部门、员工和考勤原始数据。第一阶段不启用连接流、不暴露公网接口、不让员工访问 HRMS 管理后台。

## 范围与边界

- 钉钉是员工日常触点和数据源，HRMS 是管理、清洗、薪资和分析系统。
- 新增一个本地操作脚本，统一执行启动、停止、状态、日志、数据库迁移和容器 Shell。
- 钉钉数据先进入原始记录、用户映射和同步日志；不在首轮测试时直接改写 Employee、Attendance 或 Salary Slip。
- 首次验证仅同步部门、员工和指定日期的少量员工考勤。
- 不创建或启用钉钉连接流。连接流仅保留给后续事件自动化，例如审批通过后通知。
- 不配置公网小网关、免登网页入口或员工自助查询；这些在服务器部署和安全网关准备完成后再实施。

## 启动架构

```text
scripts/hrms-local.sh start
        |
        v
docker compose -f docker/docker-compose.yml up -d
        |
        v
Frappe/ERPNext/HRMS 容器 + MariaDB + Redis
        |
        v
http://localhost:8000
```

脚本在项目根目录运行，使用现有 `docker/docker-compose.yml`。`start` 不删除卷；`stop` 只停止容器；只有用户明确执行 Docker 卷删除命令时才会删除本地数据。首次启动由既有 `docker/init.sh` 创建站点 `hrms.localhost` 并安装当前本地挂载的 HRMS 应用。

## 钉钉数据路径

```text
HRMS 服务端
  -> Client ID / Client Secret 换 access_token
  -> 通讯录 API：部门、部门成员
  -> 考勤 API：指定用户 + 指定工作日
  -> HRMS DingTalk Raw Record / User Map / Sync Log
  -> 后续：考勤清洗、异常、月度汇总、薪资输入
```

HRMS 服务端可从内网主动访问 `https://api.dingtalk.com` 和 `https://oapi.dingtalk.com`，因此第一阶段不需要公网 IP、域名或钉钉回调地址。

## 安全规则

- 完整 Client Secret 只能保存在 `HRMS DingTalk Settings.client_secret` 密码字段或部署服务器的环境变量；不写入 Git、Shell 脚本、浏览器或聊天记录。
- `access_token` 由后端缓存并在临近过期时刷新；不得传给前端。
- 应用权限遵循最小化原则：保留通讯录和考勤读取；移除考勤组管理、考勤写入、教育通讯录写入等非本阶段权限。
- 后续员工端仅能通过钉钉免登获得“本人”数据；不能传 employee_id 查询任意员工，不能访问 Desk、工资规则或批量数据。

## 钉钉管理员手工操作

1. 在企业内部应用“人资管理”的权限管理中保留：部门读取、成员读取、部门成员读取、考勤数据读取、基础 API。
2. 移除非必要写权限：考勤组管理、考勤组写入、教育通讯录写入。
3. 新增 OA 审批读取权限：审批实例 ID 列表、审批实例详情；暂时不需要发起或撤销审批权限。
4. 发布新版本，并把应用可见范围保持为管理员本人，直至首轮读取验证完成。
5. 在 HRMS 本地站点的“HRMS DingTalk Settings”中填入完整 Client Secret 后保存。Secret 不通过聊天提供。

## 验收顺序

1. `hrms-local.sh start` 后，浏览器可以访问 `http://localhost:8000`。
2. 数据库迁移完成，钉钉设置及原始数据相关 DocType 可打开。
3. 后端成功获取 access_token。
4. 部门同步结果写入 `HRMS DingTalk Raw Record`。
5. 员工同步结果写入 `HRMS DingTalk User Map`，并保留钉钉 userid 到 HRMS Employee 的映射状态。
6. 指定一天、指定少量用户的考勤原始响应写入 `HRMS DingTalk Raw Record`。
7. 同步日志记录执行时间、成功数和失败原因；首轮不直接影响工资。

## 不在本轮实现

- 钉钉连接流、Stream 事件订阅、回调公网地址。
- 钉钉工作台员工端网页、免登、公开网关。
- 自动定时任务、全员历史考勤回补、审批业务字段映射。
- 考勤原始数据自动覆盖 HRMS 正式出勤、薪资或财务数据。
