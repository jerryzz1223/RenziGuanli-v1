import importlib.util
import sys
import types
import unittest
from datetime import date, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_module():
	frappe = types.ModuleType("frappe")
	frappe._ = lambda value: value
	frappe.whitelist = lambda **_kwargs: (lambda function: function)
	frappe.db = types.SimpleNamespace(exists=lambda *_args, **_kwargs: None)
	frappe.get_all = lambda *_args, **_kwargs: []
	frappe.get_doc = lambda *_args, **_kwargs: None
	utils = types.ModuleType("frappe.utils")
	utils.flt = lambda value: float(value or 0)
	utils.getdate = lambda value: value if isinstance(value, date) else date.fromisoformat(str(value)[:10])
	utils.now_datetime = datetime.now
	hrms = types.ModuleType("hrms")
	api = types.ModuleType("hrms.api")
	attendance = types.ModuleType("hrms.api.attendance_import")
	api.attendance_import = attendance
	saved = {name: sys.modules.get(name) for name in ("frappe", "frappe.utils", "hrms", "hrms.api", "hrms.api.attendance_import")}
	sys.modules["frappe"] = frappe
	sys.modules["frappe.utils"] = utils
	sys.modules["hrms"] = hrms
	sys.modules["hrms.api"] = api
	sys.modules["hrms.api.attendance_import"] = attendance
	try:
		spec = importlib.util.spec_from_file_location(
			"dingtalk_attendance_sync_under_test", ROOT / "hrms/api/dingtalk_attendance_sync.py"
		)
		module = importlib.util.module_from_spec(spec)
		spec.loader.exec_module(module)
		return module
	finally:
		for name, value in saved.items():
			if value is None:
				sys.modules.pop(name, None)
			else:
				sys.modules[name] = value


def event(check_type, planned, actual, result="Normal", **extra):
	return {
		"userId": "ding-001",
		"jobNumber": "YX-001",
		"name": "张三",
		"className": "平日白班",
		"checkType": check_type,
		"baseCheckTime": planned,
		"userCheckTime": actual,
		"timeResult": result,
		**extra,
	}


