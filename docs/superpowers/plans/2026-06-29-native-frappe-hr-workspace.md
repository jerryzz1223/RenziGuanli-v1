# Native Frappe HR Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the HR entry screen using native Frappe Workspace and Workspace Sidebar configuration, with business structure informed by the inspected 2haohr pages.

**Architecture:** Keep `/desk/hr-setup` as the app home and route. Replace the HR Setup workspace card/link layout and sidebar entries with Chinese HR business groups that link to real HRMS/ERPNext DocTypes, Reports, and Pages. Do not add fake HTML, fake tables, or hardcoded employee data.

**Tech Stack:** Frappe Workspace JSON, Workspace Sidebar JSON, existing HRMS/ERPNext DocTypes, Node-based verification script.

---

### Task 1: Add Verification for Workspace Structure

**Files:**
- Modify: `tests/verify_hrms_workbench_nav.js`

- [ ] Add assertions that `/desk/hr-setup` remains the home route and that key 2haohr-inspired labels map to real routes.
- [ ] Run `node tests/verify_hrms_workbench_nav.js` and expect PASS.

### Task 2: Rewrite HR Setup Workspace Cards

**Files:**
- Modify: `hrms/hr/workspace/hr_setup/hr_setup.json`

- [ ] Keep `name` as `HR Setup` and `app_home` as `/desk/hr-setup` so the current route remains stable.
- [ ] Replace card groups with Chinese labels: 员工管理、员工关系、组织管理、招聘、考勤假期、薪酬、审批、培训学习、绩效、报表。
- [ ] Each link points to an existing DocType, Report, Dashboard, or Page.

### Task 3: Rewrite HR Setup Sidebar

**Files:**
- Modify: `hrms/workspace_sidebar/hr_setup.json`

- [ ] Use collapsible Section Break groups mirroring 2haohr: 员工管理、员工关系、组织管理、招聘、考勤假期、薪酬、审批、培训学习、绩效、报表。
- [ ] Each child item links to real Frappe resources.
- [ ] Preserve native sidebar behavior and no custom JavaScript.

### Task 4: Sync and Verify in Running Site

**Files:**
- No source changes.

- [ ] Run JSON validation and Node verification.
- [ ] Run Frappe import/migrate or restart if needed.
- [ ] Open `/desk/hr-setup` and verify it uses native Frappe styling with the new business menu structure.
