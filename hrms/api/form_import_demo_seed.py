"""Seed every HR form-import template with safe, traceable TEST-HRMS data.

This is an acceptance helper, not a production import.  It creates one workbook
per template and calls the same preview/import functions used by the Desk UI.
Workflow forms start in ``HRMS Form Import Row`` staging.  The review workflow
can then create and activate formal target documents; this seed itself never
does that automatically, so import acceptance remains safe and repeatable.
"""

from __future__ import annotations

from io import BytesIO

import frappe
from openpyxl import Workbook

from hrms.api import employee_field_template as roster
from hrms.api import form_data_intake as intake


TEST_COMPANY = "TEST-HRMS"
SEED_TAG = "TEST-FORM-IMPORT-ALL-20260715-V1"
ROSTER_EMPLOYEE_CODE = "TEST-FORM-ROSTER-001"
ACTIVE_EMPLOYEE_CODE = "TEST-REG-003"
ACTIVE_EMPLOYEE_NAME = "TEST-REG-003"
# Department identity no longer appends the Company abbreviation.  Keep the
# isolated acceptance fixture aligned with the same business-name contract.
TEST_DEPARTMENT = "TEST-HRMS-DEPT"
TRANSFER_DEPARTMENT = "TEST-生产部"
TEST_DESIGNATION = "TEST-正式岗位"
TRANSFER_DESIGNATION = "TEST-异动岗位"
PROTECTED_COMPANIES = ("永新", "1")


def _ensure_onboarding_import_fixture():
	"""Create isolated candidate/Offer/template/holiday inputs for onboarding imports."""
	from hrms.api import recruitment_demo_seed

	recruitment_demo_seed.seed_recruitment_demo(company=TEST_COMPANY)
	template = intake.ensure_default_employee_onboarding_template(TEST_COMPANY)
	# Keep this candidate isolated from earlier acceptance runs.  A Job Offer
	# can create only one Employee Onboarding document, so a fresh fixture is
	# required when validating the complete staging-to-activation chain again.
	email = "test-form-onboarding-v10@example.test"
	applicant_name = frappe.db.get_value("Job Applicant", {"email_id": email}, "name")
	if applicant_name:
		applicant = frappe.get_doc("Job Applicant", applicant_name)
		applicant.applicant_name = "TEST-FORM-ONBOARDING-V10"
		applicant.designation = TEST_DESIGNATION
		applicant.status = "Accepted"
		applicant.save(ignore_permissions=True)
	else:
		applicant = frappe.get_doc(
			{
				"doctype": "Job Applicant",
				"applicant_name": "TEST-FORM-ONBOARDING-V10",
				"email_id": email,
				"phone_number": "13900000118",
				"designation": TEST_DESIGNATION,
				"status": "Accepted",
			}
		).insert(ignore_permissions=True)
	offer_name = frappe.db.get_value(
		"Job Offer",
		{"job_applicant": applicant.name, "company": TEST_COMPANY, "docstatus": 1, "status": "Accepted"},
		"name",
		order_by="modified desc",
	)
	if offer_name:
		offer = frappe.get_doc("Job Offer", offer_name)
	else:
		draft_offer_name = frappe.db.get_value(
			"Job Offer",
			{"job_applicant": applicant.name, "company": TEST_COMPANY, "docstatus": 0},
			"name",
			order_by="modified desc",
		)
		if draft_offer_name:
			offer = frappe.get_doc("Job Offer", draft_offer_name)
			offer.status = "Accepted"
			offer.save(ignore_permissions=True)
			offer.submit()
		else:
			offer = frappe.get_doc(
				{
					"doctype": "Job Offer",
					"job_applicant": applicant.name,
					"applicant_name": applicant.applicant_name,
					"applicant_email": applicant.email_id,
					"status": "Accepted",
					"offer_date": "2099-07-01",
					"designation": TEST_DESIGNATION,
					"company": TEST_COMPANY,
				}
			).insert(ignore_permissions=True)
			offer.submit()
	if offer.docstatus == 0:
		offer.status = "Accepted"
		offer.save(ignore_permissions=True)
		offer.submit()
	holiday_title = "TEST-HRMS Form Import 2099 Holiday List"
	holiday_name = frappe.db.get_value("Holiday List", {"holiday_list_name": holiday_title}, "name")
	if not holiday_name:
		holiday_name = frappe.get_doc(
			{
				"doctype": "Holiday List",
				"holiday_list_name": holiday_title,
				"from_date": "2099-01-01",
				"to_date": "2099-12-31",
			}
		).insert(ignore_permissions=True).name
	return {"candidate_email": email, "job_offer_no": offer.name, "onboarding_template": template["title"], "holiday_list": holiday_name}


