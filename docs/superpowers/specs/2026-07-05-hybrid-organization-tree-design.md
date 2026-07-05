# Hybrid Organization Tree Design

## Goal

Build a company-specific organization management view for Yongxin HR that makes the organization structure clear, visual, and manageable. The view combines an organization tree with interactive department and employee cards.

The tree is not a static drawing. It is generated from imported employee roster fields and editable employee/organization attributes in the HR system.

## Confirmed Direction

Use a hybrid of the existing employee hierarchy chart and a department hierarchy chart:

- Management levels show the person name and position, such as 课长、组长、主管、代理人.
- Employee-heavy levels show the department or group name instead of rendering every employee as a node.
- Clicking a department/group card opens an interactive detail panel with employee list, profile fields, headcount, staffing gap, responsibilities, and related support capability.

This keeps the tree readable while still allowing HR users to drill into all employee records.

## Source Material

The design follows the provided source files:

- `1.2组织架构.xlsx`
  - `组织架构图`: current department/group structure, management names, staffing plan, current headcount, and gaps.
  - `年度岗位职责组织架构图`: department-to-position responsibility structure.
  - `员工花名册`: import template for employee fields.
  - `组织架构变更履历表`: audit trail for structure changes.
- `1.3跨部门支援.xlsx`
  - `合格支援人员名单`: support capability by employee, department, and position.
  - `跨部门支援申请表`: support request evidence.

## Data Model

The implementation should rely on existing Frappe/HRMS master data first:

- `Employee`
- `Company`
- `Branch`
- `Department`
- `Designation`
- `Employee Grade`
- `Staffing Plan`

Employee roster import maps workbook columns into employee fields. At minimum the organization tree depends on:

- 工号 / employee id
- 姓名 / employee name
- 公司
- 分支机构
- 部门
- 现职务 / 职位 / 岗位
- 职级
- 直接上级 or reports_to
- 部门负责人 / 课长 / 组长 / 主管 when available
- 在职状态

If a value is corrected after import through employee profile editing or organization master editing, the tree uses the latest saved system value.

## Derived Tree Rules

The system derives tree nodes in this order:

1. Company/root node.
2. Department and sub-department/group nodes from `Department.parent_department` where available.
3. Management person nodes from employees whose designation or role marks them as 课长、组长、主管、总监、副总, or whose employee is referenced as department manager.
4. Employee group nodes for large employee populations, grouped by department, group, or designation.
5. Employee detail list inside the selected group card.

If explicit manager relationships exist through `Employee.reports_to`, they take priority for management-person paths. If a department hierarchy exists but reports-to data is missing, the department structure still renders and highlights missing manager fields.

## UI

Add or enhance the organization page so the `组织` module exposes:

- 主页
- 公司
- 分支机构
- 部门
- 岗位
- 职级
- 组织架构图
- 人员编制
- 跨部门支援

The organization chart page has three zones:

- Left navigation: organization management sections.
- Main canvas: horizontal/scrollable tree with zoom, expand/collapse, search, and export.
- Right detail panel: selected node details.

Node card behavior:

- Company node: shows total departments, plan headcount, current headcount, and gap.
- Department node: shows department name, manager, planned/current/gap headcount.
- Management node: shows employee name, position, department, and direct subordinate count.
- Employee group node: shows department/group name and employee count.

Clicking a node updates the right panel. For employee group nodes, the panel shows a searchable employee list and links to employee profiles.

## Import And Editing Flow

The employee roster import should map fields into the system and report unmatched rows or missing key fields. After import:

- HR can edit employee department, position, grade, and reports-to fields.
- HR can edit Department hierarchy and manager-like fields.
- The tree refreshes from current system records rather than from the original Excel file.

This makes the workbook a setup/import source, not the permanent source of truth.

## Staffing And Alerts

For each department or group, show:

- 编制人数
- 现有人数
- 空缺人数
- 超编/缺编 state

When `Staffing Plan` has usable records, use it as the staffing baseline. If it is not available yet, support importing or storing the baseline values from `组织架构图` as department staffing metadata.

## Cross-Department Support

Cross-department support appears as contextual data, not as tree structure. A selected employee or department can show:

- qualified support employees
- supported department/position
- approval date or valid period
- support request records

This keeps the core organization tree focused on formal reporting and department hierarchy.

## Empty And Incomplete Data States

The page must handle partial rollout:

- No employees: show an import/setup prompt.
- Employees without department: show an unmapped employee count.
- Departments without manager: render the department node and mark manager as missing.
- Employees without reports-to: keep them visible in the department employee group.
- Staffing plan missing: show current headcount and mark planned headcount as not set.

## Testing

Add file-level and API contract coverage for:

- organization page route and module navigation labels
- backend API that returns the hybrid tree
- backend API that returns selected node detail
- expected employee roster mapping keys
- department tree fallback when reports-to data is incomplete
- staffing gap calculation

Where possible, extend existing `organizational_chart` tests to cover department-derived nodes and management/person nodes.
