from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from datetime import datetime
from pathlib import Path
from types import ModuleType, SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "hrms" / "api" / "attendance_processing_center.py"
RESTDAY_CODE = "RESTDAY_CLOCKED_WITHOUT_OVERTIME"


def load_processing_center():
	frappe = ModuleType("frappe")
	frappe._ = lambda value: value
	frappe.PermissionError = PermissionError
	frappe.session = SimpleNamespace(user="reviewer@example.com")
	frappe.get_all = lambda *args, **kwargs: []
	frappe.db = SimpleNamespace(count=lambda *args, **kwargs: 0, get_value=lambda *args, **kwargs: None)
	frappe.whitelist = lambda function=None, **_kwargs: (lambda decorated: decorated) if function is None else function
	frappe_utils = ModuleType("frappe.utils")
	frappe_utils.cint = lambda value: int(value or 0)
	frappe_utils.flt = lambda value, *_args, **_kwargs: float(value or 0)
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
		self.assertEqual(self.module._attendance_draft_review_status(result["exception_codes"], "已通过"), "待审核")

	def test_resolving_both_dates_completes_employee_record(self):
		result = self.module._apply_daily_exception_decisions(
			self.employee_row(),
			{"10": {RESTDAY_CODE: True}, "20": {RESTDAY_CODE: True}},
		)

		self.assertEqual(result["proposed_value"]["exception_lines"], [])
		self.assertEqual(result["proposed_value"]["exception_events"], [])
		self.assertEqual(result["exception_codes"], [])
		self.assertEqual(self.module._attendance_draft_review_status(result["exception_codes"], "已通过"), "已通过")

	def test_exception_queue_sort_accepts_mixed_review_timestamp_types(self):
		rows = [
			{"record_id": "pending-day", "exception_codes": [RESTDAY_CODE], "reviewed_on": ""},
			{"record_id": "reviewed-day", "exception_codes": [RESTDAY_CODE], "reviewed_on": datetime(2026, 7, 4, 10, 0)},
		]
		ordered = sorted(rows, key=self.module._processing_exception_sort_key)

		self.assertEqual([row["record_id"] for row in ordered], ["pending-day", "reviewed-day"])

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


if __name__ == "__main__":
	unittest.main()
