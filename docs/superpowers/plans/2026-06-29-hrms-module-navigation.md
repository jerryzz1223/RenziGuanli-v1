# HRMS Module Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/desk/hrms-workbench` as the unified HR system shell with a green top navbar, module-specific sidebars, and first-screen module pages matching the user screenshots.

**Architecture:** Keep one Frappe Page (`hrms-workbench`) and switch modules inside the page with configuration-driven rendering. The top navbar controls the active module, the left sidebar comes from the active module config, and the main section renders a first-screen page for each module.

**Tech Stack:** Frappe Page JavaScript, jQuery, Frappe route/history APIs, CSS.

---

### Task 1: Verification Script

**Files:**
- Create: `tests/verify_hrms_workbench_nav.js`

- [x] Add a Node script that reads `hrms/hr/page/hrms_workbench/hrms_workbench.js` and checks the required top nav labels, module keys, and shell render functions.
- [ ] Run `node tests/verify_hrms_workbench_nav.js` before implementation and confirm it fails because the new shell does not exist yet.

### Task 2: Page Shell

**Files:**
- Modify: `hrms/hr/page/hrms_workbench/hrms_workbench.js`

- [ ] Replace the old workbench-only renderer with a shell renderer.
- [ ] Add module config for `workbench`, `people`, `organization`, `recruitment`, `attendance`, `payroll`, `approval`, `training`, and `performance`.
- [ ] Render the top navbar in the exact order shown by the screenshots.
- [ ] Make top nav clicks switch active module and update the URL query without leaving `/desk/hrms-workbench`.
- [ ] Keep “更多” as a dropdown placeholder.

### Task 3: Module Sidebars

**Files:**
- Modify: `hrms/hr/page/hrms_workbench/hrms_workbench.js`

- [ ] Add screenshot-based sidebar groups for each module.
- [ ] Make every titled sidebar group collapsible with `data-sidebar-toggle`.
- [ ] Preserve active menu highlighting inside each module.

### Task 4: First-Screen Module Content

**Files:**
- Modify: `hrms/hr/page/hrms_workbench/hrms_workbench.js`

- [ ] Keep the existing workbench dashboard as the `工作台` view.
- [ ] Add first-screen layouts for 人事, 组织, 招聘, 考勤假期, 薪酬, 审批, 培训学习, and 绩效 based on the screenshots.
- [ ] Use static sample rows/counts where the real business logic has not been connected yet.

### Task 5: Styling

**Files:**
- Modify: `hrms/hr/page/hrms_workbench/hrms_workbench.css`

- [ ] Add the green top navbar style.
- [ ] Add compact SaaS-style left sidebar, tables, filters, status cards, and module panels.
- [ ] Keep the layout usable at common desktop widths.

### Task 6: Verification

**Files:**
- Test: `tests/verify_hrms_workbench_nav.js`

- [ ] Run `node --check hrms/hr/page/hrms_workbench/hrms_workbench.js`.
- [ ] Run `node tests/verify_hrms_workbench_nav.js`.
- [ ] Restart or reload the Frappe service if assets do not refresh.
- [ ] In the browser, verify the top nav order, module switching, sidebar group collapsing, and `/desk/hrms-workbench` entry behavior.
