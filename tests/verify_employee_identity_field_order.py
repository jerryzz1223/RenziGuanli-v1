import importlib.util
import json
import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "hrms" / "utils" / "employee_form_layout.py"


class Field:
	def __init__(self, fieldname):
		self.fieldname = fieldname


class FakeDB:
	def exists(self, doctype, name):
		return doctype == "DocType" and name == "Employee"


def load_module(order):
	calls = []
	fake_frappe = types.ModuleType("frappe")
	fake_frappe.db = FakeDB()
	fake_frappe.get_meta = lambda doctype: types.SimpleNamespace(fields=[Field(name) for name in order])
	fake_frappe.make_property_setter = lambda args, **kwargs: calls.append((args, kwargs))
	fake_frappe.clear_cache = lambda **kwargs: calls.append(("clear_cache", kwargs))

	previous = sys.modules.get("frappe")
	sys.modules["frappe"] = fake_frappe
	try:
		spec = importlib.util.spec_from_file_location("employee_form_layout_test", MODULE_PATH)
		module = importlib.util.module_from_spec(spec)
		spec.loader.exec_module(module)
	finally:
		if previous is None:
			sys.modules.pop("frappe", None)
		else:
			sys.modules["frappe"] = previous
	return module, calls


module, calls = load_module(
	[
		"basic_details_tab",
		"basic_information",
		"custom_employee_code",
		"first_name",
		"employee_name",
		"column_break_9",
		"gender",
		"passport_details_section",
		"passport_number",
		"custom_passport_type",
		"custom_id_type",
		"valid_upto",
		"column_break_73",
		"date_of_issue",
		"place_of_issue",
		"permanent_address",
		"permanent_accommodation_type",
		"custom_native_place",
	]
)
assert module.ensure_employee_identity_number_in_basic_information() is True
setter, options = calls[0]
new_order = json.loads(setter["value"])
certificate_order = [
	"passport_details_section",
	"passport_number",
	"custom_id_type",
	"custom_passport_type",
	"valid_upto",
	"date_of_issue",
	"place_of_issue",
	"column_break_73",
]
certificate_start = new_order.index("passport_details_section")
assert new_order[certificate_start : certificate_start + len(certificate_order)] == certificate_order
assert new_order.index("passport_number") < new_order.index("custom_employee_code")
assert new_order.index("custom_employee_code") < new_order.index("first_name")
assert new_order.index("permanent_address") == new_order.index("employee_name") + 1
household_start = new_order.index("permanent_address")
assert new_order[household_start : household_start + 3] == [
	"permanent_address",
	"permanent_accommodation_type",
	"custom_native_place",
]
assert new_order.index("custom_native_place") < new_order.index("column_break_9")
assert sorted(new_order) == sorted(
	[
		"basic_details_tab",
		"basic_information",
		"custom_employee_code",
		"first_name",
		"employee_name",
		"column_break_9",
		"gender",
		"passport_details_section",
		"passport_number",
		"custom_passport_type",
		"custom_id_type",
		"valid_upto",
		"column_break_73",
		"date_of_issue",
		"place_of_issue",
		"permanent_address",
		"permanent_accommodation_type",
		"custom_native_place",
	]
)
assert setter["doctype_or_field"] == "DocType"
assert setter["property"] == "field_order"
assert setter["property_type"] == "Small Text"
assert options == {"is_system_generated": True}
assert calls[1] == ("clear_cache", {"doctype": "Employee"})

module, calls = load_module(new_order)
assert module.ensure_employee_identity_number_in_basic_information() is False
assert calls == []

module, calls = load_module(["employee_name", "passport_number", "column_break_9"])
assert module.ensure_employee_identity_number_in_basic_information() is False
assert calls == []

print("PASS: Employee certificate and household fields are ordered before the employee details")
