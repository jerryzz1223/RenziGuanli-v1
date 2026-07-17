# 人事 Excel 模板包与复核提交 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建全结构化的人事 Excel 模板包，将花名册和四类员工关系流程导入待复核记录，并在复核后生成或提交标准 HRMS 单据。

**Architecture:** 新增独立的人事导入 API 与批次、导入事项、审批明细三个 DocType。每个业务 Sheet 行对应一条导入事项，所有纸质字段使用实际字段保存；Excel 导入绝不直接提交 Employee、Employee Transfer、Employee Promotion 或 Employee Separation。复核通过后生成 Draft，标准单据提交后才改变员工主档或任职历史。

**Tech Stack:** Frappe v17 / HRMS v17、Python、openpyxl、Frappe DocType JSON、现有 Frappe Page JavaScript、Node 静态契约测试。

## Global Constraints

- `Employee` 是员工主档唯一事实源；`custom_employee_code` 是跨模块稳定业务键；`Employee.name` 不在模板和花名册显示。
- 部门显示/导入/导出使用 `Department.department_name`；内部 Link 名可保留 `- 1D` 等后缀。
- 只改人事、员工关系、花名册、合同字段和人事导入。不得修改考勤、薪资、审批、组织模块。
- 所有审批均为结构化字段：审批环节、审批人、审批日期、审批意见、审批结果。
- 所有自动化数据限定在 `Company=TEST-HRMS` 与测试工号，禁止批量写入真实永新数据。

## File Structure

- Create `hrms/hr/doctype/hrms_personnel_import_batch/`: 上传文件、批次状态、行数统计。
- Create `hrms/hr/doctype/hrms_personnel_import_item/`: 一条业务数据的公共字段、全部纸质表单字段、复核状态及目标单据。
- Create `hrms/hr/doctype/hrms_personnel_import_approval/`: 多级审批子表。
- Create `hrms/hr/doctype/hrms_employee_contract_renewal/`: 合同续签正式记录，提交时同步 Employee 合同摘要。
- Create `hrms/api/personnel_excel_import.py`: 模板、解析、预览、批次、复核、草稿、提交、失败行下载 API。
- Create `hrms/hr/page/personnel_excel_import/`: 导入和复核工作台。
- Modify `hrms/api/employee_field_template.py`: 只复用字段中心和部门显示工具。
- Modify `hrms/public/js/erpnext/employee_list.js`: 花名册新增“人事业务模板包”入口。
- Modify `hrms/hr/page/employee_detail/employee_detail.js` 与 `hrms/hr/page/employee_property_history/employee_property_history.js`: 显示导入来源和目标单据回链。
- Create `tests/verify_personnel_excel_template_pack.js` 与 `tests/test_personnel_excel_import.py`。

## Interfaces

```python
PERSONNEL_SHEET_DEFINITIONS = {
    "员工花名册": {"record_type": "roster", "employee_required": False},
    "员工异动": {"record_type": "transfer", "employee_required": True},
    "转正晋降": {"record_type": "promotion", "employee_required": True},
    "合同续签": {"record_type": "contract_renewal", "employee_required": True},
    "离职申请": {"record_type": "separation", "employee_required": True},
}
IMPORT_ITEM_STATUSES = ("待校验", "校验失败", "待复核", "复核退回", "复核通过", "已生成草稿", "已提交", "提交失败")
def build_personnel_excel_template_pack() -> bytes: ...
def preview_personnel_excel_import(file_url: str) -> dict: ...
def create_personnel_import_batch(file_url: str) -> dict: ...
def review_personnel_import_item(name: str, conclusion: str, comment: str = "") -> dict: ...
def generate_personnel_import_draft(name: str) -> dict: ...
def submit_personnel_import_item(name: str) -> dict: ...
```

