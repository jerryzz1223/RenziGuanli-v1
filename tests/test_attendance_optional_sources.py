import io
import ast
import types
import unittest
from unittest.mock import patch

from openpyxl import load_workbook
from tests.test_attendance_first_signed_version import load_processing_api
from pathlib import Path


class OptionalSourceTests(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls.api = load_processing_api()

	def batch(self, key):
		return types.SimpleNamespace(name=key, source_type=key, company="TEST", attendance_month="2099-03", status="已确认", source_checksum=key)

	def record(self, code="E1", **overrides):
		return {"employee_code": code, "employee_name": code, "eligible_for_downstream": True, "review_status": "无需审核", "exception_codes": [], "processed_value": {"employee_code": code, "actual_attendance_hours": 160, "standard_hours": 160}, **overrides}

	def quality(self, records, present):
		api = self.api
		inputs = [{"source_type": key, "label": api.SOURCE_LABELS[key], "ready": key in present, "status": "已就绪" if key in present else "未就绪"} for key in api.SOURCE_TYPES + api.MONTHLY_SUPPORT_SOURCE_TYPES]
		with patch.object(api, "_all_final_source_rows", side_effect=lambda batch: records.get(batch.source_type, [])), patch.object(api, "_pending_attendance_daily_keys", return_value=set()), patch.object(api, "_attendance_row_has_report_dates", return_value=True):
			return api._final_input_quality(inputs, {key: self.batch(key) for key in present})

	def test_attendance_and_housing_allow_lock_and_report_every_missing_source_and_person(self):
		checks = self.quality({"attendance_draft": [self.record(), self.record("E2")], "housing_allowance": [self.record(processed_value={"housing_allowance": 0})]}, {"attendance_draft", "housing_allowance"})
		self.assertTrue(all(item["ready"] for item in checks))
		missing = [item["source_type"] for item in checks if not item["provided"]]
		self.assertEqual(set(missing), {"apple_tree", "missing_card", "full_attendance", "special_hours"})
		housing = next(item for item in checks if item["source_type"] == "housing_allowance")
		self.assertEqual([entry["employee_code"] for entry in housing["missing_items"]], ["E2"])

	def test_missing_attendance_blocks_even_with_housing(self):
		checks = self.quality({"housing_allowance": [self.record()]}, {"housing_allowance"})
		self.assertFalse(checks[0]["ready"])

	def test_every_missing_calendar_date_is_reported_and_blocks_lock(self):
		api = self.api
		inputs = [{"source_type": "attendance_draft", "label": "考勤初稿", "ready": True, "status": "已就绪", "data_quality": {"month_date_coverage": {"missing_dates": ["2099-03-30", "2099-03-31"]}}}]
		with patch.object(api, "_all_final_source_rows", return_value=[self.record()]), patch.object(api, "_pending_attendance_daily_keys", return_value=set()), patch.object(api, "_attendance_row_has_report_dates", return_value=True):
			checks = api._final_input_quality(inputs, {"attendance_draft": self.batch("attendance_draft")})
		self.assertFalse(checks[0]["ready"])
		self.assertEqual([issue["attendance_date"] for issue in checks[0]["issues"]], ["2099-03-30", "2099-03-31"])

	def test_pending_dates_and_import_errors_cannot_be_silently_excluded(self):
		checks = self.quality({"attendance_draft": [self.record(review_status="待审核", daily_pending_exception_lines=[{"attendance_date": "2099-03-01"}, {"attendance_date": "2099-03-02"}])], "housing_allowance": [self.record(exception_codes=["INVALID_AMOUNT"], review_status="已驳回")]}, {"attendance_draft", "housing_allowance"})
		self.assertEqual(len(checks[0]["issues"]), 2)
		self.assertFalse(checks[0]["ready"])
		self.assertFalse(next(item for item in checks if item["source_type"] == "housing_allowance")["ready"])

	def test_nonfinite_negative_and_text_amounts_block(self):
		for value in ("bad", -1, float("nan"), float("inf")):
			with self.subTest(value=value):
				checks = self.quality({"attendance_draft": [self.record()], "housing_allowance": [self.record(processed_value={"housing_allowance": value})]}, {"attendance_draft", "housing_allowance"})
				self.assertFalse(next(item for item in checks if item["source_type"] == "housing_allowance")["ready"])

	def test_generation_gate_runs_before_writing_any_files(self):
		api = self.api
		checks = self.quality({"attendance_draft": [self.record(review_status="待审核")]}, {"attendance_draft"})
		with patch.object(api, "_require_processing_manager"), patch.object(api, "_require_company", side_effect=lambda x: x), patch.object(api, "_require_month", side_effect=lambda x: x), patch.object(api, "get_processing_batch", return_value={"finalization_inputs": checks}), patch.object(api, "_save_monthly_signed_confirmation_file") as save:
			result = api.generate_monthly_final_files("TEST", "2099-03")
			self.assertTrue(result["blocked"])
			save.assert_not_called()

	def test_all_records_are_checked_beyond_first_page(self):
		api = self.api
		with patch.object(api, "_result_rows", side_effect=[[self.record()] * 5000, [self.record("LAST", review_status="待审核")]]) as fetch:
			rows = api._all_final_source_rows(self.batch("attendance_draft"))
		self.assertEqual(len(rows), 5001)
		self.assertEqual(fetch.call_args.kwargs["page_start"], 5000)

	def test_partial_sources_generate_all_three_files_after_approval(self):
		api = self.api
		checks = self.quality({"attendance_draft": [self.record()], "housing_allowance": [self.record(processed_value={"housing_allowance": 200})]}, {"attendance_draft", "housing_allowance"})
		batches = {key: self.batch(key) for key in ("attendance_draft", "housing_allowance")}
		row = {"employee_code": "E1", "employee_name": "E1", "standard_hours": 160, "actual_attendance_hours": 160, "housing_allowance": 200, "full_attendance_award": None}
		from frappe.utils import file_manager
		with patch.object(api, "_require_processing_manager"), patch.object(api, "_require_company", side_effect=lambda x: x), patch.object(api, "_require_month", side_effect=lambda x: x), patch.object(api, "get_processing_batch", return_value={"finalization_inputs": checks}), patch.object(api, "_final_snapshot_batches", return_value=batches), patch.object(api, "_processing_state_hash", return_value="checked"), patch.object(api, "_processing_meta", return_value={}), patch.object(api, "_monthly_final_approval_state", return_value={"approved_for_current_snapshot": True}), patch.object(api, "_attendance_final_excel_config_hash", return_value="config"), patch.object(api, "_monthly_final_rows", return_value=[dict(row)]), patch.object(api, "_monthly_first_signed_rows", return_value=[dict(row)]), patch.object(api, "_monthly_first_signed_daily_rows", return_value=[]), patch.object(api, "_save_batch_notes"), patch.object(api.frappe, "db", types.SimpleNamespace(commit=lambda: None)), patch.object(file_manager, "save_file") as save:
			save.side_effect = lambda name, *_args, **_kwargs: types.SimpleNamespace(file_url="/private/files/" + name, file_name=name)
			result = api.generate_monthly_final_files("TEST", "2099-03")
		self.assertFalse(result["blocked"])
		self.assertEqual(save.call_count, 3)
		self.assertEqual(result["snapshot_version"], result["first_signed_outputs"]["locked_snapshot_version"])
		for call in save.call_args_list:
			book = load_workbook(io.BytesIO(call.args[1]))
			self.assertIn("生成检查清单", book.sheetnames)

	def test_invalid_locked_output_cannot_be_read_by_payroll(self):
		api = self.api
		with patch.object(api, "_require_processing_manager"), patch.object(api, "_require_company", side_effect=lambda x: x), patch.object(api, "_require_month", side_effect=lambda x: x), patch.object(api, "_latest_batch", return_value=self.batch("attendance_draft")), patch.object(api, "get_locked_final_outputs", return_value={"locked_snapshot_version": "v1", "layout_version": api.MONTHLY_FINAL_LAYOUT_VERSION}), patch.object(api, "get_monthly_final_generation_check", return_value={"ready": False, "inputs": [{"issues": [{"message": "错误"}]}]}), patch.object(api, "_monthly_final_rows") as rows:
			result = api.get_monthly_final_preview("TEST", "2099-03", "finance")
		self.assertFalse(result["available"])
		rows.assert_not_called()

	def test_payroll_does_not_insert_missing_amounts_but_keeps_explicit_zero(self):
		path = Path(__file__).parents[1] / "hrms/api/payroll_input.py"
		function = next(node for node in ast.parse(path.read_text()).body if isinstance(node, ast.FunctionDef) and node.name == "sync_locked_attendance_final_to_payroll")
		expected = next(node for node in function.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "expected_attendance_variables" for target in node.targets))
		insert_loop = next(node for node in function.body if isinstance(node, ast.For) and any(isinstance(child, ast.Call) and isinstance(child.func, ast.Name) and child.func.id == "_insert_variable" for child in ast.walk(node)))
		rows = [{"employee_code": "E1", "full_attendance_award": None, "housing_allowance": 0}]
		inserted = []
		ns = {"rows": rows, "_text": lambda value: str(value or ""), "flt": lambda value: float(value or 0), "variable_rows": 0, "batch_name": "batch", "company": "TEST", "payroll_month": "2099-03", "attendance_lock_version": "v1", "_insert_variable": lambda *args, **kwargs: inserted.append(args) or "record"}
		exec(compile(ast.Module(body=[expected, insert_loop], type_ignores=[]), str(path), "exec"), ns)
		self.assertEqual(ns["expected_attendance_variables"], {("E1", "住房补贴"): 0})
		self.assertEqual(len(inserted), 1)
		self.assertEqual(inserted[0][6:8], ("住房补贴", 0))

	def test_xlsx_missing_cells_are_blank_zero_is_preserved_and_checklist_saved(self):
		api = self.api
		row = {"employee_code": "E1", "employee_name": "E1", "standard_hours": 160, "actual_attendance_hours": 160, "housing_allowance": 0, "full_attendance_award": None, "_source_quality": [{"label": "全勤奖", "missing_items": [{"message": "未提供"}], "issues": []}]}
		from frappe.utils import file_manager
		for generator, sheet_name, zero_col, blank_col in ((api._save_monthly_finance_confirmation_file, "财务版", "P", "Q"), (api._save_monthly_signed_confirmation_file, "第二次员工签字版", "BH", "BI")):
			with self.subTest(sheet=sheet_name), patch.object(file_manager, "save_file") as save:
				save.return_value = types.SimpleNamespace(file_url="test", file_name="test.xlsx")
				generator("2099-03", [row])
				book = load_workbook(io.BytesIO(save.call_args.args[1]))
				self.assertEqual(book[sheet_name][zero_col + "5"].value, 0)
				self.assertIsNone(book[sheet_name][blank_col + "5"].value)
				self.assertEqual(book["生成检查清单"]["I2"].value, "未提供")


if __name__ == "__main__":
	unittest.main()
