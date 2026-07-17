# Local Launcher and DingTalk Read Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a safe, repeatable Docker launcher for the local HRMS site and validate the first read-only DingTalk synchronization path.

**Architecture:** `scripts/hrms-local.sh` is a thin, non-destructive wrapper around the repository's `docker/docker-compose.yml`. Existing Frappe APIs keep DingTalk credentials server-side and save first-pass data only to raw-record, user-map, and sync-log DocTypes. The operator enters Client Secret directly into the password field after the site is reachable.

**Tech Stack:** Bash, Docker Compose v2, Frappe/ERPNext/HRMS, Node.js contract tests, DingTalk Server API.

## Global Constraints

- Operate from the repository root `/Users/lrj/Documents/SAD/YOngxin/人资/人资二/人资管理系统`.
- Use `docker compose -f docker/docker-compose.yml`; do not use destructive volume removal.
- Do not write Client Secret or access tokens to source files, shell scripts, command history, test output, or Git.
- First DingTalk pass is read-only: department, member, and a bounded attendance sample only.
- Do not enable public employee gateway or connection flows in this implementation.

---

### Task 1: Add a non-destructive local Docker launcher

**Files:**
- Create: `scripts/hrms-local.sh`
- Test: `tests/verify_hrms_local_launcher.js`

**Interfaces:**
- Consumes: Docker Compose file `docker/docker-compose.yml`.
- Produces: `scripts/hrms-local.sh {start|stop|status|logs|migrate|shell}`.

- [ ] **Step 1: Write the failing test**

```javascript
const script = read("scripts/hrms-local.sh");
for (const marker of [
  "start)",
  "stop)",
  "status)",
  "logs)",
  "migrate)",
  "shell)",
  "docker compose -f \"${COMPOSE_FILE}\" up -d",
  "docker compose -f \"${COMPOSE_FILE}\" down",
  "bench --site hrms.localhost migrate",
]) mustInclude(script, marker);
if (script.includes("down -v") || script.includes("docker volume rm")) throw new Error("Launcher must not delete local data");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/verify_hrms_local_launcher.js`

Expected: FAIL with `Missing file: scripts/hrms-local.sh`.

- [ ] **Step 3: Write minimal implementation**

```bash
case "${1:-help}" in
  start) compose up -d ;;
  stop) compose down ;;
  status) compose ps ;;
  logs) compose logs --tail=200 -f ;;
  migrate) compose exec frappe bench --site hrms.localhost migrate ;;
  shell) compose exec frappe bash ;;
esac
```