模板包含 `填写说明`、`员工花名册`、`员工异动`、`转正晋降`、`合同续签`、`离职申请`、`审批明细`、`导入结果` 八个 Sheet。审批明细以业务 Sheet 与 Excel 行号定位事项，列为审批环节、审批人、审批日期、审批意见、审批结果。

### Task 1: 导入审计数据模型

**Files:** Create three `hrms_personnel_import_*` DocType 目录；Create `tests/verify_personnel_excel_template_pack.js`。

- [ ] **Step 1: Write the failing model contract.**

```javascript
assertJsonField(itemJson, "employee_code", "Data");
assertJsonField(itemJson, "record_type", "Select");
assertJsonField(itemJson, "review_status", "Select");
assertJsonField(itemJson, "approval_steps", "Table");
assertJsonField(approvalJson, "approval_stage", "Data");
assertJsonField(approvalJson, "approver", "Link");
assertJsonField(approvalJson, "approval_date", "Date");
assertJsonField(approvalJson, "approval_comment", "Small Text");
assertJsonField(approvalJson, "approval_result", "Select");
```

- [ ] **Step 2: Run `node tests/verify_personnel_excel_template_pack.js`.** Expected: missing DocType JSON failure.
- [ ] **Step 3: Create the model.** Batch stores source file, status, row counts, uploader/time. Item stores batch, Sheet/row, type, Employee/code, review state/comment, target doctype/name and submit audit. Item must hold real, editable fields for the roster baseline plus transfer, promotion/qualification, contract, and separation fields; no JSON payload for business values. Approval is a child table with all five structured approval fields. HR User can create/read/write; HR Manager can review, delete and submit.
- [ ] **Step 4: Run `node tests/verify_personnel_excel_template_pack.js`.** Expected: model assertions pass; API assertions fail.
- [ ] **Step 5: Commit:** `git add hrms/hr/doctype/hrms_personnel_import_batch hrms/hr/doctype/hrms_personnel_import_item hrms/hr/doctype/hrms_personnel_import_approval tests/verify_personnel_excel_template_pack.js && git commit -m 'feat: add personnel import review records'`.

### Task 2: 合同续签正式记录

**Files:** Create `hrms/hr/doctype/hrms_employee_contract_renewal/`; Modify `tests/test_personnel_excel_import.py` and static test.

- [ ] **Step 1: Write a failing submit test.**

```python
def test_contract_renewal_submit_updates_only_test_employee(make_test_employee):
    employee = make_test_employee(employee_code="TEST-CON-001")
    renewal = frappe.get_doc({"doctype": "HRMS Employee Contract Renewal", "employee": employee.name,
        "employee_code": "TEST-CON-001", "contract_no": "TEST-CON-2026-01",
        "contract_start_date": "2026-07-01", "contract_end_date": "2027-06-30", "contract_sign_count": 2}).insert()
    renewal.submit()
    employee.reload()
    assert employee.custom_contract_no == "TEST-CON-2026-01"
    assert employee.contract_end_date.isoformat() == "2027-06-30"
```

- [ ] **Step 2: Run `bench --site test_site run-tests --module tests.test_personnel_excel_import --test test_contract_renewal_submit_updates_only_test_employee`.** Expected: missing DocType failure.
- [ ] **Step 3: Implement the DocType and its safe submit hook.**

```python
class HRMSEmployeeContractRenewal(Document):
    def validate(self):
        if self.contract_end_date < self.contract_start_date:
            frappe.throw(_("合同结束日期不能早于合同开始日期"))
    def on_submit(self):
        frappe.db.set_value("Employee", self.employee, {"custom_contract_no": self.contract_no,
            "custom_contract_sign_date": self.contract_start_date, "custom_contract_sign_count": self.contract_sign_count,
            "contract_end_date": self.contract_end_date})
```

- [ ] **Step 4: Re-run the test.** Expected: PASS.
- [ ] **Step 5: Commit:** `git add hrms/hr/doctype/hrms_employee_contract_renewal tests/test_personnel_excel_import.py tests/verify_personnel_excel_template_pack.js && git commit -m 'feat: add structured employee contract renewals'`.

