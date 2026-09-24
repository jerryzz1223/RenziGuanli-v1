# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# See license.txt

import json
from io import BytesIO

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, get_datetime, now_datetime
from openpyxl import Workbook

from hrms.api.employee_field_template import _get_employee_training_history
from hrms.api.training_learning import (
	create_training_activity,
	create_training_course,
	find_training_employees,
	get_training_activity_roster,
	_training_roster_rows,
	record_training_completion,
	save_training_activity_roster,
)


class TestTrainingLearningWorkflow(IntegrationTestCase):
	def test_basic_roster_template_rows_allow_blank_hours_and_scores(self):
		workbook = Workbook()
		worksheet = workbook.active
		worksheet.title = "参训名单"
		worksheet.append(["公司工号", "姓名", "学时", "成绩", "出席状态", "等级/结果", "是否补训", "备注"])
		worksheet.append(["3977", "谢之鹏", None, None, "出席", None, "否", None])
		output = BytesIO()
		workbook.save(output)
		rows = _training_roster_rows(output.getvalue())
		self.assertEqual(rows[0]["公司工号"], "3977")
		self.assertIsNone(rows[0]["学时"])
		self.assertIsNone(rows[0]["成绩"])

	def test_course_to_employee_archive(self):
		suffix = frappe.generate_hash(length=8)
		company = "_Test Company"
		employee_name = frappe.db.get_value("Employee", {"company": company, "status": "Active"}, "name")
		employee_code = f"TRN-{suffix.upper()}"
		if employee_name:
			frappe.db.set_value("Employee", employee_name, "custom_employee_code", employee_code)
		else:
			employee_name = frappe.get_doc(
				{
					"doctype": "Employee", "first_name": f"培训测试{suffix}", "gender": "Male",
					"date_of_birth": "1990-01-01", "date_of_joining": "2020-01-01",
					"company": company, "status": "Active", "custom_employee_code": employee_code,
				}
			).insert().name

		course = create_training_course(
			json.dumps(
				{
					"company": company,
					"course_name": f"培训闭环测试 {suffix}",
					"plan_period": "2026",
					"planned_month": "2026-10",
					"planned_hours": 2,
					"training_category": "内部培训",
					"training_mode": "内部",
					"objective": "验证计划、上课、结果和员工档案链路",
				}
			)
		)
		start_time = get_datetime(add_days(now_datetime(), 1)).replace(hour=9, minute=0, second=0)
		activity = create_training_activity(
			json.dumps(
				{
					"company": company,
					"training_program": course["name"],
					"start_time": str(start_time),
					"end_time": str(start_time.replace(hour=11)),
					"location": "测试培训室",
					"assessment_required": 1,
					"passing_score": 60,
					"participants": [],
				}
			)
		)
		matches = find_training_employees("_Test Company", employee_code)
		self.assertEqual(matches[0]["employee_code"], employee_code)
		save_training_activity_roster(
			json.dumps(
				{
					"training_event": activity["name"],
					"participants": [
						{"employee": employee_name, "hours": "1.5", "score": "88", "comments": "草稿备注"}
					],
				}
			)
		)
		roster = get_training_activity_roster(activity["name"])
		self.assertEqual(roster["participants"][0]["hours"], 1.5)
		self.assertEqual(roster["participants"][0]["score"], 88)
		self.assertEqual(roster["participants"][0]["comments"], "草稿备注")

		blank_activity = create_training_activity(
			json.dumps(
				{
					"company": company,
					"training_program": course["name"],
					"start_time": str(add_days(start_time, 1)),
					"end_time": str(add_days(start_time.replace(hour=11), 1)),
					"location": "测试培训室",
					"participants": [{"employee": employee_name}],
				}
			)
		)
		self.assertEqual(blank_activity["participant_count"], 1)
		blank_roster = get_training_activity_roster(blank_activity["name"])
		self.assertIsNone(blank_roster["participants"][0]["hours"])
		self.assertIsNone(blank_roster["participants"][0]["score"])
		completion = record_training_completion(
			json.dumps(
				{
					"training_event": activity["name"],
					"participants": roster["participants"],
				}
			)
		)

		self.assertEqual(frappe.db.get_value("Training Event", activity["name"], "event_status"), "Completed")
		self.assertEqual(frappe.db.get_value("Training Result", completion["training_result"], "docstatus"), 1)
		self.assertEqual(completion["passed_count"], 1)
		history = _get_employee_training_history(frappe.get_doc("Employee", employee_name))
		self.assertEqual(history["employee_code"], employee_code)
		record = next(row for row in history["records"] if row["training_event"] == activity["name"])
		self.assertEqual(record["study_hours"], 1.5)
		self.assertEqual(record["score"], 88)
		self.assertEqual(record["review_status"], "已确认")
