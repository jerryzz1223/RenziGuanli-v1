from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from datetime import datetime
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "hrms" / "api" / "attendance_processing_center.py"
RESTDAY_CODE = "RESTDAY_CLOCKED_WITHOUT_OVERTIME"
CLOCK_IN_CODE = "CLOCK_IN_MISSING"


def load_processing_center():
	frappe = ModuleType("frappe")
	frappe._ = lambda value: value
	frappe.PermissionError = PermissionError
	frappe.session = SimpleNamespace(user="reviewer@example.com")
	frappe.get_all = lambda *args, **kwargs: []
	frappe.db = SimpleNamespace(count=lambda *args, **kwargs: 0, get_value=lambda *args, **kwargs: None, exists=lambda *args, **kwargs: False)
	frappe.whitelist = lambda function=None, **_kwargs: (lambda decorated: decorated) if function is None else function
	frappe_utils = ModuleType("frappe.utils")
	frappe_utils.cint = lambda value: int(value or 0)
	frappe_utils.flt = lambda value, *_args, **_kwargs: float(value or 0)
	frappe_utils.getdate = lambda value: datetime.fromisoformat(str(value)).date()
	frappe_utils.now_datetime = lambda: None
	hrms = ModuleType("hrms")
	hrms.__path__ = [str(ROOT / "hrms")]
	hrms_api = ModuleType("hrms.api")
	hrms_api.__path__ = [str(ROOT / "hrms" / "api")]
	processors = ModuleType("hrms.api.attendance_processors")
	processors.__path__ = [str(ROOT / "hrms" / "api" / "attendance_processors")]
	fake_modules = {
		"frappe": frappe,
		"frappe.utils": frappe_utils,
		"hrms": hrms,
		"hrms.api": hrms_api,
		"hrms.api.attendance_processors": processors,
	}
	old_modules = {name: sys.modules.get(name) for name in fake_modules}
	sys.modules.update(fake_modules)
	try:
		spec = importlib.util.spec_from_file_location("attendance_daily_resolution_contract", MODULE_PATH)
		module = importlib.util.module_from_spec(spec)
		sys.modules[spec.name] = module
		spec.loader.exec_module(module)
		return module
	finally:
		for name, old_module in old_modules.items():
			if old_module is None:
				sys.modules.pop(name, None)
			else:
				sys.modules[name] = old_module


