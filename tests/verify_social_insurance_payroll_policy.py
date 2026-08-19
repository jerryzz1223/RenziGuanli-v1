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
assert 'this.get_personnel_status_display(header.custom_personnel_status || "未设置")' in DETAIL
assert 'field.fieldname === "custom_personnel_status"' in DETAIL

print("social-insurance payroll policy verified")
