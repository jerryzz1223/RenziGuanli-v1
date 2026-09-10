"""Focused unit checks for cross-field employee rehire matching."""

import sys
import types
from pathlib import Path


class Row(dict):
	__getattr__ = dict.__getitem__


class EmployeeMeta:
	def has_field(self, fieldname):
		return fieldname in {"passport_number", "custom_id_number", "custom_rehired_from_employee"}


ROWS = [
	Row(name="EMP-2018", employee_name="张三", custom_employee_code="18001", passport_number="ID-001", custom_id_number="", date_of_joining="2018-03-09", creation="2018-03-01"),
	Row(name="EMP-2022", employee_name="张三", custom_employee_code="22002", passport_number="", custom_id_number="ID-001", date_of_joining="2022-04-01", creation="2022-03-20"),
]


frappe = types.ModuleType("frappe")
frappe.get_meta = lambda doctype: EmployeeMeta()
frappe.whitelist = lambda **kwargs: lambda function: function
frappe.get_all = lambda doctype, filters, **kwargs: [
	row
	for row in ROWS
	if row.get(next(key for key in filters if key != "name")) == filters[next(key for key in filters if key != "name")]
	and ("name" not in filters or row.name != filters["name"][1])
]
utils = types.ModuleType("frappe.utils")
utils.cstr = lambda value: "" if value is None else str(value)
utils.add_days = lambda value, days: value
utils.date_diff = lambda end, start: 0
sys.modules["frappe"] = frappe
sys.modules["frappe.utils"] = utils
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from hrms.utils.employee_rehire import (  # noqa: E402
	find_employment_history,
	get_rehire_autofill_values,
	link_new_employee_to_previous_employment,
)


history = find_employment_history(" ID-001 ")
assert [row.name for row in history] == ["EMP-2018", "EMP-2022"]


class NewEmployee(dict):
	name = "EMP-2026"
	meta = EmployeeMeta()

	def is_new(self):
		return True

	def get(self, key, default=None):
		return super().get(key, default)

	def set(self, key, value):
		self[key] = value


employee = NewEmployee(passport_number="ID-001")
previous = link_new_employee_to_previous_employment(employee)
assert previous.name == "EMP-2022"
assert employee["custom_rehired_from_employee"] == "EMP-2022"

profile = NewEmployee(
	first_name="张三",
	cell_number="13800000000",
	department="品保课",
	designation="检验员",
	custom_employee_code="22002",
	date_of_joining="2022-04-01",
)
profile.meta.has_field = lambda fieldname: fieldname in profile
autofill_values = get_rehire_autofill_values(profile)
assert autofill_values == {"first_name": "张三", "cell_number": "13800000000"}
print("PASS: rehire matching, latest prior link, and safe person-profile autofill are verified")