def _protected_snapshot():
	return {
		company: {
			"employees": frappe.db.count("Employee", {"company": company}),
			"latest_employee_modified": str(
				frappe.db.get_value("Employee", {"company": company}, "modified", order_by="modified desc") or ""
			),
		}
		for company in PROTECTED_COMPANIES
	}


def _assert_test_foundation():
	if not frappe.db.exists("Company", TEST_COMPANY):
		frappe.throw(f"演示导入只能使用 {TEST_COMPANY}，请先运行基础演示数据。")
	if not frappe.db.exists("Department", TEST_DEPARTMENT):
		frappe.throw(f"未找到测试部门：{TEST_DEPARTMENT}")
	if not frappe.db.exists("Employee", {"company": TEST_COMPANY, "employee_name": ACTIVE_EMPLOYEE_NAME, "status": "Active"}):
		frappe.throw(f"未找到测试员工：{ACTIVE_EMPLOYEE_NAME}")


def _values_for(profile):
	"""Return one valid, human-readable row for a form profile."""
	values = {
		"company": TEST_COMPANY,
		"employee_code": ACTIVE_EMPLOYEE_CODE,
		"employee_name": ACTIVE_EMPLOYEE_NAME,
		"candidate_name": "TEST-CANDIDATE-001",
		"department": TEST_DEPARTMENT,
		# The dedicated organisation activation test updates this existing test
		# department.  Leave the parent empty rather than fabricating a link that
		# would correctly fail the same-company safety validation.
		"parent_department": "",
		"assigned_department": TEST_DEPARTMENT,
		"owner_department": TEST_DEPARTMENT,
		"from_department": TEST_DEPARTMENT,
		"to_department": TRANSFER_DEPARTMENT,
		"department_head_code": ACTIVE_EMPLOYEE_CODE,
		"department_head_name": ACTIVE_EMPLOYEE_NAME,
		"designation": TEST_DESIGNATION,
		"from_designation": TEST_DESIGNATION,
		"to_designation": TRANSFER_DESIGNATION,
		"applied_designation": TEST_DESIGNATION,
		"employee_intent": "续签",
		"contract_type": "固定期限",
		"contract_end_date": "2099-12-31",
		"survey_date": "2099-01-02",
		"application_date": "2099-01-03",
		"last_working_date": "2099-02-28",
		"exit_date": "2099-02-28",
		"transfer_date": "2099-01-04",
		"review_date": "2099-01-05",
		"effective_date": "2099-01-01",
		"attendance_date": "2099-01-06",
		"summary_date": "2099-01-07",
		"proposal_date": "2099-01-08",
		"training_date": "2099-01-09",
		"interview_date": "2099-01-10 09:30:00",
		"expected_join_date": "2099-02-01",
		"start_time": "2099-01-06 08:00:00",
		"end_time": "2099-01-06 17:00:00",
		"completed_at": "2099-01-06 18:00:00",
		"occurred_on": "2099-01-06",
		"attendance_month": "2099-01",
		"payroll_month": "2099-01",
		"effective_month": "2099-01",
		"training_month": "2099-01",
		"period_type": "年度",
		"period": "2099年度",
		"join_date": "2098-01-01",
		"phone": "13900000001",
		"gender": "男",
		"source_channel": "演示数据",
		"external_id": f"TEST-{profile['key'].upper()}-001",
		"approval_no": f"TEST-APP-{profile['key'].upper()}-001",
		"approval_reference": f"TEST-APP-{profile['key'].upper()}-001",
		"approval_status": "已完成",
		"approval_result": "同意",
		"leave_type": "事假",
		"duration": "8",
		"shift_name": "白班",
		"actual_in_time": "08:00",
		"actual_out_time": "17:00",
		"standard_hours": "8",
		"actual_hours": "8",
		"workday_overtime_hours": "1",
		"restday_overtime_hours": "0",
		"holiday_overtime_hours": "0",
		"absence_hours": "0",
		"exception_type": "补卡确认",
		"handling": "已确认",
		"apple_type": "绿苹果",
		"quantity": "1",
		"headcount": "10",
		"regular_headcount": "8",
		"probation_headcount": "2",
		"total_headcount": "10",
		"attendance_count": "10",
		"leave_count": "0",
		"leave_employee_names": "",
		"grade": "T1",
		"evaluation": "通过",
		"interview_record": "TEST 演示认定面谈记录",
		"reason": "TEST 演示业务资料",
		"handover_status": "待确认",
		"decision": "拟录用",
		"interviewer": "TEST-HR",
		"course_type": "岗位培训",
		"training_content": "TEST 演示培训课程",
		"training_mode": "内训",
		"hours": "2",
		"trainer": "TEST-讲师",
		"location": "TEST 培训室",
		"score": "95",
		"certificate_no": "TEST-CERT-001",
		"unit_type": "内部",
		"person_type": "员工",
		"first_issue_date": "2098-01-01",
		"validity_period": "2099-12-31",
		"review_frequency": "每年",
		"next_review_due": "2099-12",
		"review_status": "待复审",
		"new_certificate_price": "100",
		"review_price": "50",
		"proposal_no": "TEST-PROPOSAL-001",
		"subject": "TEST 演示提案/奖惩事项",
		"background": "验证表单导入字段映射",
		"improvement": "优化演示流程",
		"expected_benefit": "验证可见性",
		"status": "处理中",
		"achievements": "完成 TEST 演示导入",
		"improvements": "继续完善字段处理",
		"next_plan": "进入业务确认流程",
		"change_reason": "TEST 演示薪资调整",
		"previous_base_salary": "5000",
		"base_salary": "5200",
		"functional_allowance": "100",
		"position_allowance": "100",
		"certificate_allowance": "50",
		"multi_skill_allowance": "50",
		"gross_salary": "5500",
		"reward_punishment_type": "奖励",
		"rule": "TEST 奖惩规则",
		"standard": "TEST 标准",
		"amount": "100",
		"green_apple_amount": "100",
		"red_apple_amount": "0",
		"housing_allowance": "200",
		"full_attendance_bonus": "200",
		"education_category": "全日制",
		"education_level": "本科",
		"major": "人力资源管理",
		"housing_status": "公司宿舍",
		"building": "TEST-1",
		"floor": "1",
		"dormitory_type": "四人间",
		"accommodation_days": "30",
		"rent_amount": "100",
		"utilities_amount": "20",
		"deduction_amount": "120",
		"social_security_base": "5000",
		"medical_base": "5000",
		"company_amount": "800",
		"employee_amount": "400",
		"allowance": "100",
		"overtime_pay": "50",
		"gross_pay": "5350",
		"deduction_amount": "120",
		"net_pay": "5230",
		"feedback_no": f"TEST-FEEDBACK-{profile['key'].upper()}-001",
		"category": "测试",
		"page_or_feature": "表单导入",
		"description": "TEST 演示：验证表单可以导入、匹配并在系统中查看。",
		"followup_date": "2099-01-15",
		"completed_date": "2099-01-31",
		"remarks": f"{SEED_TAG} / {profile['label']}",
	}
	if profile["key"] == intake.EMPLOYEE_ONBOARDING_TEMPLATE_KEY:
		values.update(_ensure_onboarding_import_fixture())
		values.update({"date_of_joining": "2099-07-08", "boarding_begins_on": "2099-07-07", "notify_users_by_email": "否"})
	return values


