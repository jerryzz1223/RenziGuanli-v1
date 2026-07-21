"""Repeatable non-network acceptance test for the DingTalk daily-draft bridge."""

from __future__ import annotations

import json

import frappe

from hrms.api.dingtalk_attendance_sync import convert_dingtalk_raw_attendance_to_daily_checks


TEST_COMPANY = "TEST-HRMS"
TEST_DATE = "2099-12-03"
TEST_USER_ID = "TEST-DT-ATTENDANCE-20991203"
RAW_DOCTYPE = "HRMS DingTalk Raw Record"
USER_MAP_DOCTYPE = "HRMS DingTalk User Map"
DAY_CHECK_DOCTYPE = "HRMS Attendance Day Check"
BATCH_DOCTYPE = "HRMS Attendance Import Batch"
PROTECTED_COMPANIES = ("永新", "1")


def _protected_snapshot():
	return {
		company: {
			"employee_count": frappe.db.count("Employee", {"company": company}),
			"latest_modified": str(frappe.db.get_value("Employee", {"company": company}, "modified", order_by="modified desc") or ""),
		}
		for company in PROTECTED_COMPANIES
	}


@frappe.whitelist()
def run_dingtalk_daily_sync_acceptance() -> dict:
	"""Create only TEST-HRMS evidence and verify an idempotent conversion."""
	if not frappe.db.exists("Company", TEST_COMPANY):
		frappe.throw("TEST-HRMS company is required before running DingTalk sync acceptance.")
	employee = frappe.db.get_value("Employee", {"company": TEST_COMPANY, "status": "Active"}, ["name", "employee_name", "department"], as_dict=True)
	if not employee:
		frappe.throw("TEST-HRMS needs one active employee before running DingTalk sync acceptance.")
	protected_before = _protected_snapshot()

	map_name = frappe.db.exists(USER_MAP_DOCTYPE, {"company": TEST_COMPANY, "dingtalk_userid": TEST_USER_ID})
	user_map = frappe.get_doc(USER_MAP_DOCTYPE, map_name) if map_name else frappe.new_doc(USER_MAP_DOCTYPE)
	user_map.update(
		{
			"company": TEST_COMPANY,
			"dingtalk_userid": TEST_USER_ID,
			"employee": employee.name,
			"employee_code": employee.name,
			"employee_name": employee.employee_name,
			"department_name": employee.department,
			"sync_status": "已同步",
		}
	)
	user_map.save(ignore_permissions=True)

	payload = {
		"result": {
			"records": [
				{"userId": TEST_USER_ID, "workDate": TEST_DATE, "checkType": "OnDuty", "userCheckTime": f"{TEST_DATE} 08:00:00", "timeResult": "Normal", "standardHours": 8, "groupName": "TEST 班组"},
				{"userId": TEST_USER_ID, "workDate": TEST_DATE, "checkType": "OffDuty", "userCheckTime": f"{TEST_DATE} 17:00:00", "timeResult": "Normal", "standardHours": 8, "groupName": "TEST 班组"},
			]
		}
	}
	raw_name = frappe.db.exists(RAW_DOCTYPE, {"company": TEST_COMPANY, "source_type": "attendance", "external_id": f"{TEST_USER_ID}:{TEST_DATE}"})
	raw = frappe.get_doc(RAW_DOCTYPE, raw_name) if raw_name else frappe.new_doc(RAW_DOCTYPE)
	raw.update(
		{
			"company": TEST_COMPANY,
			"source_type": "attendance",
			"external_id": f"{TEST_USER_ID}:{TEST_DATE}",
			"dingtalk_userid": TEST_USER_ID,
			"business_date": TEST_DATE,
			"payload_json": json.dumps(payload, ensure_ascii=False),
			"sync_status": "已接收",
		}
	)
	raw.save(ignore_permissions=True)

	first = convert_dingtalk_raw_attendance_to_daily_checks(TEST_COMPANY, TEST_DATE, enforce_role=False)
	second = convert_dingtalk_raw_attendance_to_daily_checks(TEST_COMPANY, TEST_DATE, enforce_role=False)
	batch = frappe.get_doc(BATCH_DOCTYPE, second["batch"])
	day_checks = frappe.get_all(DAY_CHECK_DOCTYPE, filters={"import_batch": batch.name, "source_kind": "钉钉API同步"}, fields=["employee", "actual_in_time", "actual_out_time"])
	if len(day_checks) != 1 or day_checks[0].employee != employee.name:
		frappe.throw("DingTalk daily draft conversion did not produce one mapped test employee row.")
	if day_checks[0].actual_in_time != "08:00" or day_checks[0].actual_out_time != "17:00":
		frappe.throw("DingTalk daily draft conversion did not preserve clock times.")
	if _protected_snapshot() != protected_before:
		frappe.throw("DingTalk acceptance must not change protected company employees.")
	return {"first": first, "second": second, "batch": batch.name, "day_checks": len(day_checks), "protected": protected_before}
