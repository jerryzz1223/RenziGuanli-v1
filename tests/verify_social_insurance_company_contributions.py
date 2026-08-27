"""Guard both social-insurance import paths against one-sided contribution rows."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAYROLL = (ROOT / "hrms" / "api" / "payroll_input.py").read_text()
FORM_INTAKE = (ROOT / "hrms" / "api" / "form_data_intake.py").read_text()
PAGE = (ROOT / "hrms" / "hr" / "page" / "payroll_input_center" / "payroll_input_center.js").read_text()


assert '("社保公司", flt(_first(row, "公司合计承担25.38%", "公司合计承担", "公司承担")))' in PAYROLL
assert 'if row.template_key == "social_insurance":' in FORM_INTAKE
assert '("社保公司", "社保公司", "公司承担", flt(data.get("company_amount")))' in FORM_INTAKE
assert '"source_type": ["in", ["社保个人", "社保公司"]]' in FORM_INTAKE
assert "personal_record: null, company_record: null" in PAGE
assert "${amountCell(group.company_record)}" in PAGE
assert "const primary = group.personal_record || group.company_record;" in PAGE
assert "data-contribution-view=\"personal\"" in PAGE
assert "data-contribution-view=\"department\"" in PAGE
assert "部门汇总" in PAGE
assert "五险合计" in PAGE
assert "补齐公司承担" not in PAGE
assert 'openSourceCode === code ? "is-active" : ""' in PAGE
assert ".hrms-payroll-variable-source.is-active" in (ROOT / "hrms" / "hr" / "page" / "payroll_input_center" / "payroll_input_center.css").read_text()
assert 'data-download-source-signature-source="${frappe.utils.escape_html(code)}"' in PAGE
assert 'this.download_source_signature_sheet(button.dataset.downloadSourceSignatureSheet, exportView)' in PAGE
assert 'contributionCategory ? this.contribution_view_by_category?.[contributionCategory] || "personal" : "personal"' in PAGE
assert 'frappe.utils.escape_html(__("导出"))' in PAGE
assert 'frappe.utils.escape_html(__("替换文件"))' not in PAGE
assert 'frappe.utils.escape_html(__("导出签字表"))' not in PAGE
assert 'frappe.utils.escape_html(__("收起明细"))' not in PAGE
assert 'data-edit-source-card="${frappe.utils.escape_html(code)}"' not in PAGE
assert "def _contribution_department_export_rows(rows, source_code):" in PAYROLL
assert 'export_view: str = "personal"' in PAYROLL
assert 'department_export = contribution and export_view == "department"' in PAYROLL
assert 'sheet.title = "部门汇总" if department_export else "员工签字确认"' in PAYROLL
assert 'filename_suffix = _("部门汇总") if department_export else _("员工签字确认表")' in PAYROLL
contribution_renderer = PAGE.split("render_contribution_records(target, rows, options = {})", 1)[1].split("queue_contribution_amount_save", 1)[0]
assert "data-toggle-contribution-records" in contribution_renderer
assert '__("不参与计算")' in contribution_renderer
assert "data-edit-variable-record" not in contribution_renderer
assert "data-toggle-variable-record" not in contribution_renderer
assert "toggle_contribution_records(recordNames)" in PAGE
assert "data-inline-contribution-employee-field" in contribution_renderer
assert "queue_contribution_employee_save(group, rowElement)" in PAGE
assert "save_contribution_employee(group, rowElement, key)" in PAGE
assert 'method: "hrms.api.payroll_input.update_payroll_variable_record"' in PAGE

print("social-insurance company contributions verified")
