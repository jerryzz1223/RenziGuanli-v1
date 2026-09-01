"""Static contracts for the attendance/payroll manual-change ledgers.

These checks deliberately avoid a site database so the two audit modules stay
visible in normal source-tree regression runs.
"""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAYROLL_API = ROOT / "hrms/api/payroll_input.py"
ATTENDANCE_API = ROOT / "hrms/api/attendance_processing_center.py"
PAYROLL_PAGE = ROOT / "hrms/hr/page/payroll_input_center/payroll_input_center.js"
ATTENDANCE_PAGE = ROOT / "hrms/hr/page/attendance_import_center/attendance_import_center.js"
HOME_NAV = ROOT / "hrms/public/js/hrms_home_redirect_v6.js"
PAYROLL_DOCTYPE = ROOT / "hrms/hr/doctype/hrms_payroll_manual_adjustment/hrms_payroll_manual_adjustment.json"


class TestManualAdjustmentModules(unittest.TestCase):
	def test_payroll_audit_doctype_is_read_only_and_categorised(self):
		definition = json.loads(PAYROLL_DOCTYPE.read_text())
		self.assertEqual(definition["name"], "HRMS Payroll Manual Adjustment")
		self.assertEqual(definition["sort_field"], "creation")
		categories = next(field for field in definition["fields"] if field["fieldname"] == "change_category")["options"]
		for category in ("员工定薪", "月度增减项", "人员范围", "福利扣款来源", "薪资规则", "考勤计薪规则", "薪资公式"):
			self.assertIn(category, categories)
		self.assertTrue(all(not permission.get("write") and not permission.get("create") for permission in definition["permissions"]))

	def test_api_records_core_manual_payroll_changes(self):
		content = PAYROLL_API.read_text()
		for marker in (
			"def _record_payroll_manual_adjustment(",
			"def list_payroll_manual_adjustments(",
			'change_category="员工定薪"',
			'change_category="月度增减项"',
			'change_category="人员范围"',
			'change_category="福利扣款来源"',
			'change_category="考勤计薪规则"',
			'change_category="薪资公式"',
		):
			self.assertIn(marker, content)

	def test_workbenches_keep_attendance_and_payroll_ledgers_separate(self):
		self.assertIn("考勤修改记录", ATTENDANCE_PAGE.read_text())
		self.assertIn("list_attendance_manual_adjustments", ATTENDANCE_PAGE.read_text())
		self.assertIn("def list_attendance_manual_adjustments(", ATTENDANCE_API.read_text())
		payroll = PAYROLL_PAGE.read_text()
		self.assertIn("薪酬修改记录", payroll)
		self.assertIn("load_payroll_manual_adjustments", payroll)
		self.assertIn("list_payroll_manual_adjustments", payroll)
		navigation = HOME_NAV.read_text()
		self.assertIn("考勤修改记录", navigation)
		self.assertIn("payroll-input-center/payroll-adjustments", navigation)


if __name__ == "__main__":
	unittest.main()