### Task 3: Excel 模板包

**Files:** Create `hrms/api/personnel_excel_import.py`; Modify `hrms/api/employee_field_template.py`, `tests/test_personnel_excel_import.py`, static test.

- [ ] **Step 1: Write a failing workbook test.**

```python
def test_personnel_template_pack_has_all_structured_sheets():
    workbook = load_workbook(BytesIO(build_personnel_excel_template_pack()))
    assert workbook.sheetnames == ["填写说明", "员工花名册", "员工异动", "转正晋降", "合同续签", "离职申请", "审批明细", "导入结果"]
    headers = [cell.value for cell in workbook["员工花名册"][1]]
    assert {"工号", "姓名", "部门", "身份证号码", "合同-合同编号"} <= set(headers)
```

- [ ] **Step 2: Run `bench --site test_site run-tests --module tests.test_personnel_excel_import --test test_personnel_template_pack_has_all_structured_sheets`.** Expected: missing module failure.
- [ ] **Step 3: Implement `build_personnel_excel_template_pack()` and `download_personnel_excel_template_pack()`.** Roster columns combine field-center configuration with the agreed source-table baseline. Other Sheets expose Task 1 fields. Instructions contain mandatory rules, enums, formats, work-number and review rules. Do not replace existing roster-only `download_employee_import_template()`.
- [ ] **Step 4: Run the test and `node tests/verify_personnel_excel_template_pack.js`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git add hrms/api/personnel_excel_import.py hrms/api/employee_field_template.py tests/test_personnel_excel_import.py tests/verify_personnel_excel_template_pack.js && git commit -m 'feat: add personnel Excel template pack'`.

### Task 4: 预览校验与待复核批次

**Files:** Modify `hrms/api/personnel_excel_import.py`, `tests/test_personnel_excel_import.py`, static test.

- [ ] **Step 1: Write a failing no-write preview test.**

```python
def test_preview_flags_missing_employee_and_does_not_write(make_upload):
    file_url = make_upload({"员工异动": [["工号", "生效日期", "目标部门"], ["MISSING", "2026-07-01", "TEST-HRMS-DEPT"]]})
    preview = preview_personnel_excel_import(file_url)
    assert preview["failed"] == 1
    assert preview["errors"][0]["field_label"] == "工号"
    assert not frappe.db.exists("HRMS Personnel Import Batch", {"source_file": file_url})
```

- [ ] **Step 2: Run `bench --site test_site run-tests --module tests.test_personnel_excel_import --test test_preview_flags_missing_employee_and_does_not_write`.** Expected: missing API failure.
- [ ] **Step 3: Implement preview/create APIs.** Error output must include Sheet, row, field, raw value and message. Roster uses current minimum Employee field and duplicate rules; other Sheets require an existing Employee by work number. Reject invalid dates, Excel errors, dates before joining, invalid contract periods and duplicate work-number/type/effective-date rows. Preview writes nothing; only explicit batch creation stores Items and approval rows. Identity-card derivation suggests but never overwrites conflicting manual birth/gender/age values.
- [ ] **Step 4: Run `bench --site test_site run-tests --module tests.test_personnel_excel_import`.** Expected: preview, errors, approval steps, staging and no-write tests PASS.
- [ ] **Step 5: Commit:** `git add hrms/api/personnel_excel_import.py tests/test_personnel_excel_import.py tests/verify_personnel_excel_template_pack.js && git commit -m 'feat: stage reviewed personnel Excel imports'`.

### Task 5: 复核、草稿与提交门禁

**Files:** Modify `hrms/api/personnel_excel_import.py`, Item controller and tests.

- [ ] **Step 1: Write a failing lifecycle test.**

```python
def test_transfer_item_generates_draft_only_after_review(make_transfer_item):
    item = make_transfer_item(status="待复核")
    with pytest.raises(frappe.ValidationError): generate_personnel_import_draft(item.name)
    review_personnel_import_item(item.name, "通过", "资料完整")
    result = generate_personnel_import_draft(item.name)
    assert frappe.get_doc("Employee Transfer", result["target_name"]).docstatus == 0
