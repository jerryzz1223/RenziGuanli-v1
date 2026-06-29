# HRMS Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the HRMS main workbench as a native Frappe Page.

**Architecture:** Add a standard Frappe Page under the HR module, a whitelisted Python data endpoint, page-scoped JavaScript rendering, and page-scoped CSS. Route the HRMS app home and desk redirect to the new page.

**Tech Stack:** Frappe Desk Page, Python whitelisted method, jQuery/Frappe client APIs, CSS.

---

### Task 1: Add Frappe Page Shell

**Files:**
- Create: `hrms/hr/page/hrms_workbench/hrms_workbench.json`
- Create: `hrms/hr/page/hrms_workbench/__init__.py`

- [ ] Add a standard Page record named `hrms-workbench` with HR roles.
- [ ] Add the package initializer so Frappe can import the page module.

### Task 2: Add Data Endpoint

**Files:**
- Create: `hrms/hr/page/hrms_workbench/hrms_workbench.py`

- [ ] Add robust helper functions for counting records only when a DocType exists.
- [ ] Add `get_data()` as a whitelisted method returning calendar, quick entries, workbench cards, and right-rail values.
- [ ] Return zeros and empty lists when optional doctypes are missing.

### Task 3: Add Page UI

**Files:**
- Create: `hrms/hr/page/hrms_workbench/hrms_workbench.js`
- Create: `hrms/hr/page/hrms_workbench/hrms_workbench.css`

- [ ] Use `frappe.ui.make_app_page` to create the page.
- [ ] Call `hrms.hr.page.hrms_workbench.hrms_workbench.get_data`.
- [ ] Render the reference-style workbench in the page body.
- [ ] Add click handlers for quick entries and card links.
- [ ] Scope all styles under `.hrms-workbench`.

### Task 4: Point HRMS Home to Workbench

**Files:**
- Modify: `hrms/hooks.py`
- Modify: `hrms/public/js/hrms_home_redirect_v3.js`

- [ ] Change HRMS `app_home` and launcher route to `/desk/hrms-workbench`.
- [ ] Change redirect logic from `/desk/expenses` to `/desk/hrms-workbench`.

### Task 5: Sync and Verify

**Commands:**
- Run: `docker compose -f docker/docker-compose.yml exec frappe bench --site hrms.localhost migrate`
- Run: `docker compose -f docker/docker-compose.yml exec frappe bench --site hrms.localhost clear-cache`
- Open: `http://127.0.0.1:8000/desk/hrms-workbench`

- [ ] Confirm the page loads without console errors.
- [ ] Confirm `/desk` and the HRMS app entry route to the new page.
- [ ] Confirm zero-data states render without crashes.
