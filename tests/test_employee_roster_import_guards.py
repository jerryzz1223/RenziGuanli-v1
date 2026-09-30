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
	def test_merge_conflicts_require_field_choices_and_preserve_selected_existing_values(self):
		stored = {"employee_name": "旧姓名", "department": "旧部门", "cell_number": "13800000000"}
		frappe = types.SimpleNamespace(
			get_doc=lambda _doctype, _name: types.SimpleNamespace(get=stored.get),
			throw=lambda message: (_ for _ in ()).throw(ValueError(message)),
		)
		ns = load_functions(
			"_employee_roster_field_conflicts", "_employee_roster_conflict_signature",
			EMPLOYEE_DOCTYPE="Employee", frappe=frappe,
			hashlib=__import__("hashlib"), json=__import__("json"), _=lambda value: value,
		)
		incoming = {"custom_employee_code": "4018", "employee_name": "新姓名", "department": "新部门", "cell_number": "13800000000"}
		fields = {name: {"field_label": name} for name in incoming}
		conflicts = ns["_employee_roster_field_conflicts"]("EMP-1", incoming, fields, {"employee_name": "existing"})
		self.assertEqual([field["fieldname"] for field in conflicts], ["employee_name", "department"])
		self.assertEqual([field["choice"] for field in conflicts], ["existing", ""])
		self.assertNotIn("employee_name", incoming)
		self.assertEqual(incoming["department"], "新部门")
		original_signature = ns["_employee_roster_conflict_signature"](conflicts)
		stored["department"] = "另一部门"
		new_conflicts = ns["_employee_roster_field_conflicts"]("EMP-1", {"department": "新部门"}, fields, {"department": "import"})
		self.assertNotEqual(original_signature, ns["_employee_roster_conflict_signature"](new_conflicts))
		with self.assertRaisesRegex(ValueError, "选项不正确"):
			ns["_employee_roster_field_conflicts"]("EMP-1", {"department": "新部门"}, fields, {"department": "overwrite_all"})
		stored.update({"first_name": "旧姓名", "custom_work_nature": "在职·正式", "status": "Active"})
		coupled = {"first_name": "新姓名", "employee_name": "新姓名", "custom_work_nature": "离职", "status": "Left"}
		coupled_fields = {name: {"field_label": name} for name in coupled}
		seen = ns["_employee_roster_field_conflicts"]("EMP-1", coupled, coupled_fields, {"first_name": "existing", "custom_work_nature": "existing"})
		self.assertEqual([field["fieldname"] for field in seen], ["first_name", "custom_work_nature"])
		self.assertNotIn("employee_name", coupled)
		self.assertNotIn("status", coupled)

	def test_merge_plan_inserts_unknown_code_and_requires_review_for_existing_code(self):
		context = {
			"rows": [["工号", "手机号"], ["4018", "13900000000"], ["4019", "13700000000"]],
			"data_start_index": 1,
			"matches": [{"fieldname": "custom_employee_code", "column_index": 0}, {"fieldname": "cell_number", "column_index": 1}],
			"fields": [{"fieldname": "custom_employee_code", "field_label": "工号"}, {"fieldname": "cell_number", "field_label": "手机号"}],
			"missing_required": [],
		}
		frappe = types.SimpleNamespace(
			db=types.SimpleNamespace(exists=lambda *_args: True),
			get_doc=lambda *_args: types.SimpleNamespace(get=lambda field: "13800000000" if field == "cell_number" else None),
			throw=lambda message: (_ for _ in ()).throw(ValueError(message)),
		)
		ns = load_functions(
			"_build_employee_roster_import_plan", "_employee_roster_field_conflicts", "_employee_roster_conflict_signature",
			"_dedupe_import_errors",
			EMPLOYEE_DUPLICATE_MATCH_FIELDS={"employee_code": ("custom_employee_code",)},
			EMPLOYEE_DOCTYPE="Employee", hashlib=__import__("hashlib"), json=__import__("json"),
			_apply_manual_header_mappings=lambda value, _mappings: value,
			_get_uploaded_roster_context=lambda _url: context,
			_get_employee_meta_field_map=lambda: {"custom_employee_code": {}, "cell_number": {}},
			_parse_json=lambda value, _fallback: value,
			_is_blank_value=lambda value: value in (None, ""),
			_row_to_employee_values=lambda row, *_args: ({"custom_employee_code": row[0], "cell_number": row[1]}, []),
			_resolve_company=lambda *_args: "永新", _get_default_company=lambda: "永新",
			_get_latest_dingtalk_onjob_snapshot=lambda _company: {"employee_codes": set()},
			_validate_employee_import_row=lambda *_args, **_kwargs: [],
			_employee_roster_source_conflict=lambda *_args: None,
			_preview_employee_action=lambda values, *_args: ("update", "EMP-1") if values["custom_employee_code"] == "4018" else ("insert", None),
			_employee_roster_mandatory_field_errors=lambda *_args: [],
			_get_employee_roster_preview_code=lambda values, _existing: values["custom_employee_code"],
			_apply_employee_roster_insert_defaults=lambda *_args: None,
			frappe=frappe, _=lambda value: value,
		)
		build = ns["_build_employee_roster_import_plan"]
		preview, _rows, _meta = build("file", mode="merge")
		self.assertEqual((preview["inserted"], preview["updated"], preview["unresolved_conflicts"]), (1, 1, 1))
		self.assertEqual(preview["conflicts"][0]["fields"][0]["existing_value"], "13800000000")
		signature = preview["conflicts"][0]["signature"]
		resolved, rows, _meta = build("file", mode="merge", field_resolutions={"2": {"cell_number": "existing"}}, conflict_signatures={"2": signature}, require_conflict_signatures=True)
		self.assertEqual(resolved["unresolved_conflicts"], 0)
		self.assertNotIn("cell_number", rows[0]["values"])
		self.assertEqual(rows[1]["action"], "insert")
		with self.assertRaisesRegex(ValueError, "重新预览"):
			build("file", mode="merge", field_resolutions={"2": {"cell_number": "import"}}, conflict_signatures={"2": "stale"}, require_conflict_signatures=True)

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

	def test_full_replace_clears_blank_mapped_fields_instead_of_merging_old_values(self):
		ns = load_functions(
			"_row_to_employee_values",
			_is_employee_import_deferred_placeholder=lambda value: value == "-",
			_can_defer_employee_import_field=lambda _field: True,
			_normalise_import_value=lambda _field, value, _metadata: None if value in (None, "", "-") else value,
			_excel_cell_reference=lambda *_args: "A2",
			_is_blank_value=lambda value: value in (None, ""),
			_is_employee_import_required_field=lambda *_args: False,
			_apply_identity_card_derivatives=lambda *_args: None,
			_=lambda value: value,
		)
		fields = {name: {"fieldname": name} for name in ("custom_employee_code", "cell_number", "custom_native_place")}
		matches = [{"fieldname": name, "column_index": index} for index, name in enumerate(fields)]
		row = ["4018", "", "-"]
		old_values, _ = ns["_row_to_employee_values"](row, matches, fields, [], 2)
		replaced_values, _ = ns["_row_to_employee_values"](row, matches, fields, [], 2, None, True)
		self.assertNotIn("cell_number", old_values)
		self.assertEqual(replaced_values["cell_number"], None)
		self.assertEqual(replaced_values["custom_native_place"], None)

	def test_merge_blank_cell_is_sparse_but_explicit_editor_blank_clears(self):
		ns = load_functions(
			"_row_to_employee_values",
			_is_employee_import_deferred_placeholder=lambda _value: False,
			_normalise_import_value=lambda _field, value, _metadata: value or None,
			_excel_cell_reference=lambda *_args: "A2",
			_is_blank_value=lambda value: value in (None, ""),
			_is_employee_import_required_field=lambda *_args: False,
			_apply_identity_card_derivatives=lambda *_args: None,
			_=lambda value: value,
		)
		fields = {name: {"fieldname": name} for name in ("custom_employee_code", "cell_number")}
		matches = [{"fieldname": name, "column_index": index} for index, name in enumerate(fields)]
		plain, _ = ns["_row_to_employee_values"](["4018", ""], matches, fields, [], 2, None, False, True)
		edited, _ = ns["_row_to_employee_values"](["4018", ""], matches, fields, [], 2, {"cell_number": ""}, False, True)
		self.assertNotIn("cell_number", plain)
		self.assertIsNone(edited["cell_number"])

	def test_required_employee_fields_cannot_be_deferred_or_cleared_on_replace(self):
		ns = load_functions(
			"_employee_roster_mandatory_field_errors",
			EMPLOYEE_FALLBACK_DATE_OF_BIRTH="1905-01-01",
			_is_blank_value=lambda value: value in (None, ""),
			_field_error=lambda row, field, message, suggestion: {
				"row": row, "fieldname": field["fieldname"], "message": message, "suggestion": suggestion,
			},
			_=lambda value: value,
		)
		check = ns["_employee_roster_mandatory_field_errors"]
		field = {"date_of_birth": {"fieldname": "date_of_birth", "field_label": "出生年月"},
			"gender": {"fieldname": "gender", "field_label": "性别"}}
		meta = {name: {"reqd": 1, "label": name} for name in ("date_of_birth", "gender")}
		meta["current_address"] = {"reqd": 0, "label": "当前地址"}
		deferred = {"_employee_import_deferred_fields": {"date_of_birth"}}
		for mode, action in (("insert", "insert"), ("replace", "insert"), ("replace", "update")):
			with self.subTest(mode=mode, action=action):
				self.assertEqual(check(deferred, action, mode, 7, field, meta)[0]["fieldname"], "date_of_birth")
		cleared = {"date_of_birth": None, "gender": None, "current_address": None}
		self.assertEqual({error["fieldname"] for error in check(cleared, "update", "replace", 8, field, meta)},
			{"date_of_birth", "gender"})
		self.assertEqual({error["fieldname"] for error in check(cleared, "insert", "replace", 8, field, meta)},
			{"date_of_birth", "gender"})
		self.assertEqual(check(cleared, "update", "update", 8, field, meta), [])
		self.assertEqual(check({"date_of_birth": "1992-03-04"}, "update", "replace", 8, field, meta), [])
		self.assertEqual(check({"date_of_birth": "1905-01-01"}, "update", "merge", 8, field, meta)[0]["message"],
			"出生日期是系统占位值")

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
		self.assertNotIn("date_of_birth", values)
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
			"_employee_roster_mandatory_field_errors",
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

	def test_replace_keeps_history_without_inventing_a_departure(self):
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
			"_employee_roster_mandatory_field_errors",
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
		self.assertEqual(result["failed"], 0)
		self.assertEqual(result["archived"], 1)

	def test_replace_candidates_include_departed_members_and_exclude_other_companies(self):
		calls = []
		def get_all(_doctype, **kwargs):
			calls.append(kwargs)
			return [
				types.SimpleNamespace(name="EMP-LEFT", custom_employee_code="4019"),
				types.SimpleNamespace(name="EMP-CURRENT", custom_employee_code="4018"),
			]
		ns = load_functions(
			"_get_employee_roster_replace_candidates",
			_get_default_company=lambda: "永新",
			EMPLOYEE_DOCTYPE="Employee",
			frappe=types.SimpleNamespace(get_all=get_all),
		)
		candidates = ns["_get_employee_roster_replace_candidates"](
			[{"existing": "EMP-CURRENT", "values": {"custom_employee_code": "4018"}}], "永新"
		)
		self.assertEqual(candidates, ["EMP-LEFT"])
		self.assertEqual(calls[0]["filters"], {"company": "永新", "custom_roster_excluded": 0})


if __name__ == "__main__":
	unittest.main()
