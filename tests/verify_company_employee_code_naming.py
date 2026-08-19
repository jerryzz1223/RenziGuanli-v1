from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EMPLOYEE_MASTER = (ROOT / "hrms/overrides/employee_master.py").read_text()
HR_SETTINGS = (ROOT / "hrms/hr/doctype/hr_settings/hr_settings.py").read_text()
PATCH = (ROOT / "hrms/patches/v16_0/use_company_employee_code_as_employee_name.py").read_text()
PATCHES = (ROOT / "hrms/patches.txt").read_text()


def require(source, marker):
	assert marker in source, f"Missing company employee-code naming contract: {marker}"


for marker in (
	"def _apply_company_employee_code",
	"请填写公司员工号",
	"self.name = self.custom_employee_code",
	"self.employee = self.name",
	"公司员工号创建后不可直接修改",
	"公司员工号 {0} 已被员工档案",
):
	require(EMPLOYEE_MASTER, marker)

assert "set_name_by_naming_series" not in EMPLOYEE_MASTER
require(HR_SETTINGS, 'self.emp_created_by = "Company Employee Code"')

for marker in ("rename_doc(\"Employee\"", "custom_employee_code", "缺少公司员工号"):
	require(PATCH, marker)

require(PATCHES, "hrms.patches.v16_0.use_company_employee_code_as_employee_name")
print("Company employee-code naming contract passed.")