class DingTalkAttendanceFactTests(unittest.TestCase):
	def setUp(self):
		self.module = load_module()
		self.module._mapping = lambda _company, _userid: types.SimpleNamespace(
			employee_code="YX-001", employee_name="张三", department_name="制造部"
		)
		self.module._approval_evidence = lambda _company, _userid, _day: []

	def draft(self, in_actual="2026-09-20 08:00:00", out_actual="2026-09-20 17:00:00"):
		return self.module._draft_row(
			"永鑫公司",
			date(2026, 9, 20),
			"ding-001",
			[
				event("OnDuty", "2026-09-20 08:00:00", in_actual),
				event("OffDuty", "2026-09-20 17:00:00", out_actual),
			],
		)

	def test_normal_workday_keeps_company_code_and_schedule(self):
		row = self.draft()
		self.assertEqual(row["工号"], "YX-001")
		self.assertEqual((row["应上班时间"], row["应下班时间"]), ("08:00", "17:00"))
		self.assertEqual(row["班次外打卡状态"], "")

	def test_early_and_late_punches_are_candidates_not_payroll_overtime(self):
		row = self.draft("2026-09-20 07:45:00", "2026-09-20 17:31:00")
		self.assertEqual((row["早到分钟"], row["晚走分钟"]), (15, 31))
		self.assertEqual(row["班次外打卡状态"], "无申请的班次外打卡/候选加班")
		self.assertEqual(row["无申请的班次外打卡"], 1)
		self.assertEqual(row["工作日加班(小时)"], 0)

	def test_overtime_approval_passed_pending_and_rejected_remain_distinct(self):
		for status, result, expected in (
			("COMPLETED", "agree", "有已通过加班审批的班次外打卡（待HRMS核定）"),
			("RUNNING", "", "加班审批待审的班次外打卡/候选加班"),
			("COMPLETED", "refuse", "加班审批已驳回的班次外打卡/候选加班"),
		):
			with self.subTest(status=status, result=result):
				self.module._approval_evidence = lambda *_args, status=status, result=result: [
					{"approval_no": "APP-1", "approval_type": "加班", "approval_status": status, "approval_result": result}
				]
				self.assertEqual(self.draft(out_actual="2026-09-20 18:00:00")["班次外打卡状态"], expected)

	def test_late_boundaries_are_preserved_as_minutes(self):
		for minutes in (1, 29, 30, 31):
			with self.subTest(minutes=minutes):
				row = self.draft(in_actual=f"2026-09-20 08:{minutes:02d}:00")
				self.assertEqual(row["迟到分钟"], minutes)
				self.assertEqual(row["迟到次数"], 1)

	def test_cross_midnight_shift_stays_on_requested_business_date(self):
		row = self.module._draft_row(
			"永鑫公司",
			date(2026, 9, 20),
			"ding-001",
			[
				event("OnDuty", "2026-09-20 20:00:00", "2026-09-20 19:55:00"),
				event("OffDuty", "2026-09-21 08:00:00", "2026-09-21 08:15:00"),
			],
		)
		self.assertEqual(row["日期"], "2026-09-20")
		self.assertEqual((row["上班时间"], row["下班时间"]), ("19:55", "08:15"))
		self.assertEqual(row["晚走分钟"], 15)

	def test_multiple_approvals_keep_type_number_and_status(self):
		self.module._approval_evidence = lambda *_args: [
			{"approval_no": "OT-1", "approval_type": "加班", "approval_status": "COMPLETED", "approval_result": "agree"},
			{"approval_no": "LEAVE-1", "approval_type": "请假", "approval_status": "RUNNING", "approval_result": ""},
			{"approval_no": "FIX-1", "approval_type": "补卡", "approval_status": "COMPLETED", "approval_result": "refuse"},
		]
		row = self.draft(out_actual="2026-09-20 18:00:00")
		self.assertEqual(len(row["关联审批明细"]), 3)
		self.assertIn("加班[OT-1]:COMPLETED/agree", row["关联审批单"])
		self.assertIn("请假[LEAVE-1]:RUNNING", row["关联审批单"])

	def test_overtime_approval_form_times_are_preserved_in_linked_content(self):
		body = {
			"form_component_values": [
				{"name": "加班开始时间", "value": "2026-09-20 17:00"},
				{"name": "加班结束时间", "value": "2026-09-20 18:00"},
			]
		}
		self.assertEqual(
			self.module._approval_time_content(body),
			"2026-09-20 17:00到2026-09-20 18:00",
		)
		self.module._approval_evidence = lambda *_args: [{
			"approval_no": "OT-TIME-1", "approval_type": "加班",
			"approval_status": "COMPLETED", "approval_result": "agree",
			"approval_content": "2026-09-20 17:00到2026-09-20 18:00",
		}]
		row = self.draft(out_actual="2026-09-20 18:29:00")
		self.assertIn("2026-09-20 17:00到2026-09-20 18:00", row["关联审批单"])
		self.assertEqual(row["关联审批明细"][0]["approval_content"], "2026-09-20 17:00到2026-09-20 18:00")

	def test_resync_diff_separates_created_changed_removed_and_unchanged(self):
		previous = [
			{"employee_code": "YX-001", "shift_name": "白班", "actual_in_time": "08:00"},
			{"employee_code": "YX-002", "shift_name": "白班", "actual_in_time": "08:00"},
			{"employee_code": "YX-003", "shift_name": "白班", "actual_in_time": "08:00"},
		]
		current = [
			{"employee_code": "YX-001", "shift_name": "白班", "actual_in_time": "08:00"},
			{"employee_code": "YX-002", "shift_name": "中班", "actual_in_time": "12:00"},
			{"employee_code": "YX-004", "shift_name": "白班", "actual_in_time": "08:00"},
		]

		diff = self.module._compare_daily_check_versions(previous, current)

		self.assertEqual(diff["created"], ["YX-004"])
		self.assertEqual(diff["changed"], ["YX-002"])
		self.assertEqual(diff["removed"], ["YX-003"])
		self.assertEqual(diff["unchanged"], ["YX-001"])
		self.assertEqual(diff["affected"], ["YX-002", "YX-003", "YX-004"])

	def test_resync_restores_review_only_for_unchanged_employee_exception(self):
		previous = [
			{
				"employee_code": "YX-001", "exception_type": "迟到", "confirmation_status": "已确认",
				"handling_method": "按事假处理", "remarks": "已核对钉钉审批",
			},
			{"employee_code": "YX-002", "exception_type": "缺卡", "confirmation_status": "已确认"},
		]
		current = [
			{"name": "EX-001", "employee_code": "YX-001", "exception_type": "迟到"},
			{"name": "EX-002", "employee_code": "YX-002", "exception_type": "缺卡"},
		]
		writes = []
		self.module.frappe.get_all = lambda *_args, **_kwargs: current
		self.module.frappe.db.set_value = lambda *args, **kwargs: writes.append((args, kwargs))

		restored = self.module._restore_unchanged_exception_reviews("BATCH-1", previous, ["YX-001"])

		self.assertEqual(restored, 1)
		self.assertEqual(writes[0][0][1], "EX-001")
		self.assertEqual(writes[0][0][2]["confirmation_status"], "已确认")
		self.assertEqual(writes[0][0][2]["handling_method"], "按事假处理")


if __name__ == "__main__":
	unittest.main()