class AttendanceDailyExceptionResolutionTest(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls.module = load_processing_center()

	def employee_row(self):
		lines = [
			{"attendance_date": "2026-07-04", "source_row": 10, "exception_codes": [RESTDAY_CODE]},
			{"attendance_date": "2026-07-25", "source_row": 20, "exception_codes": [RESTDAY_CODE]},
		]
		return {
			"proposed_value": {
				"exception_lines": lines,
				"exception_events": [
					{"attendance_date": line["attendance_date"], "source_row": line["source_row"], "code": RESTDAY_CODE}
					for line in lines
				],
			},
			"processed_value": {},
			"exception_codes": [RESTDAY_CODE],
			"exception_message": "two unresolved dates",
		}

	def test_resolving_first_date_keeps_second_date_pending(self):
		result = self.module._apply_daily_exception_decisions(
			self.employee_row(),
			{"10": {RESTDAY_CODE: True}},
		)

		self.assertFalse(self.module._has_daily_exception(result, 10, RESTDAY_CODE))
		self.assertTrue(self.module._has_daily_exception(result, 20, RESTDAY_CODE))
		self.assertEqual([line["source_row"] for line in result["proposed_value"]["exception_lines"]], [20])
		self.assertEqual(result["exception_codes"], [RESTDAY_CODE])
		self.assertEqual(self.module._attendance_draft_queue_rollup(result["exception_codes"], "已通过"), "待审核")

	def test_resolving_blocking_date_keeps_nonblocking_sibling_visible(self):
		row = self.employee_row()
		row["proposed_value"]["exception_lines"][0]["exception_codes"] = [CLOCK_IN_CODE]
		row["proposed_value"]["exception_events"][0]["code"] = CLOCK_IN_CODE
		row["exception_codes"] = [CLOCK_IN_CODE, RESTDAY_CODE]

		result = self.module._apply_daily_exception_decisions(
			row,
			{"20": {RESTDAY_CODE: True}},
		)

		self.assertEqual([line["attendance_date"] for line in result["proposed_value"]["exception_lines"]], ["2026-07-04"])
		self.assertEqual(result["exception_codes"], [CLOCK_IN_CODE])
		self.assertEqual(self.module._attendance_draft_queue_rollup(result["exception_codes"], "已通过"), "待审核")

	def test_resolving_both_dates_completes_employee_record(self):
		result = self.module._apply_daily_exception_decisions(
			self.employee_row(),
			{"10": {RESTDAY_CODE: True}, "20": {RESTDAY_CODE: True}},
		)

		self.assertEqual(result["proposed_value"]["exception_lines"], [])
		self.assertEqual(result["proposed_value"]["exception_events"], [])
		self.assertEqual(result["exception_codes"], [])
		self.assertEqual(self.module._attendance_draft_queue_rollup(result["exception_codes"], "已通过"), "已通过")

	def test_manual_adjustment_ledger_only_returns_real_value_changes(self):
		events = [
			{"field_name": "__attendance_policy_recheck__", "old_value": {"hours": 0}, "new_value": {"hours": 8}, "reviewed_on": "2026-09-22T09:00:00"},
			{"field_name": "__source_parser_repair__", "old_value": {"hours": 0}, "new_value": {"hours": 8}, "reviewed_on": "2026-09-22T09:01:00"},
			{"field_name": "__review_decision__", "old_value": {"hours": 8}, "new_value": {"hours": 8}, "reviewed_on": "2026-09-22T09:02:00"},
			{"field_name": "__daily_exception_decision__:10:RESTDAY_CLOCKED_WITHOUT_OVERTIME", "old_value": {"decision": "待处理"}, "new_value": {"decision": "已处理"}, "reviewed_on": "2026-09-22T09:03:00"},
			{"field_name": "special_hours_days:15", "old_value": {"day": 15, "hours": 0}, "new_value": {"day": 15, "hours": 6}, "reviewed_on": "2026-09-22T10:00:00"},
			{"field_name": "__daily_row__:99", "old_value": {"annual_leave_hours": 0}, "new_value": {"annual_leave_hours": 6}, "attendance_date": "2026-07-16", "reviewed_on": "2026-09-22T11:00:00"},
		]
		record = SimpleNamespace(
			name="REC-1", employee_code="2081", employee_name="李旭", source_type="attendance_draft",
			review_history_json=json.dumps(events, ensure_ascii=False),
		)
		with patch.object(self.module, "_require_processing_manager", return_value=None), \
			patch.object(self.module, "_require_company", side_effect=lambda value: value), \
			patch.object(self.module, "_require_month", side_effect=lambda value: value), \
			patch.object(self.module.frappe, "get_all", return_value=[record]):
			result = self.module.list_manual_adjustments("TEST", "2026-07")

		self.assertEqual([item["field_name"] for item in result["items"]], ["__daily_row__:99", "special_hours_days:15"])
		self.assertEqual([item["attendance_date"] for item in result["items"]], ["2026-07-16", "2026-07-15"])

	def test_single_daily_edit_preserves_unedited_sibling_exception_line(self):
		old_line = {"attendance_date": "2026-07-02", "source_row": 11, "exception_codes": ["WORKDAY_OUTSIDE_SHIFT_UNAPPROVED"]}
		rebuilt = {
			"proposed_value": {"exception_lines": [], "exception_events": []},
			"processed_value": {}, "exception_codes": [], "exception_message": "",
		}
		result = self.module._preserve_unedited_daily_exceptions(
			rebuilt,
			{"exception_lines": [old_line]},
			{self.module._daily_line_key({"attendance_date": "2026-07-01", "source_row": 10})},
		)

		self.assertEqual(result["proposed_value"]["exception_lines"], [old_line])
		self.assertIn("WORKDAY_OUTSIDE_SHIFT_UNAPPROVED", result["exception_codes"])
		self.assertEqual(result["proposed_value"]["exception_events"][0]["source_row"], 11)

	def test_single_daily_edit_preserves_restored_historic_exception_lines(self):
		old_line = {"attendance_date": "2026-07-02", "source_row": 11, "exception_codes": [RESTDAY_CODE]}
		rebuilt = {
			"proposed_value": {"exception_lines": [], "exception_events": []},
			"processed_value": {}, "exception_codes": [], "exception_message": "",
		}
		serialized = {
			"processed_value": {}, "proposed_value": {}, "confirmed_value": None,
			"daily_exception_lines": [old_line],
		}
		previous_values = self.module._effective_result_values(serialized)
		if not previous_values.get("exception_lines") and serialized.get("daily_exception_lines"):
			previous_values["exception_lines"] = serialized["daily_exception_lines"]
		result = self.module._preserve_unedited_daily_exceptions(
			rebuilt,
			previous_values,
			{self.module._daily_line_key({"attendance_date": "2026-07-01", "source_row": 10})},
		)

		self.assertEqual(result["proposed_value"]["exception_lines"], [old_line])
		self.assertIn(RESTDAY_CODE, result["exception_codes"])

	def test_save_endpoint_only_changes_selected_card_and_roundtrips_siblings(self):
		m = self.module
		sources = [{
			"姓名": "测试员工", "工号": "E-001", "日期": day, "日期类型": "休息日",
			"实际部门": "工程课", "班次": "休息", "上班时间": "09:00", "下班时间": "12:00",
			"实际出勤（小时）": 0, "休息日加班（小时）": 0,
			"source_file": "A.xlsx", "source_sheet": "每日统计", "source_row": index,
		} for index, day in enumerate(("2026-07-06", "2026-07-13", "2026-07-20"), 10)]
		row = m.process_attendance_draft_rows(sources, attendance_month="2026-07")["processed_rows"][0]
		# Keep this endpoint test about preserving already persisted historic cards.
		# Current policy no longer creates a punch exception on a genuine rest day,
		# so model the legacy cards explicitly instead of asking the new processor to
		# regenerate a rule that has intentionally been retired.
		legacy_lines = [
			{**detail, "restday_clocked_without_overtime": True, "exception_codes": [RESTDAY_CODE]}
			for detail in row["proposed_value"]["attendance_details"]
		]
		legacy_events = [{
			"attendance_date": line["attendance_date"], "source_row": line["source_row"],
			"source_file": line.get("source_file") or "", "source_sheet": line.get("source_sheet") or "",
			"code": RESTDAY_CODE,
		} for line in legacy_lines]
		for values in (row["processed_value"], row["proposed_value"]):
			values["exception_lines"] = json.loads(json.dumps(legacy_lines, ensure_ascii=False))
			values["exception_events"] = json.loads(json.dumps(legacy_events, ensure_ascii=False))
		row["exception_codes"] = [RESTDAY_CODE]
		row["exception_message"] = "historic rest-day review cards"
		row["review_status"] = "待审核"
		row["eligible_for_downstream"] = False
		# A historic month has a reviewed total and sibling data which differ from
		# today's processor. Saving one card must not silently upgrade that month.
		row["proposed_value"]["workday_overtime_hours"] = 123
		row["proposed_value"]["exception_lines"][1]["exception_codes"].append(CLOCK_IN_CODE)
		row["exception_codes"].append(CLOCK_IN_CODE)
		batch = SimpleNamespace(name="B", company="C", attendance_month="2026-07", source_type="attendance_draft", source_file="A.xlsx")
		doc = SimpleNamespace(**m._record_payload(batch, row), name="R")
		doc.as_dict = lambda: {key: value for key, value in vars(doc).items() if not callable(value)}
		doc.save = lambda **kwargs: None
		patches = dict(
			_require_processing_manager=lambda: None, _require_company=lambda value: value,
			_employee_directory=lambda company: [], _attendance_draft_exception_policy=lambda: {},
			_refresh_batch_review_status=lambda batch: "待审核", _export_processed_result=lambda batch: {},
			_invalidate_monthly_final_after_source_change=lambda *args: None, _save_batch_notes=lambda *args: None,
			now_datetime=lambda: datetime(2026, 9, 21),
		)
		with patch.multiple(m, **patches), patch.object(m.frappe, "get_doc", lambda doctype, name: doc if name == "R" else batch, create=True), patch.object(m.frappe.db, "commit", lambda: None, create=True):
			before = m._serialize_record(doc.as_dict())
			result = m.update_attendance_draft_daily_row("C", "2026-07", "R", 10, {"休息日加班（小时）": 3}, reason="补录", source_file="A.xlsx", source_sheet="每日统计", attendance_date="2026-07-06")
			reopened = m._serialize_record(doc.as_dict())
			self.assertEqual([line["attendance_date"] for line in result["daily_exception_lines"]], ["2026-07-06", "2026-07-13", "2026-07-20"])
			self.assertEqual(result["daily_exception_lines"][0]["review_status"], "已处理异常")
			self.assertEqual([line["attendance_date"] for line in result["daily_pending_exception_lines"]], ["2026-07-13", "2026-07-20"])
			self.assertEqual(reopened["daily_exception_lines"], result["daily_exception_lines"])
			self.assertEqual(reopened["review_status"], "待审核")
			values = m._effective_result_values(reopened)
			self.assertEqual(values["workday_overtime_hours"], 123)
			self.assertEqual(values["restday_overtime_hours"], 3)
			self.assertEqual(values["attendance_details"][0:2], before["proposed_value"]["attendance_details"][1:])
			self.assertEqual(reopened["review_history"][-1]["new_value"], {"休息日加班（小时）": 3})
			self.assertEqual(len(reopened["review_history"]), 1)
			# Saving another card keeps the remaining one and both explicit edits.
			result2 = m.update_attendance_draft_daily_row("C", "2026-07", "R", 12, {"休息日加班（小时）": 2}, reason="补录", source_file="A.xlsx", source_sheet="每日统计", attendance_date="2026-07-20")
			self.assertEqual([line["attendance_date"] for line in result2["daily_exception_lines"]], ["2026-07-06", "2026-07-13", "2026-07-20"])
			self.assertEqual([line["attendance_date"] for line in result2["daily_pending_exception_lines"]], ["2026-07-13"])
			self.assertEqual(m._effective_result_values(result2)["restday_overtime_hours"], 5)
			self.assertEqual(len(result2["review_history"]), 2)
			# A decision-only card also must not run a month-wide recalculation.
			with patch.object(m, "process_attendance_draft_rows", side_effect=AssertionError("unexpected month rebuild")):
				result3 = m.review_attendance_draft_daily_exception("C", "2026-07", "R", 11, RESTDAY_CODE, reason="核对不计加班", source_file="A.xlsx", source_sheet="每日统计", attendance_date="2026-07-13")
			pending_result3 = next(line for line in result3["daily_pending_exception_lines"] if line["attendance_date"] == "2026-07-13")
			self.assertEqual(pending_result3["exception_codes"], [CLOCK_IN_CODE])
			self.assertEqual(m._effective_result_values(result3)["restday_overtime_hours"], 5)
			self.assertEqual(m._effective_result_values(result3)["workday_overtime_hours"], 123)

	def test_queue_focus_returns_employee_page_without_changing_filter(self):
		m = self.module
		rows = [{"name": f"R{index}", "import_batch": "B", "employee_code": f"{index:04}",
			"employee_name": f"员工{index}", "department": "生产课" if index % 2 else "工程课",
			"source_type": "attendance_draft", "daily_exception_lines": [{"source_row": index, "exception_codes": ["LATE_MARKED" if index % 2 else RESTDAY_CODE]}],
			"exception_codes": [RESTDAY_CODE]} for index in range(25)]
		rows[1]["daily_exception_lines"].append({"source_row": 101, "exception_codes": ["WORKDAY_OUTSIDE_SHIFT_UNAPPROVED"]})
		serialize_calls = []
		def serialize(row, *_args, hydrate_daily_details=True, **_kwargs):
			serialize_calls.append(hydrate_daily_details)
			result = dict(row)
			result["record_id"] = result.pop("name", result.get("record_id", ""))
			return result
		def get_all(*_args, **kwargs):
			filters = kwargs.get("filters") or {}
			name_filter = filters.get("name")
			if isinstance(name_filter, list) and name_filter[:1] == ["in"]:
				requested = set(name_filter[1])
				return [row for row in rows if row["name"] in requested]
			return rows
		with patch.multiple(m, _require_processing_manager=lambda: None, _require_company=lambda value: value,
			_latest_batch=lambda *args: SimpleNamespace(name="B"), _serialize_record=serialize), patch.object(m.frappe, "get_all", side_effect=get_all):
			result = m.list_processing_exceptions("C", "2026-07", page_length=20, focus_record_id="R24")
			self.assertEqual(result["page_start"], 20)
			self.assertIn("R24", [row["record_id"] for row in result["review_rows"]])
			self.assertEqual(result["filtered_pending_count"], 26)
			self.assertEqual(result["filtered_exception_count"], 26)
			self.assertEqual(result["filtered_parent_count"], 25)
			self.assertEqual(serialize_calls.count(False), 25)
			self.assertEqual(serialize_calls.count(True), 5)
			filtered = m.list_processing_exceptions("C", "2026-07", employee_code="0001", focus_record_id="R24")
			self.assertEqual([row["record_id"] for row in filtered["review_rows"]], ["R1"])
			late = m.list_processing_exceptions("C", "2026-07", department="生产", exception_code="LATE_MARKED")
			self.assertEqual(late["filtered_exception_count"], 12)
			self.assertEqual(late["available_departments"], ["工程课", "生产课"])
			self.assertTrue(all(len(row["daily_exception_lines"]) == 1 and row["daily_exception_lines"][0]["exception_codes"] == ["LATE_MARKED"] for row in late["review_rows"]))

	def test_same_row_number_in_two_sources_resolves_only_exact_exception(self):
		lines = [
			{"attendance_date": "2026-07-04", "source_file": "A.xlsx", "source_sheet": "每日统计", "source_row": 10, "exception_codes": [RESTDAY_CODE]},
			{"attendance_date": "2026-07-05", "source_file": "B.xlsx", "source_sheet": "每日明细", "source_row": 10, "exception_codes": [RESTDAY_CODE]},
		]
		row = {
			"proposed_value": {"exception_lines": lines, "exception_events": [
				{**{key: line[key] for key in ("attendance_date", "source_file", "source_sheet", "source_row")}, "code": RESTDAY_CODE}
				for line in lines
			]},
			"processed_value": {}, "exception_codes": [RESTDAY_CODE], "exception_message": "two sources",
		}
		first_key = self.module._daily_line_key(lines[0])

		result = self.module._apply_daily_exception_decisions(row, {first_key: {RESTDAY_CODE: True}})

		self.assertEqual(len(result["proposed_value"]["exception_lines"]), 1)
		self.assertEqual(result["proposed_value"]["exception_lines"][0]["source_file"], "B.xlsx")
		self.assertTrue(self.module._has_daily_exception(
			result, 10, RESTDAY_CODE, source_file="B.xlsx", source_sheet="每日明细", attendance_date="2026-07-05",
		))

	def test_late_editor_keeps_only_focused_fields_and_shows_leave_with_late(self):
		source = {
			"日期": "2026-07-03", "日期类型": "工作日", "班次": "白班 08:00-17:00",
			"上班时间": "08:30", "下班时间": "17:00", "迟到次数": 1, "标准工时": 8,
			"实际出勤（小时）": 7.5, "请假/事假(小时)": 0, "病假(小时)": 0,
			"特休(小时)": 0, "排休(小时)": 0, "source_file": "A.xlsx",
			"source_sheet": "每日统计", "source_row": 10,
		}
		detail = {
			"attendance_date": "2026-07-03", "source_file": "A.xlsx", "source_sheet": "每日统计",
			"source_row": 10, "personal_leave_hours": 0.5, "late_minutes": 30,
		}
		row = {
			"original_value": {"rows": [source]}, "processed_value": {},
			"proposed_value": {"attendance_details": [detail], "exception_lines": [
				{**detail, "exception_codes": [CLOCK_IN_CODE, "LATE_MARKED"]},
			]},
			"confirmed_value": None, "exception_codes": [CLOCK_IN_CODE, "LATE_MARKED"],
		}

		payload = self.module._daily_row_editor_payload(row)[0]
		late_fields = [field for field in payload["editable_fields"] if field["late_editor"]]

		self.assertEqual(payload["exception_codes"], [CLOCK_IN_CODE, "LATE_MARKED"])
		self.assertEqual(len(late_fields), 11)
		self.assertEqual(
			[field["label"] for field in late_fields],
			["工作类型", "班次", "上班打卡", "下班打卡", "迟到次数", "标准工时", "实际工时（小时）", "事假（含迟到，小时）", "病假（小时）", "特休（小时）", "排休（小时）"],
		)
		self.assertEqual(next(field["value"] for field in late_fields if field["default_name"] == "请假/事假(小时)"), 0.5)

	def test_exception_queue_sort_accepts_mixed_review_timestamp_types(self):
		rows = [
			{"record_id": "pending-day", "exception_codes": [RESTDAY_CODE], "reviewed_on": ""},
			{"record_id": "reviewed-day", "exception_codes": [RESTDAY_CODE], "reviewed_on": datetime(2026, 7, 4, 10, 0)},
		]
		ordered = sorted(rows, key=self.module._processing_exception_sort_key)

		self.assertEqual([row["record_id"] for row in ordered], ["pending-day", "reviewed-day"])

	def test_lightweight_queue_serialization_skips_daily_detail_replay(self):
		record = {
			"name": "R", "company": "C", "source_type": "attendance_draft",
			"processed_value_json": "{}", "original_value_json": "{}",
			"proposed_value_json": json.dumps({"exception_lines": [{
				"attendance_date": "2026-07-03", "source_row": 10,
				"exception_codes": ["LATE_MARKED"],
			}]}),
			"confirmed_value_json": "null", "exception_codes": json.dumps(["LATE_MARKED"]),
			"review_history_json": "[]", "department": "", "exception_message": "",
		}
		with patch.object(self.module, "_restore_daily_exception_lines_from_source", side_effect=AssertionError("unexpected detail replay")):
			result = self.module._serialize_record(record, "rules-v1", hydrate_daily_details=False)
		self.assertEqual(result["daily_exception_lines"][0]["attendance_date"], "2026-07-03")
		self.assertNotIn("standard_hours", result["daily_exception_lines"][0])

	def test_lightweight_queue_without_persisted_lines_does_not_replay_source(self):
		record = {
			"name": "R", "company": "C", "source_type": "attendance_draft",
			"proposed_value_json": "{}", "confirmed_value_json": "",
			"exception_codes": json.dumps(["LATE_MARKED"]), "department": "", "exception_message": "",
		}
		with patch.object(self.module, "_restore_daily_exception_lines_from_source", side_effect=AssertionError("unexpected detail replay")):
			result = self.module._serialize_record(record, "rules-v1", hydrate_daily_details=False)
		self.assertEqual(result["daily_exception_lines"], [])

	def test_exception_snapshot_page_reads_only_requested_twenty_records(self):
		m = self.module
		rows = [{
			"name": f"R{index}", "import_batch": "B", "source_type": "attendance_draft",
			"daily_exception_lines": [{"source_row": index, "exception_codes": [RESTDAY_CODE]}],
			"exception_codes": [RESTDAY_CODE],
		} for index in range(114)]
		requested_ids = [f"R{index}" for index in range(60, 80)]
		serialize_calls = []
		def serialize(row, *_args, **_kwargs):
			serialize_calls.append(row["name"])
			result = dict(row)
			result["record_id"] = result.pop("name")
			return result
		def get_all(*_args, **kwargs):
			ids = set(kwargs["filters"]["name"][1])
			return [row for row in rows if row["name"] in ids]
		with patch.multiple(
			m, _require_processing_manager=lambda: None, _require_company=lambda value: value,
			_latest_batch=lambda *args: SimpleNamespace(name="B"),
			_attendance_shift_rule_bundle=lambda *_args: {"version": "rules-v1"}, _serialize_record=serialize,
		), patch.object(m.frappe, "get_all", side_effect=get_all) as get_all_mock:
			result = m.list_processing_exceptions(
				"C", "2026-07", page_length=20, page_start=60,
				snapshot_record_ids=json.dumps(requested_ids),
			)
		self.assertTrue(result["snapshot_reused"])
		self.assertEqual([row["record_id"] for row in result["review_rows"]], requested_ids)
		self.assertEqual(serialize_calls, requested_ids)
		self.assertEqual(get_all_mock.call_count, 1)

	def test_batch_notes_reload_latest_version_before_save(self):
		class VersionedBatch:
			def __init__(self):
				self.notes = json.dumps({"attendance_processing_center": {"stale": True}})
				self.reload_calls = 0
				self.save_calls = 0

			def reload(self):
				self.reload_calls += 1
				self.notes = json.dumps({"attendance_processing_center": {"concurrent": True}})

			def save(self, **_kwargs):
				self.save_calls += 1

		batch = VersionedBatch()
		self.module._save_batch_notes(batch, {"processed_result_refresh_reason": "daily_source_row_manual_update"})

		self.assertEqual(batch.reload_calls, 1)
		self.assertEqual(batch.save_calls, 1)
		notes = json.loads(batch.notes)["attendance_processing_center"]
		self.assertTrue(notes["concurrent"])
		self.assertEqual(notes["processed_result_refresh_reason"], "daily_source_row_manual_update")
		self.assertNotIn("stale", notes)

	def test_overtime_reference_time_is_audit_only_and_normalized(self):
		self.assertEqual(self.module._normalize_overtime_reference_time("7:59:00"), "07:59")
		self.assertEqual(self.module._normalize_overtime_reference_time("15:08"), "15:08")
		self.assertEqual(self.module._normalize_overtime_reference_time("24:00"), "")
		self.assertEqual(self.module._normalize_overtime_reference_time(""), "")


if __name__ == "__main__":
	unittest.main()
