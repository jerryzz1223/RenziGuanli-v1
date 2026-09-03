from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
API = (ROOT / "hrms/api/employee_field_template.py").read_text()
PATCH = (ROOT / "hrms/patches/v16_0/normalise_employee_ethnicity_values.py").read_text()
PATCHES = (ROOT / "hrms/patches.txt").read_text()


for marker in (
	"CHINA_ETHNICITY_VALUES",
	"LEGACY_ETHNICITY_VALUE_MAP",
	"value.removesuffix(\"族\")",
	"def _normalise_employee_ethnicity_values():",
	"filters={\"custom_ethnicity\": [\"in\", list(LEGACY_ETHNICITY_VALUE_MAP)]}",
	"\"ethnicity_backfilled\": _normalise_employee_ethnicity_values()",
):
	if marker not in API:
		raise AssertionError(f"Missing ethnicity normalisation contract: {marker}")

if "ensure_employee_china_profile_selectors()" not in PATCH:
	raise AssertionError("The normalisation patch must run the profile-selector repair.")
if "hrms.patches.v16_0.normalise_employee_ethnicity_values" not in PATCHES:
	raise AssertionError("The ethnicity normalisation patch must be registered.")

print("Employee ethnicity normalisation contract passed.")
