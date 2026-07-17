# Organization Company Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the organization chart default to `永新`, allow an authorized user to select an existing Company, and keep all tree, detail, import, and department-create actions scoped to that selected company.

**Architecture:** Keep `Company` as the ERPNext/HRMS data boundary. The browser owns only the selected company value; the existing server-side `_normalize_yongxin_company()` remains the safety boundary that falls back to `永新` (then the user default) when the requested value is missing. No Company, Department, or Employee records are created or migrated by this change.

**Tech Stack:** Frappe Desk page JavaScript, Frappe Python whitelisted methods, Node.js static contract verification.

## Global Constraints

- The current repository worktree contains user changes; do not reset, reformat unrelated files, migrate, seed data, or commit from this plan.
- `永新` is the default company for this trial; selecting another existing Company is a view context, not multi-company administration.
- A missing Company name must never create a Company or silently write Department/Employee records.
- Follow TDD: the contract test must fail before the production change and pass after it.

---

### Task 1: Capture the missing selector behavior in the organization-page contract

**Files:**

- Modify: `tests/verify_hybrid_organization_tree.js:141-178`
- Test: `tests/verify_hybrid_organization_tree.js`

**Interfaces:**

- Consumes: the organization chart page source at `hrms/hr/page/organizational_chart/organizational_chart.js`.
- Produces: a static contract that requires a selector mount point, the Chinese label `选择公司`, a `change-company` action, and the `set_company` method.

- [ ] **Step 1: Add the missing selector-action and method markers to the existing marker list**

```js
"data-company-field",
"选择公司",
"data-action=\"change-company\"",
"setup_company_field",
"set_company",
```

- [ ] **Step 2: Run the contract test and verify the expected red failure**

Run: `node tests/verify_hybrid_organization_tree.js`

Expected: `FAIL` because the current page has no `data-company-field` selector mount point; after the two extra markers are added it will also report the missing selector action/method.

### Task 2: Add a Company link control and reload the chart only after a real context change

**Files:**

- Modify: `hrms/hr/page/organizational_chart/organizational_chart.js:24-116`
- Test: `tests/verify_hybrid_organization_tree.js`

**Interfaces:**

- Consumes: `this.company`, initially `YONGXIN_COMPANY`, and the existing `load_tree()` RPC which receives `{ company: this.company }`.
- Produces: `setup_company_field()` and `set_company(company)` methods. All existing calls to `get_hybrid_tree`, `get_hybrid_node_detail`, `import_yongxin_q2_org_structure`, and department actions continue to use `this.company`.

- [ ] **Step 1: Preserve the failing test from Task 1 as the red test**

Run: `node tests/verify_hybrid_organization_tree.js`

Expected: `FAIL` with a missing company-selector marker before editing production JavaScript.

- [ ] **Step 2: Add a selector mount point to the toolbar and initialize it after `render_shell()` builds the DOM**

```js
<div class="hrms-org-company-selector">
  <label>${__("选择公司")}</label>
  <div data-company-field></div>
</div>
```

```js
render_shell() {
  // existing template assignment
  this.setup_company_field();
  this.bind_events();
}
```

- [ ] **Step 3: Add the smallest Company Link control and change handler**

```js
setup_company_field() {
  const control = frappe.ui.form.make_control({
    parent: this.wrapper.querySelector("[data-company-field]"),
    df: {
      fieldname: "company",
      fieldtype: "Link",
      label: __("选择公司"),
      options: "Company",
      default: this.company,
    },
    render_input: true,
  });
  control.set_value(this.company);
  control.$input.on("change", () => this.set_company(control.get_value()));
  this.company_field = control;
}

set_company(company) {
  const next_company = (company || "").trim();
  if (!next_company || next_company === this.company) return;
  this.company = next_company;
  this.load_tree();
}
```

The implementation may use a named `data-action="change-company"` event instead of the `control.$input` handler, but it must keep the same semantics: no reload for empty/same values; exactly one reload after a changed, nonempty value.

- [ ] **Step 4: Run the static contract and verify green**

Run: `node tests/verify_hybrid_organization_tree.js`

Expected: `PASS` with `Hybrid organization tree APIs, UI, edit actions, and navigation are wired.`

### Task 3: Verify no existing organization behavior regressed

**Files:**

- Test: `tests/verify_hybrid_organization_tree.js`
- Test: `tests/verify_employee_roster_import_export.js`

**Interfaces:**

- Consumes: the selected Company context from Task 2 and the existing employee roster import surface.
- Produces: evidence that the organization UI change did not alter the roster import contract.

- [ ] **Step 1: Run both focused contracts**

Run: `node tests/verify_hybrid_organization_tree.js && node tests/verify_employee_roster_import_export.js`

Expected: both commands exit `0`; the second command confirms the organization change did not change employee import behavior.

- [ ] **Step 2: Inspect only the intended diff before handoff**

Run: `git diff -- hrms/hr/page/organizational_chart/organizational_chart.js tests/verify_hybrid_organization_tree.js`

Expected: only the Company selector contract and implementation are present; do not stage or commit because this is a shared, dirty worktree.

## Self-review

- Scope coverage: addresses the current red organization test and the trial requirement that `永新` remains the default while another real Company can be viewed.
- Non-goals: no Company restoration, no database migration, no Department import, no change to Employee data, and no new cross-module contract.
- Type consistency: `set_company(company)` updates the existing `this.company` value consumed by all current organization RPCs.
