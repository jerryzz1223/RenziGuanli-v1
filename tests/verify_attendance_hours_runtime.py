"""Read-only verification of current Frappe attendance data and recheck preview.

Run from frappe-bench with its environment Python:
  python /workspace/tests/verify_attendance_hours_runtime.py hrms.localhost 永新 2026-07
Never calls execute=1, saves documents, or generates files.
"""
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import frappe


def main():
	from hrms.api import attendance_import as legacy
	from hrms.api import attendance_processing_center as api

	sites = Path("sites").absolute()
	os.chdir(sites)
	frappe.init(site=sys.argv[1], sites_path=str(sites))
	frappe.connect()
	frappe.set_user("Administrator")
	company, month = sys.argv[2:4]
	try:
		for actual, personal, sick, reunion, rest, absence, mismatch in (
			(1, 1, 2, 1, 1, 3, False), (7, 0, 0, 0, 0, 0, True), (9, 0, 0, 0, 0, 0, True),
		):
			day = SimpleNamespace(attendance_date="2026-09-18", standard_hours=8, actual_attendance_hours=actual, personal_leave_hours=personal, sick_leave_hours=sick, reunion_leave_hours=reunion, rest_leave_hours=rest, absent_hours=absence)
			assert legacy._day_check_hours_policy(day)["hours_mismatch"] == mismatch
		weekend = SimpleNamespace(attendance_date="2026-09-19", standard_hours=8, actual_attendance_hours=8, sick_leave_hours=8, rest_leave_hours=8, absent_hours=0, late_count=1, early_count=1, missing_in=0, missing_out=0)
		legacy._apply_day_check_hours_policy(weekend)
		assert (weekend.sick_leave_hours, weekend.rest_leave_hours, weekend.late_count, weekend.early_count) == (0, 0, 0, 0)
		preview = api.recheck_attendance_policy(company, month)
		with patch.object(frappe.db, "commit", side_effect=AssertionError("preview must not commit")):
			assert api.recheck_attendance_policy(company, month)["preview_token"] == preview["preview_token"]
		print(json.dumps({"site": sys.argv[1], "month": month, "previewed_employees": preview["changed_count"], "preserved_manual_rows": len(preview["skipped"]), "employees_with_hours_mismatch": sum("ATTENDANCE_HOURS_MISMATCH" in item["exception_codes"] for item in preview["preview"]), "read_only_preview_verified": True, "business_data_written": False}, ensure_ascii=False))
	finally:
		frappe.db.rollback()
		frappe.destroy()


if __name__ == "__main__":
	main()
