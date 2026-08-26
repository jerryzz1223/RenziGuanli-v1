from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EMPLOYEE_FIELDS = (ROOT / "hrms" / "api" / "employee_field_template.py").read_text()
PAYROLL = (ROOT / "hrms" / "api" / "payroll_input.py").read_text()
DETAIL = (ROOT / "hrms" / "hr" / "page" / "employee_detail" / "employee_detail.js").read_text()


for fieldname in (
	"custom_social_insurance_status",
	"custom_social_insurance_start_date",
	"custom_social_insurance_end_date",
):
	assert fieldname in EMPLOYEE_FIELDS, f"missing employee social-insurance field: {fieldname}"

assert "按社保名单\\n参保中\\n不参保（已确认）\\n停缴" in EMPLOYEE_FIELDS
assert "def _social_insurance_payroll_policy" in PAYROLL
assert "This intentionally does not infer non-participation from\n\tprobation status." in PAYROLL
assert "SOCIAL_INSURANCE_VARIABLE_TYPES" in PAYROLL
assert '"social_insurance_policy": social_insurance_policy' in PAYROLL
assert 'this.get_employment_type_display(header)' in DETAIL
assert 'field.fieldname === "employment_type"' in DETAIL
assert "PAYROLL_WELFARE_SOURCE_DOCTYPE" in EMPLOYEE_FIELDS
assert "PAYROLL_SOCIAL_INSURANCE_SOURCE_TYPES" in EMPLOYEE_FIELDS
assert "_get_employee_payroll_social_insurance_items(doc)" in EMPLOYEE_FIELDS
assert '"社保个人"' in EMPLOYEE_FIELDS
assert "compact=True" in EMPLOYEE_FIELDS
assert "if (row.compact)" in DETAIL
assert 'tab_label === "工资社保" ? "" : this.render_add_field_hint()' in DETAIL

print("social-insurance payroll policy verified")