```

- [ ] **Step 2: Run `bench --site test_site run-tests --module tests.test_personnel_excel_import --test test_transfer_item_generates_draft_only_after_review`.** Expected: missing API failure.
- [ ] **Step 3: Implement the gated dispatcher.**

```python
def generate_personnel_import_draft(name):
    item = frappe.get_doc("HRMS Personnel Import Item", name)
    _require_review_approved(item)
    target = {"roster": _build_employee_draft, "transfer": _build_transfer_draft,
              "promotion": _build_promotion_draft, "contract_renewal": _build_contract_renewal_draft,
              "separation": _build_separation_draft}[item.record_type](item)
    item.db_set({"target_doctype": target.doctype, "target_name": target.name, "review_status": "已生成草稿"})
    return {"target_doctype": target.doctype, "target_name": target.name}
```

- [ ] **Step 4: Map to standard documents.** Roster only creates/updates Employee after review; transfer maps changes to `transfer_details`; promotion maps to `promotion_details`; contract creates the contract-renewal record; separation creates Employee Separation. Only HR Manager/System Manager may call submit; submit standard documents without bypassing hooks and marks Item `已提交` or `提交失败`.
- [ ] **Step 5: Run `bench --site test_site run-tests --module tests.test_personnel_excel_import`.** Expected: rejection, Draft, submission, no-premature-status-change and Employee Property History tests PASS.
- [ ] **Step 6: Commit:** `git add hrms/api/personnel_excel_import.py hrms/hr/doctype/hrms_personnel_import_item/hrms_personnel_import_item.py tests/test_personnel_excel_import.py && git commit -m 'feat: generate reviewed personnel workflow drafts'`.

### Task 6: 人事业务导入与复核工作台

**Files:** Create `hrms/hr/page/personnel_excel_import/personnel_excel_import.json` and `.js`; Modify employee List JS, HR CSS, hooks and static test.

- [ ] **Step 1: Write a failing UI contract.**

```javascript
for (const marker of ["下载人事模板包", "上传 Excel", "预览校验", "审批明细", "待复核", "复核通过", "生成草稿", "提交生效", "下载失败行", "download_personnel_excel_template_pack", "preview_personnel_excel_import", "create_personnel_import_batch", "review_personnel_import_item", "generate_personnel_import_draft", "submit_personnel_import_item"]) assertIncludes(pageJs, marker);
assertIncludes(employeeListJs, 'frappe.set_route("personnel-excel-import")');
```

- [ ] **Step 2: Run `node tests/verify_personnel_excel_template_pack.js`.** Expected: missing Page failure.
- [ ] **Step 3: Implement UI.** Upload calls preview first, shows Sheet/row/field errors, and only after confirmation creates a batch. HR User may upload/view; HR Manager/System Manager may review, create drafts and submit. Use `frappe.ui.FileUploader` and real API calls. Do not render a direct “写入 Employee” action.
- [ ] **Step 4: Run `node tests/verify_personnel_excel_template_pack.js && node --check hrms/hr/page/personnel_excel_import/personnel_excel_import.js && node --check hrms/public/js/erpnext/employee_list.js`.** Expected: PASS.
- [ ] **Step 5: Commit:** `git add hrms/hr/page/personnel_excel_import hrms/public/js/erpnext/employee_list.js hrms/public/css/hrms_top_nav.css hrms/hooks.py tests/verify_personnel_excel_template_pack.js && git commit -m 'feat: add personnel Excel review workbench'`.

### Task 7: 档案和任职记录回链

**Files:** Modify API, employee detail/property history pages and their tests.

- [ ] **Step 1: Write a failing traceability contract.**

```javascript
assertIncludes(api, "get_employee_personnel_import_records");
assertIncludes(detailJs, "人事导入记录");
assertIncludes(detailJs, "来源 Excel");
assertIncludes(historyJs, "HRMS Personnel Import Item");
assertIncludes(historyJs, "来源单据缺失");
```

- [ ] **Step 2: Run `node tests/verify_employee_property_history.js && node tests/verify_personnel_excel_template_pack.js`.** Expected: missing source lookup failure.
- [ ] **Step 3: Implement source lookup and rendering.**

```python
def get_employee_personnel_import_records(employee):
    return frappe.get_all("HRMS Personnel Import Item", filters={"employee": employee, "review_status": ["in", ["已生成草稿", "已提交"]]}, fields=["name", "record_type", "source_sheet", "source_row", "target_doctype", "target_name", "review_status"], order_by="modified desc")
