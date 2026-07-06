# Hybrid Organization Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dynamic, editable hybrid organization tree generated from imported employee roster fields and current Employee/Department attributes.

**Architecture:** Add backend APIs to `organizational_chart.py` that aggregate Company, Department, Employee, Designation, reports-to, and staffing data into a hybrid tree. Replace the page UI with a custom organization management view that renders the tree, detail panel, and Department create/edit/delete actions through native Frappe dialogs and routes. Extend employee roster header aliases so the provided workbook fields map into the attributes that drive the tree.

**Tech Stack:** Frappe Page JavaScript, Frappe Python whitelisted APIs, existing Employee/Department/Designation/Staffing Plan DocTypes, Node contract tests.

---

### Task 1: Contract Tests For Dynamic Organization Tree

**Files:**
- Create: `tests/verify_hybrid_organization_tree.js`
- Modify: `tests/verify_employee_roster_import_export.js`

- [ ] **Step 1: Write failing contract test**

Create `tests/verify_hybrid_organization_tree.js` with checks for backend API names, frontend layout markers, editable Department actions, and CSS classes. Add roster alias markers to `tests/verify_employee_roster_import_export.js` for `现职务`, `职位`, `上级主管`, `直接上级`, `职级`, `员工等级`, `分支机构`.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node tests/verify_hybrid_organization_tree.js
node tests/verify_employee_roster_import_export.js
```

Expected: first command fails because hybrid API/UI markers do not exist yet; second command fails until roster aliases are added.

### Task 2: Backend Hybrid Tree APIs

**Files:**
- Modify: `hrms/hr/page/organizational_chart/organizational_chart.py`

- [ ] **Step 1: Implement tree aggregation**

Add whitelisted APIs:

- `get_hybrid_tree(company=None)`
- `get_hybrid_node_detail(node_id, node_type, company=None, search="")`
- `get_employee_roster_field_map()`

Keep existing `get_children()` unchanged for backward compatibility.

- [ ] **Step 2: Add helpers**

Add helpers to classify management designations, count current employees, compute staffing gaps, build department/person/group nodes, and return incomplete-data counters.

- [ ] **Step 3: Run backend contract test**

Run:

```bash
node tests/verify_hybrid_organization_tree.js
```

Expected: backend markers pass; frontend markers may still fail until Task 3.

### Task 3: Frontend Organization Management Page

**Files:**
- Replace: `hrms/hr/page/organizational_chart/organizational_chart.js`
- Create: `hrms/hr/page/organizational_chart/organizational_chart.css`

- [ ] **Step 1: Render custom page shell**

Implement a page class that renders left navigation, summary cards, toolbar, tree canvas, and right detail panel.

- [ ] **Step 2: Load and render hybrid tree**

Call `hrms.hr.page.organizational_chart.organizational_chart.get_hybrid_tree`, render node cards by node type, and support expand/collapse, search, zoom, refresh, and export.

- [ ] **Step 3: Render interactive detail panel**

Call `get_hybrid_node_detail` when a node is clicked. Show headcount, manager, employee list, position, department, contact fields, missing fields, and profile links.

- [ ] **Step 4: Add edit actions**

Add buttons for `新增部门`, `编辑部门`, and `删除部门`. Use native Frappe `frappe.new_doc`, `frappe.set_route("Form", "Department", name)`, and guarded `frappe.confirm` plus `frappe.client.delete` for delete. Refresh the tree after changes.

- [ ] **Step 5: Run frontend contract test**

Run:

```bash
node tests/verify_hybrid_organization_tree.js
```

Expected: pass.

### Task 4: Roster Field Matching

**Files:**
- Modify: `hrms/api/employee_field_template.py`

- [ ] **Step 1: Add source workbook aliases**

Extend `HEADER_FIELD_ALIASES` so the provided organization workbook maps:

- `现职务`, `职位`, `职务` -> `designation`
- `上级主管`, `直接上级`, `汇报对象` -> `reports_to`
- `职级`, `员工等级` -> `grade`
- `分支机构`, `分公司` -> `branch`
- `在职状态`, `员工状态` -> `status`
- `员工编号` -> `custom_employee_code`

- [ ] **Step 2: Ensure quick edit supports tree-driving fields**

Ensure `EMPLOYEE_ROSTER_QUICK_EDIT_FIELDS` includes `reports_to`, `grade`, `branch`, and `company` so edited employee attributes can update the generated tree.

- [ ] **Step 3: Run roster contract test**

Run:

```bash
node tests/verify_employee_roster_import_export.js
```

Expected: pass.

### Task 5: Navigation And Verification

**Files:**
- Modify only if needed: `hrms/public/js/hrms_home_redirect_v6.js`, `hrms/public/js/hrms_top_nav.js`

- [ ] **Step 1: Confirm organization sidebar remains complete**

Run:

```bash
node tests/verify_hrms_workbench_nav.js
```

Expected: pass with organization keys including `organizational-chart`.

- [ ] **Step 2: Run syntax checks**

Run:

```bash
python -m py_compile hrms/hr/page/organizational_chart/organizational_chart.py hrms/api/employee_field_template.py
node --check hrms/hr/page/organizational_chart/organizational_chart.js
```

Expected: no syntax errors.

- [ ] **Step 3: Run focused contract suite**

Run:

```bash
node tests/verify_hybrid_organization_tree.js
node tests/verify_employee_roster_import_export.js
node tests/verify_hrms_workbench_nav.js
```

Expected: all pass.