The implementation must check the Docker daemon, verify the compose file, print `http://localhost:8000` after start, and accept `logs` without forcing a follow mode when an optional second argument is provided.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/verify_hrms_local_launcher.js`

Expected: `HRMS local launcher contract passed.`

- [ ] **Step 5: Verify shell syntax and executable bit**

Run: `bash -n scripts/hrms-local.sh && test -x scripts/hrms-local.sh`

Expected: exit code 0.

### Task 2: Set safe DingTalk defaults for the local read-only phase

**Files:**
- Modify: `hrms/api/dingtalk_integration.py`
- Modify: `hrms/hr/doctype/hrms_dingtalk_settings/hrms_dingtalk_settings.json`
- Modify: `tests/verify_dingtalk_integration.js`

**Interfaces:**
- Consumes: `HRMS DingTalk Settings` single DocType.
- Produces: `get_dingtalk_default_settings()` whose first-phase mode is `内网服务器主动拉取API` and whose public gateway default is disabled.

- [ ] **Step 1: Write the failing test**

```javascript
mustInclude(api, '"sync_mode": "内网服务器主动拉取API"');
mustInclude(api, '"public_gateway_enabled": 0');
if (settings.fields.find((field) => field.fieldname === "local_gateway_enabled").default !== "0") {
  throw new Error("Local gateway must not be enabled by default");
}
if (settings.fields.find((field) => field.fieldname === "public_gateway_enabled").default !== "0") {
  throw new Error("Public gateway must not be enabled by default");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/verify_dingtalk_integration.js`

Expected: FAIL because the current defaults select `公网小网关` and enable gateway flags.

- [ ] **Step 3: Write minimal implementation**

```python
"sync_mode": "内网服务器主动拉取API",
"public_gateway_enabled": 0,
```

Set the two DocType Check field defaults to `0`. Preserve the existing public gateway endpoints for later deployment but do not enable them automatically.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/verify_dingtalk_integration.js`

Expected: `DingTalk integration contract passed.`

### Task 3: Start and migrate the local site

**Files:**
- Modify: none unless Docker runtime reports an actionable startup defect.

**Interfaces:**
- Consumes: `scripts/hrms-local.sh start`.
- Produces: running HRMS at `http://localhost:8000` and migrated DingTalk DocTypes.

- [ ] **Step 1: Start Docker services**

Run: `./scripts/hrms-local.sh start`

Expected: Docker services enter running state; first initialization can take several minutes.

- [ ] **Step 2: Inspect startup status**

Run: `./scripts/hrms-local.sh status`

Expected: `mariadb`, `redis`, and `frappe` containers are listed.

- [ ] **Step 3: Wait for site initialization and inspect recent logs**

Run: `./scripts/hrms-local.sh logs 200`

Expected: logs show site creation or `Bench already exists`, then `bench start`.

- [ ] **Step 4: Run database migration after the site is ready**

Run: `./scripts/hrms-local.sh migrate`

Expected: migration exits successfully and makes the new DingTalk DocTypes available.

### Task 4: Operator-only DingTalk credential entry and bounded API validation

**Files:**
- Modify: none.

**Interfaces:**
- Consumes: operator-entered Client Secret in `HRMS DingTalk Settings.client_secret`.
- Produces: cached `access_token`; raw department, user, and attendance records; sync log entries.

- [ ] **Step 1: In the local HRMS browser, open the settings record**

Open: `http://localhost:8000/app/hrms-dingtalk-settings`

Set: `启用钉钉集成=1`, `同步模式=内网服务器主动拉取API`, and confirm existing App ID, CorpId, AgentId, Client ID.

- [ ] **Step 2: Enter Client Secret directly in the Password field and save**

Do not send the value to chat, paste it into the terminal, or commit it. The field is `Client Secret / AppSecret` in `HRMS DingTalk Settings`.

- [ ] **Step 3: Test token retrieval**

Run from a container shell:

```bash
bench --site hrms.localhost execute hrms.api.dingtalk_integration.fetch_access_token
```

Expected: response contains `access_token: 已刷新` and a future `token_expires_at`, never the token itself.

- [ ] **Step 4: Sync department and employee source records**

```bash
bench --site hrms.localhost execute hrms.api.dingtalk_integration.sync_departments_from_dingtalk
bench --site hrms.localhost execute hrms.api.dingtalk_integration.sync_users_from_dingtalk
```

Expected: data appears in `HRMS DingTalk Raw Record`, `HRMS DingTalk User Map`, and `HRMS DingTalk Sync Log`.

- [ ] **Step 5: Sync a bounded attendance sample**

```bash
bench --site hrms.localhost execute hrms.api.dingtalk_integration.sync_attendance_from_dingtalk --kwargs "{'work_date':'2026-07-09','limit':3}"
```

Expected: no more than three raw attendance records are requested; no Employee, Attendance, Salary Slip, or payroll data is changed.

### Task 5: Verify the implementation and document handoff

**Files:**
- Modify: `README.md` only if a project-local launcher section is absent and the script is successfully validated.

**Interfaces:**
- Consumes: launcher contract test, DingTalk integration contract test, runtime status.
- Produces: an operator command list and an evidence-based status report.

- [ ] **Step 1: Run static checks**

```bash
bash -n scripts/hrms-local.sh
node tests/verify_hrms_local_launcher.js
node tests/verify_dingtalk_integration.js
python3 -m py_compile hrms/api/dingtalk_integration.py hrms/api/dingtalk_employee_gateway.py
```

Expected: all commands exit 0.

- [ ] **Step 2: Report the exact operator command sequence**

```bash
cd '/Users/lrj/Documents/SAD/YOngxin/人资/人资二/人资管理系统'
./scripts/hrms-local.sh start
./scripts/hrms-local.sh status
./scripts/hrms-local.sh logs 200
```

Include the exact in-product Secret location and the sequence: token → departments → users → attendance sample.