def _create_workbook_file(profile):
	values = _values_for(profile)
	workbook = Workbook()
	sheet = workbook.active
	sheet.title = "数据"
	headers = [column["label"] for column in profile["columns"]]
	sheet.append(headers)
	sheet.append([values.get(column["key"], f"TEST-{profile['key']}-{column['key']}") for column in profile["columns"]])
	output = BytesIO()
	workbook.save(output)
	file_doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"{SEED_TAG}-{profile['key']}.xlsx",
			"content": output.getvalue(),
			"is_private": 1,
		}
	).insert(ignore_permissions=True)
	return file_doc.file_url


def _seed_roster():
	existing = frappe.db.get_value("Employee", {"custom_employee_code": ROSTER_EMPLOYEE_CODE}, "name")
	if existing:
		return {"status": "existing", "employee": existing}

	fields = roster._get_employee_import_fields(roster._get_template_doc())
	values = {
		"first_name": ROSTER_EMPLOYEE_CODE,
		"employee_name": ROSTER_EMPLOYEE_CODE,
		"custom_employee_code": ROSTER_EMPLOYEE_CODE,
		"company": TEST_COMPANY,
		"department": TEST_DEPARTMENT,
		"designation": TEST_DESIGNATION,
		"employment_type": "Full-time",
		"date_of_joining": "2099-01-01",
		"date_of_birth": "1990-01-01",
		"gender": "Male",
		"cell_number": "13900000099",
		"status": "Active",
	}
	workbook = Workbook()
	sheet = workbook.active
	sheet.title = "员工花名册"
	sheet.append([field["field_label"] for field in fields])
	sheet.append([values.get(field["fieldname"], "") for field in fields])
	output = BytesIO()
	workbook.save(output)
	file_doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"{SEED_TAG}-employee_roster.xlsx",
			"content": output.getvalue(),
			"is_private": 1,
		}
	).insert(ignore_permissions=True)
	preview = roster.preview_employee_roster_import(file_doc.file_url, mode="insert", match_by="employee_code")
	if preview.get("failed"):
		frappe.throw(f"员工花名册演示导入预校验失败：{preview['errors']}")
	result = roster.import_employee_roster(file_doc.file_url, mode="insert", match_by="employee_code")
	if result.get("failed") or not result.get("inserted"):
		frappe.throw(f"员工花名册演示导入失败：{result}")
	return {"status": "imported", "employee": frappe.db.get_value("Employee", {"custom_employee_code": ROSTER_EMPLOYEE_CODE}, "name"), "result": result}


