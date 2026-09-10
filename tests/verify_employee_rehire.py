"""Static wiring checks for the employee rehire profile chain."""

import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REHIRE = (ROOT / "hrms/utils/employee_rehire.py").read_text()
MASTER = (ROOT / "hrms/overrides/employee_master.py").read_text()
API = (ROOT / "hrms/api/employee_field_template.py").read_text()
FORM = (ROOT / "hrms/public/js/erpnext/employee.js").read_text()
DETAIL = (ROOT / "hrms/hr/page/employee_detail/employee_detail.js").read_text()
SETUP = (ROOT / "hrms/setup.py").read_text()

for source in (REHIRE, MASTER, API, SETUP):
	ast.parse(source)

for marker in (
	"PREVIOUS_EMPLOYMENT_FIELD = \"custom_rehired_from_employee\"",
	"IDENTITY_NUMBER_FIELDS = (IDENTITY_NUMBER_FIELD, \"custom_id_number\")",
	"find_employment_history",
	"link_new_employee_to_previous_employment",
):
	assert marker in REHIRE, marker

assert "link_new_employee_to_previous_employment(self)" in MASTER
for marker in (
	"def ensure_employee_rehire_setup():",
	"def check_employee_rehire_history(identity_number: str):",
	"def _get_employee_growth_timeline(doc, employment_history):",
	'"previous_employment"',
):
	assert marker in API, marker

assert "ensure_employee_rehire_setup()" in SETUP
assert "passport_number(frm)" in FORM
assert "show_employee_rehire_notice(frm)" in FORM
assert "check_employee_rehire_history" in FORM
assert "open-previous-employment" in DETAIL
assert "data-previous-employee" in DETAIL
assert "record.description" in DETAIL

print("PASS: employee rehire warning, immutable previous-profile link, and continuous growth timeline are wired")
