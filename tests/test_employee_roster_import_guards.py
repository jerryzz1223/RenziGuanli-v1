"""Focused import guards without requiring a running Frappe site."""

import ast
import re
import types
import unittest
from collections import Counter
from pathlib import Path


SOURCE = Path(__file__).resolve().parents[1] / "hrms/api/employee_field_template.py"
TREE = ast.parse(SOURCE.read_text())


def load_functions(*names, **dependencies):
	functions = [node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name in names]
	module = ast.Module(body=functions, type_ignores=[])
	namespace = dict(dependencies)
	exec(compile(module, str(SOURCE), "exec"), namespace)
	return namespace


class RosterImportGuardTests(unittest.TestCase):
	def test_education_options_and_explicit_import_alias(self):
		options = next(node.value for node in TREE.body if isinstance(node, ast.Assign)
			and any(isinstance(target, ast.Name) and target.id == "EDUCATION_LEVEL_OPTIONS" for target in node.targets))
		self.assertIn("小学", ast.literal_eval(options))
		ns = load_functions("_normalise_import_value", _clean_import_value=lambda value: value,
			_reverse_option_label=lambda value, _fieldname: str(value).strip())
		field = {"fieldtype": "Select", "options": "小学\n初中"}
		self.assertEqual(ns["_normalise_import_value"]("custom_education_level", "小学", field), "小学")
		self.assertEqual(ns["_normalise_import_value"]("custom_education_level", "初中及以下", field), "初中")
		self.assertEqual(ns["_normalise_import_value"]("custom_education_level", "高中", field), "高中")

	def test_work_nature_trial_aliases_do_not_guess_other_values(self):
		ns = load_functions("_normalise_work_nature_import_value", re=re)
		for source in ("在职·试用", "在职·试用期", "正式·试用", "正式·试用期", "正式 ・ 试用期"):
			with self.subTest(source=source):
				self.assertEqual(ns["_normalise_work_nature_import_value"](source), "在职·试用期")
		self.assertEqual(ns["_normalise_work_nature_import_value"]("正式·其他"), "正式·其他")

	def test_roster_import_reports_normalised_values(self):
		normalise = load_functions("_normalise_work_nature_import_value", re=re)["_normalise_work_nature_import_value"]
		ns = load_functions(
			"_row_to_employee_values",
			_is_employee_import_deferred_placeholder=lambda _value: False,
			_normalise_import_value=lambda _field, value, _metadata: {"初中及以下": "初中"}.get(value, value),
			_excel_cell_reference=lambda *_args: "A2",
			_is_blank_value=lambda value: value in (None, ""),
			_is_employee_import_required_field=lambda *_args: False,
			_normalise_work_nature_import_value=normalise,
			_apply_identity_card_derivatives=lambda *_args: None,
			_=lambda value: value,
		)
		fields = {name: {"fieldname": name} for name in ("custom_education_level", "custom_work_nature")}
		matches = [{"fieldname": name, "column_index": index} for index, name in enumerate(fields)]
		warnings = []
		values, errors = ns["_row_to_employee_values"](["初中及以下", "正式·试用"], matches, fields, warnings, 2)
		self.assertEqual(errors, [])
		self.assertEqual(values, {"custom_education_level": "初中", "custom_work_nature": "在职·试用期"})
		self.assertEqual(warnings, [
			"第 2 行：学历“初中及以下”已匹配为“初中”。",
			"第 2 行：工作性质“正式·试用”已匹配为“在职·试用期”。",
		])

	def test_approved_dingtalk_import_keeps_supplied_work_nature(self):
		source = SOURCE.parents[2] / "hrms/overrides/employee_master.py"
		function = next(
			node for node in ast.parse(source.read_text()).body
			if isinstance(node, ast.FunctionDef) and node.name == "apply_employee_work_nature"
		)
		ns = {
			"cstr": lambda value: str(value or ""),
			"WORK_NATURE_OPTIONS": ("在职·正式", "在职·试用期", "退休返聘", "待离职", "离职"),
			"_find_employment_type": lambda *_values: "Full-time",
			"frappe": types.SimpleNamespace(throw=lambda message: (_ for _ in ()).throw(ValueError(message))),
			"_": lambda value: value,
		}
		exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), ns)
		employee = types.SimpleNamespace(
			flags=types.SimpleNamespace(hrms_dingtalk_sync=True, hrms_employee_roster_import=False),
			meta=types.SimpleNamespace(has_field=lambda _field: True),
			is_new=lambda: True,
			has_value_changed=lambda _field: False,
			custom_work_nature="在职·正式",
			get=lambda field: "在职·正式" if field == "custom_work_nature" else None,
			status="",
		)
		ns["apply_employee_work_nature"](employee)
		self.assertEqual(employee.custom_work_nature, "在职·正式")
		self.assertEqual(employee.status, "Active")
		self.assertEqual(employee.custom_is_confirmed, "是")

	def test_dingtalk_snapshot_reports_missing_and_duplicate_codes(self):
		def get_all(doctype, **kwargs):
			if kwargs.get("fields") == ["name", "status", "started_at", "records_received"]:
				return [types.SimpleNamespace(name="SYNC-1", status="已完成", started_at="2026-09-29", records_received=3)]
			if doctype == "HRMS DingTalk Raw Record":
				return ["RAW-1", "RAW-2", "RAW-3"]
			return [types.SimpleNamespace(employee_code=code) for code in ("4018", "4018", "")]

		frappe = types.SimpleNamespace(
			db=types.SimpleNamespace(exists=lambda *_args: True), get_all=get_all
		)
		ns = load_functions("_get_latest_dingtalk_onjob_snapshot", frappe=frappe, Counter=Counter)
		snapshot = ns["_get_latest_dingtalk_onjob_snapshot"]("永新")
		self.assertEqual(snapshot["employee_codes"], {"4018"})
		self.assertEqual(snapshot["missing_employee_code_count"], 1)
		self.assertEqual(snapshot["duplicate_employee_codes"], ["4018"])
		self.assertEqual((snapshot["snapshot_row_count"], snapshot["records_received"]), (3, 3))

	def test_sparse_update_does_not_supply_status_birthdate_or_user_flags(self):
		ns = load_functions(
			"_row_to_employee_values",
			"_apply_employee_roster_insert_defaults",
			_is_employee_import_deferred_placeholder=lambda _value: False,
			_normalise_import_value=lambda _field, value, _metadata: value,
			_excel_cell_reference=lambda *_args: "A2",
			_is_blank_value=lambda value: value in (None, ""),
			_is_employee_import_required_field=lambda *_args: False,
			_apply_identity_card_derivatives=lambda *_args: None,
			EMPLOYEE_FALLBACK_DATE_OF_BIRTH="1900-01-01",
			_=lambda value: value,
		)
		fields = {"custom_employee_code": {"fieldname": "custom_employee_code"}, "date_of_birth": {"fieldname": "date_of_birth"}}
		values, errors = ns["_row_to_employee_values"](
			["4018"], [{"fieldname": "custom_employee_code", "column_index": 0}], fields, [], 2
		)
		self.assertEqual(errors, [])
		self.assertEqual(values, {"custom_employee_code": "4018"})
		ns["_apply_employee_roster_insert_defaults"](values, [], 2, fields)
		self.assertEqual(values["status"], "Active")
		self.assertEqual(values["date_of_birth"], "1900-01-01")
		self.assertEqual(values["create_user_automatically"], 0)

	def test_unknown_explicit_company_cannot_fall_back(self):
		def reject(message):
			raise ValueError(message)

		frappe = types.SimpleNamespace(
			db=types.SimpleNamespace(exists=lambda *_args: None, get_value=lambda *_args: None),
			throw=reject,
		)
		ns = load_functions(
			"_resolve_company", _clean_import_value=lambda value: value, frappe=frappe, _=lambda value: value
		)
		with self.assertRaisesRegex(ValueError, "不能自动改为默认公司"):
			ns["_resolve_company"]("错误公司", "永新", [])

	def test_duplicate_existing_code_is_not_matched_arbitrarily(self):
		def reject(message):
			raise ValueError(message)

		frappe = types.SimpleNamespace(
			db=types.SimpleNamespace(count=lambda *_args: 2, get_value=lambda *_args: "EMP-1"),
			throw=reject,
		)
		ns = load_functions(
			"_find_existing_employee_by_strategy",
			EMPLOYEE_DUPLICATE_MATCH_FIELDS={"employee_code": ("custom_employee_code",)},
			EMPLOYEE_DOCTYPE="Employee",
			frappe=frappe,
			_=lambda value: value,
		)
		with self.assertRaisesRegex(ValueError, "重复工号"):
			ns["_find_existing_employee_by_strategy"](
			{"custom_employee_code": "4018"}, {"custom_employee_code": {}}, company="永新"
		)

	def test_duplicate_business_key_in_one_workbook_is_rejected(self):
		context = {
			"rows": [["工号"], ["4018"], ["4018"]],
			"data_start_index": 1,
			"matches": [{"fieldname": "custom_employee_code", "column_index": 0}],
			"fields": [{"fieldname": "custom_employee_code", "field_label": "工号"}],
			"missing_required": [],
		}
		frappe = types.SimpleNamespace(db=types.SimpleNamespace(exists=lambda *_args: True))
		ns = load_functions(
			"_build_employee_roster_import_plan",
			"_dedupe_import_errors",
			EMPLOYEE_DUPLICATE_MATCH_FIELDS={"employee_code": ("custom_employee_code",)},
			EMPLOYEE_DOCTYPE="Employee",
			_apply_manual_header_mappings=lambda value, _mappings: value,
			_get_uploaded_roster_context=lambda _url: context,
			_get_employee_meta_field_map=lambda: {"custom_employee_code": {}},
			_parse_json=lambda value, _default: value,
			_is_blank_value=lambda value: value in (None, ""),
			_row_to_employee_values=lambda row, *_args: ({"custom_employee_code": row[0]}, []),
			_resolve_company=lambda *_args: "永新",
			_get_default_company=lambda: "永新",
			_get_latest_dingtalk_onjob_snapshot=lambda _company: {"employee_codes": set()},
			_validate_employee_import_row=lambda *_args, **_kwargs: [],
			_employee_roster_source_conflict=lambda *_args: None,
			_preview_employee_action=lambda *_args: ("insert", None),
			_get_employee_roster_preview_code=lambda values, _existing: values["custom_employee_code"],
			_apply_employee_roster_insert_defaults=lambda *_args: None,
			_field_error=lambda _row, field, message: {"fieldname": field["fieldname"], "message": message},
			_make_failed_row=lambda row, error, _source: {"row": row, **error},
			frappe=frappe,
			_=lambda value: value,
		)
		result, planned, _meta = ns["_build_employee_roster_import_plan"]("unused")
		self.assertEqual((result["inserted"], result["failed"]), (1, 1))
		self.assertEqual(len(planned), 1)
		self.assertIn("重复", result["errors"][0]["message"])

	def test_replace_never_archives_without_a_complete_snapshot(self):
		context = {
			"rows": [["工号"], ["4018"]],
			"data_start_index": 1,
			"matches": [{"fieldname": "custom_employee_code", "column_index": 0}],
			"fields": [{"fieldname": "custom_employee_code", "field_label": "工号"}],
			"missing_required": [],
		}
		frappe = types.SimpleNamespace(
			db=types.SimpleNamespace(exists=lambda *_args: True),
			get_all=lambda *_args, **_kwargs: [types.SimpleNamespace(name="EMP-2", custom_employee_code="4019")],
		)
		ns = load_functions(
			"_build_employee_roster_import_plan",
			"_dedupe_import_errors",
			EMPLOYEE_DUPLICATE_MATCH_FIELDS={"employee_code": ("custom_employee_code",)},
			EMPLOYEE_DOCTYPE="Employee",
			_apply_manual_header_mappings=lambda value, _mappings: value,
			_get_uploaded_roster_context=lambda _url: context,
			_get_employee_meta_field_map=lambda: {"custom_employee_code": {}},
			_parse_json=lambda value, _default: value,
			_is_blank_value=lambda value: value in (None, ""),
			_row_to_employee_values=lambda row, *_args: ({"custom_employee_code": row[0]}, []),
			_resolve_company=lambda *_args: "永新",
			_get_default_company=lambda: "永新",
			_get_latest_dingtalk_onjob_snapshot=lambda _company: {"status": "", "employee_codes": set(), "snapshot_row_count": 0, "records_received": 0},
			_validate_employee_import_row=lambda *_args, **_kwargs: [],
			_employee_roster_source_conflict=lambda *_args: None,
			_preview_employee_action=lambda *_args: ("update", "EMP-1"),
			_get_employee_roster_preview_code=lambda values, _existing: values["custom_employee_code"],
			_get_employee_roster_replace_candidates=lambda *_args: ["EMP-2"],
			_field_error=lambda _row, field, message: {"fieldname": field["fieldname"], "message": message},
			_make_failed_row=lambda row, error, _source: {"row": row, **error},
			frappe=frappe,
			_=lambda value: value,
		)
		result, _planned, _meta = ns["_build_employee_roster_import_plan"]("unused", mode="replace")
		self.assertGreater(result["failed"], 0)
		self.assertEqual(result["archived"], 0)


if __name__ == "__main__":
	unittest.main()
