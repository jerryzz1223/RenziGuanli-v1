"""Run inside bench via env/bin/python; validates synthetic docs without saving."""

import json

import frappe


def main():
	frappe.init(site="hrms.localhost", sites_path="/home/frappe/frappe-bench/sites")
	frappe.connect()
	try:
		from hrms.api.employee_field_template import CHINA_ETHNICITY_VALUES, _normalise_import_value
		from hrms.overrides.employee_master import EmployeeMaster
		from hrms.utils.employee_profile import NATIVE_PLACE_ALIASES

		meta = frappe.get_meta("Employee")
		checks = 0
		for fieldname in ("custom_ethnicity", "custom_native_place"):
			field = meta.get_field(fieldname)
			assert field.fieldtype == "Select"
			options = [value.strip() for value in field.options.splitlines() if value.strip()]
			if fieldname == "custom_ethnicity":
				assert set(options) == set(CHINA_ETHNICITY_VALUES)
				aliases = {value.removesuffix("族"): value for value in options}
			else:
				aliases = {value[:-1]: value for value in options if value.endswith(("省", "市"))}
				aliases.update(NATIVE_PLACE_ALIASES)
				assert set(aliases.values()) == set(options)
			for short, expected in aliases.items():
				for value in (short, expected, f"　{short} \n"):
					assert _normalise_import_value(fieldname, value, field.as_dict()) == expected
					checks += 1

		for ethnicity, native_place, expected_ethnicity, expected_native_place in (
			("汉", "陕西", "汉族", "陕西省"),
			("蒙古", "内蒙古", "蒙古族", "内蒙古自治区"),
			("壮", "广西", "壮族", "广西壮族自治区"),
		):
			doc = frappe.get_doc({
				"doctype": "Employee", "name": "__profile_validation_only__", "__islocal": 1,
				"custom_employee_code": "__profile_validation_only__", "first_name": "匹配校验样例",
				"status": "Active", "date_of_birth": "1990-01-01", "date_of_joining": "2026-01-01",
				"create_user_automatically": 0, "create_user_permission": 0,
				"custom_ethnicity": ethnicity, "custom_native_place": native_place,
			})
			assert isinstance(doc, EmployeeMaster)
			assert not frappe.db.exists("Employee", doc.name)
			doc._action = "save"
			doc.run_before_save_methods()
			doc._validate_selects()
			assert (doc.custom_ethnicity, doc.custom_native_place) == (expected_ethnicity, expected_native_place)

		for fieldname, value in (("custom_ethnicity", "未知民族"), ("custom_native_place", "西安")):
			field = meta.get_field(fieldname)
			assert _normalise_import_value(fieldname, value, field.as_dict()) == value
			doc = frappe.get_doc({"doctype": "Employee", fieldname: value})
			try:
				doc._validate_selects()
			except frappe.ValidationError:
				pass
			else:
				raise AssertionError("Unknown profile value must still fail Select validation")
		print(json.dumps({"import_checks": checks, "employee_validation_checks": 3,
			"unknown_values_rejected": 2, "employee_records_written": 0}))
	finally:
		frappe.db.rollback()
		frappe.destroy()


if __name__ == "__main__":
	main()