```

- [ ] **Step 4: Render source Sheet/row; open target only when both doctype/name exist. Keep existing `来源单据缺失` fallback.**
- [ ] **Step 5: Run contracts and commit:** `node tests/verify_employee_property_history.js && node tests/verify_personnel_excel_template_pack.js && git add hrms/api/employee_field_template.py hrms/hr/page/employee_detail/employee_detail.js hrms/hr/page/employee_property_history/employee_property_history.js tests/verify_employee_property_history.js tests/verify_personnel_excel_template_pack.js && git commit -m 'feat: trace personnel imports in employee records'`.

### Task 8: TEST-HRMS 全链路验收

**Files:** Modify `tests/test_personnel_excel_import.py`; Create `docs/acceptance/test-hrms-personnel-excel-import.md`.

- [ ] **Step 1: Write a complete pack test.**

```python
def test_full_personnel_pack_review_and_submit_flow(test_company, make_test_employee, make_upload):
    employee = make_test_employee(employee_code="TEST-E2E-001")
    batch = create_personnel_import_batch(make_upload(valid_pack_for(employee)))
    for item_name in batch["item_names"]:
        review_personnel_import_item(item_name, "通过", "TEST-HRMS 验收")
        generate_personnel_import_draft(item_name)
        submit_personnel_import_item(item_name)
    assert all(status == "已提交" for status in item_statuses(batch["name"]))
```

- [ ] **Step 2: Run `bench --site test_site run-tests --module tests.test_personnel_excel_import`.** Expected: PASS using only TEST-HRMS records.
- [ ] **Step 3: Run regression:** `python3 -m py_compile hrms/api/personnel_excel_import.py hrms/api/employee_field_template.py && node --check hrms/hr/page/personnel_excel_import/personnel_excel_import.js && node tests/verify_personnel_excel_template_pack.js && node tests/verify_employee_roster_import_export.js && node tests/verify_employee_field_template.js && node tests/verify_personnel_roster.js && node tests/verify_employee_property_history.js && git diff --check`. Expected: all exit 0.
- [ ] **Step 4: Record acceptance:** template sheets download; all business and approval values are editable; unreviewed records do not write Employee; work number/department display are correct; failure rows download; only TEST-HRMS was touched.
- [ ] **Step 5: Commit:** `git add tests/test_personnel_excel_import.py docs/acceptance/test-hrms-personnel-excel-import.md && git commit -m 'test: cover personnel Excel import review flow'`.

## Plan Self-Review

- 模板、结构化字段、审批明细、校验、复核、草稿、提交、合同、花名册、任职历史、权限、失败行和 TEST-HRMS 验收均有对应任务。
- 所有流程以工号关联 Employee；Employee 只在受控阶段写入；标准 HRMS 提交钩子不被绕过。
- 不含扫描件、OCR、电子签名、考勤、薪资、审批引擎和组织模块改动。