@frappe.whitelist()
def seed_all_form_imports():
	"""Create and import one TEST-HRMS workbook for every configured profile."""
	_assert_test_foundation()
	protected_before = _protected_snapshot()
	result = {"company": TEST_COMPANY, "tag": SEED_TAG, "templates": {}, "protected_before": protected_before}

	for profile in intake.FORM_IMPORT_PROFILES:
		if profile.get("entry_mode") == "employee_roster":
			result["templates"][profile["key"]] = _seed_roster()
			continue

		existing = frappe.db.get_value(
			intake.FORM_IMPORT_BATCH_DOCTYPE,
			{"company": TEST_COMPANY, "template_key": profile["key"], "notes": SEED_TAG},
			"name",
		)
		if existing:
			result["templates"][profile["key"]] = {"status": "existing", "batch": existing}
			continue

		file_url = _create_workbook_file(profile)
		preview = intake.preview_form_import(file_url, profile["key"], TEST_COMPANY)
		if preview.get("missing_required") or preview.get("failed_rows") or preview.get("valid_rows") != 1:
			frappe.throw(f"{profile['key']} 演示预校验失败：{preview}")
		imported = intake.import_form_workbook(file_url, profile["key"], TEST_COMPANY, notes=SEED_TAG)
		if imported.get("failed_rows") or imported.get("valid_rows") != 1:
			frappe.throw(f"{profile['key']} 演示导入失败：{imported}")
		result["templates"][profile["key"]] = {"status": "imported", "batch": imported["batch_name"], "file_url": file_url}

	frappe.db.commit()
	protected_after = _protected_snapshot()
	if protected_before != protected_after:
		frappe.throw(f"演示表单导入触碰了受保护公司：before={protected_before}, after={protected_after}")
	result["protected_after"] = protected_after
	result["summary"] = {
		"template_count": len(intake.FORM_IMPORT_PROFILES),
		"imported": sum(1 for item in result["templates"].values() if item["status"] == "imported"),
		"existing": sum(1 for item in result["templates"].values() if item["status"] == "existing"),
		"batches": frappe.db.count(intake.FORM_IMPORT_BATCH_DOCTYPE, {"company": TEST_COMPANY, "notes": SEED_TAG}),
		"rows": frappe.db.count(intake.FORM_IMPORT_ROW_DOCTYPE, {"company": TEST_COMPANY}),
	}
	return result


@frappe.whitelist()
def get_form_import_seed_status():
	"""Read-only acceptance report for the TEST form-import data set."""
	batches = frappe.get_all(
		intake.FORM_IMPORT_BATCH_DOCTYPE,
		filters={"company": TEST_COMPANY, "notes": SEED_TAG},
		fields=["name", "template_key", "template_name", "status", "total_rows", "valid_rows", "failed_rows"],
		order_by="template_key asc",
	)
	rows = frappe.get_all(
		intake.FORM_IMPORT_ROW_DOCTYPE,
		filters={"company": TEST_COMPANY},
		fields=["name", "import_batch", "template_key", "employee", "department", "target_doctype", "status"],
		order_by="creation desc",
		limit_page_length=200,
	)
	seed_rows = [row for row in rows if row.import_batch in {batch.name for batch in batches}]
	return {
		"company": TEST_COMPANY,
		"tag": SEED_TAG,
		"batches": batches,
		"rows": seed_rows,
		"roster_employee": frappe.db.get_value("Employee", {"custom_employee_code": ROSTER_EMPLOYEE_CODE}, ["name", "employee_name", "department", "designation", "status"], as_dict=True),
		"summary": {
			"profiles": len(intake.FORM_IMPORT_PROFILES),
			"batches": len(batches),
			"rows": len(seed_rows),
			"linked_employee_rows": sum(1 for row in seed_rows if row.employee),
			"linked_department_rows": sum(1 for row in seed_rows if row.department),
			"target_document_rows": sum(1 for row in seed_rows if row.target_doctype),
		},
	}
