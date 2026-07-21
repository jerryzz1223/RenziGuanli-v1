"""Create repeatable recruitment demonstration records in the TEST-HRMS company only.

Run locally after migration:
    bench --site hrms.localhost execute hrms.api.recruitment_demo_seed.seed_recruitment_demo \
        --kwargs '{"company": "TEST-HRMS"}'

The seed deliberately uses TEST-REC-* names and test-domain email addresses.  It
upserts only its own master and transaction records; it never deletes records.
"""

from __future__ import annotations

from typing import Any

import frappe
from frappe import _
from frappe.utils import getdate


COMPANY = "TEST-HRMS"
SEED_PREFIX = "TEST-REC-"
TEST_DEPARTMENT = "TEST-HRMS-DEPT - TEST"
INTERVIEWER = "Administrator"

PRODUCTION_DESIGNATION = f"{SEED_PREFIX}生产操作员"
QUALITY_DESIGNATION = f"{SEED_PREFIX}质量检验员"
PRODUCTION_TEMPLATE = f"{SEED_PREFIX}生产操作员岗位模板"
QUALITY_TEMPLATE = f"{SEED_PREFIX}质量检验员岗位模板"
HR_SCREENING = f"{SEED_PREFIX}HR 初筛"
TECHNICAL_INTERVIEW = f"{SEED_PREFIX}部门技术面"
OFFER_TEMPLATE = f"{SEED_PREFIX}制造业一线岗位录用条款"
STAFFING_PLAN = f"{SEED_PREFIX}STAFFING-2026"


def _require_test_company(company: str) -> str:
	if company != COMPANY:
		frappe.throw(_("Recruitment demo seed only permits company {0}.").format(COMPANY))
	if not frappe.db.exists("Company", COMPANY):
		frappe.throw(_("Company {0} must exist before creating recruitment demo data.").format(COMPANY))
	if not frappe.db.exists("Department", {"name": TEST_DEPARTMENT, "company": COMPANY}):
		frappe.throw(_("Department {0} must exist before creating recruitment demo data.").format(TEST_DEPARTMENT))
	if not frappe.db.exists("User", INTERVIEWER):
		frappe.throw(_("Required demo interviewer {0} does not exist.").format(INTERVIEWER))
	return company


def _set_fields(doc: Any, values: dict[str, Any]) -> Any:
	for fieldname, value in values.items():
		setattr(doc, fieldname, value)
	return doc


def _upsert_master(doctype: str, name: str, values: dict[str, Any]) -> Any:
	if frappe.db.exists(doctype, name):
		doc = frappe.get_doc(doctype, name)
		_set_fields(doc, values)
		doc.save(ignore_permissions=True)
		return doc

	doc = frappe.new_doc(doctype)
	_set_fields(doc, values)
	doc.insert(ignore_permissions=True)
	return doc


def _ensure_designation(name: str, description: str) -> Any:
	return _upsert_master("Designation", name, {"designation_name": name, "description": description})


def _ensure_skill(name: str, description: str) -> Any:
	return _upsert_master("Skill", name, {"skill_name": name, "description": description})


def _ensure_offer_term(name: str) -> Any:
	return _upsert_master("Offer Term", name, {"offer_term": name})


def _ensure_job_opening_template(
	title: str, designation: str, description: str, lower_range: int, upper_range: int
) -> Any:
	return _upsert_master(
		"Job Opening Template",
		title,
		{
			"template_title": title,
			"designation": designation,
			"department": TEST_DEPARTMENT,
			"employment_type": "Full-time",
			"description": description,
			"currency": "CNY",
			"lower_range": lower_range,
			"upper_range": upper_range,
			"salary_per": "Month",
		},
	)


def _ensure_interview_type(name: str, skills: list[str], description: str) -> Any:
	values = {
		"interview_type_name": name,
		"description": description,
		"expected_average_rating": 3,
	}
	if frappe.db.exists("Interview Type", name):
		doc = frappe.get_doc("Interview Type", name)
		_set_fields(doc, values)
	else:
		doc = frappe.new_doc("Interview Type")
		_set_fields(doc, values)
	doc.expected_skill_set = []
	for skill in skills:
		doc.append("expected_skill_set", {"skill": skill})
	doc.interviewers = []
	doc.append("interviewers", {"user": INTERVIEWER})
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
	return doc


def _ensure_offer_template(terms: list[tuple[str, str]]) -> Any:
	doc = _upsert_master("Job Offer Term Template", OFFER_TEMPLATE, {"title": OFFER_TEMPLATE})
	doc.offer_terms = []
	for offer_term, value in terms:
		doc.append("offer_terms", {"offer_term": offer_term, "value": value})
	doc.save(ignore_permissions=True)
	return doc


def _require_requester() -> str:
	requesters = frappe.get_all(
		"Employee",
		filters={"company": COMPANY, "status": "Active"},
		pluck="name",
		limit_page_length=1,
	)
	if not requesters:
		frappe.throw(_("TEST-HRMS needs one active TEST employee before seeding Job Requisitions."))
	return requesters[0]


def _ensure_staffing_plan() -> Any:
	if frappe.db.exists("Staffing Plan", STAFFING_PLAN):
		plan = frappe.get_doc("Staffing Plan", STAFFING_PLAN)
		if plan.company != COMPANY:
			frappe.throw(_("Recruitment demo staffing plan is not owned by {0}.").format(COMPANY))
		return plan

	plan = frappe.new_doc("Staffing Plan")
	plan.name = STAFFING_PLAN
	_set_fields(
		plan,
		{
			"company": COMPANY,
			"department": TEST_DEPARTMENT,
			"from_date": getdate("2026-01-01"),
			"to_date": getdate("2026-12-31"),
		},
	)
	plan.append(
		"staffing_details",
		{"designation": PRODUCTION_DESIGNATION, "vacancies": 2, "estimated_cost_per_position": 6000},
	)
	plan.append(
		"staffing_details",
		{"designation": QUALITY_DESIGNATION, "vacancies": 2, "estimated_cost_per_position": 7000},
	)
	plan.insert(ignore_permissions=True)
	plan.submit()
	return plan


def _ensure_job_requisition(designation: str, compensation: int, requester: str) -> Any:
	filters = {
		"company": COMPANY,
		"designation": designation,
		"department": TEST_DEPARTMENT,
		"reason_for_requesting": f"{SEED_PREFIX}试用招聘演示",
	}
	name = frappe.db.exists("Job Requisition", filters)
	if name:
		doc = frappe.get_doc("Job Requisition", name)
		_set_fields(
			doc,
			{
				"no_of_positions": 2,
				"expected_compensation": compensation,
				"status": "Open & Approved",
				"description": f"{designation}：制造现场一线岗位招聘演示。",
			},
		)
		doc.save(ignore_permissions=True)
		return doc

	doc = frappe.new_doc("Job Requisition")
	_set_fields(
		doc,
		{
			"designation": designation,
			"no_of_positions": 2,
			"expected_compensation": compensation,
			"status": "Open & Approved",
			"company": COMPANY,
			"requested_by": requester,
			"department": TEST_DEPARTMENT,
			"posting_date": getdate("2026-07-01"),
			"expected_by": getdate("2026-08-31"),
			"description": f"{designation}：制造现场一线岗位招聘演示。",
			"reason_for_requesting": f"{SEED_PREFIX}试用招聘演示",
		},
	)
	doc.insert(ignore_permissions=True)
	return doc


def _ensure_job_opening(
	title: str, designation: str, template: str, requisition: str, lower_range: int, upper_range: int
) -> Any:
	name = frappe.db.exists("Job Opening", {"company": COMPANY, "job_title": title})
	values = {
		"job_title": title,
		"company": COMPANY,
		"status": "Open",
		"designation": designation,
		"department": TEST_DEPARTMENT,
		"staffing_plan": STAFFING_PLAN,
		"planned_vacancies": 2,
		"job_requisition": requisition,
		"vacancies": 2,
		"description": f"{designation}：可在招聘工作台查看的演示职位。",
		"currency": "CNY",
		"lower_range": lower_range,
		"upper_range": upper_range,
		"salary_per": "Month",
		"closes_on": getdate("2026-12-31"),
		"employment_type": "Full-time",
		"job_opening_template": template,
	}
	if name:
		doc = frappe.get_doc("Job Opening", name)
		_set_fields(doc, values)
		doc.save(ignore_permissions=True)
		return doc

	doc = frappe.new_doc("Job Opening")
	_set_fields(doc, values)
	doc.insert(ignore_permissions=True)
	return doc


def _ensure_applicant(
	name: str, email: str, designation: str, opening: str, status: str, note: str
) -> Any:
	values = {
		"applicant_name": name,
		"job_title": opening,
		"designation": designation,
		"status": status,
		"phone_number": "13800000000",
		"notes": note,
	}
	existing_name = frappe.db.get_value("Job Applicant", {"email_id": email}, "name")
	if existing_name:
		doc = frappe.get_doc("Job Applicant", existing_name)
		existing_values = values.copy()
		accepted_offer = frappe.db.get_value(
			"Job Offer",
			{"job_applicant": doc.name, "status": "Accepted", "docstatus": 1},
			"name",
		)
		if accepted_offer:
			# An accepted offer is the source of truth: a repeated demo seed must
			# never downgrade its applicant to Shortlisted.  Repair legacy data
			# that was created before the onboarding import prerequisite existed.
			existing_values.pop("status")
			if doc.status != "Accepted":
				doc.status = "Accepted"
		_set_fields(doc, existing_values)
		doc.save(ignore_permissions=True)
		return doc

	doc = frappe.new_doc("Job Applicant")
	values["email_id"] = email
	_set_fields(doc, values)
	doc.insert(ignore_permissions=True)
	return doc


def _ensure_interview(applicant: str, opening: str, designation: str, interview_type: str, status: str) -> Any:
	name = frappe.db.exists(
		"Interview", {"job_applicant": applicant, "interview_type": interview_type, "docstatus": ["!=", 2]}
	)
	if name:
		return frappe.get_doc("Interview", name)

	doc = frappe.new_doc("Interview")
	_set_fields(
		doc,
		{
			"job_applicant": applicant,
			"job_opening": opening,
			"designation": designation,
			"interview_type": interview_type,
			"status": status,
			"scheduled_on": getdate("2026-07-01"),
			"from_time": "09:00:00",
			"to_time": "10:00:00",
		},
	)
	doc.append("interview_details", {"interviewer": INTERVIEWER})
	doc.insert(ignore_permissions=True)
	doc.reload()
	doc.submit()
	return doc


def _ensure_feedback(interview: str, applicant: str, interview_type: str, result: str, rating: int) -> Any:
	name = frappe.db.exists(
		"Interview Feedback", {"interview": interview, "interviewer": INTERVIEWER, "docstatus": ["!=", 2]}
	)
	if name:
		return frappe.get_doc("Interview Feedback", name)

	doc = frappe.new_doc("Interview Feedback")
	_set_fields(
		doc,
		{
			"interview": interview,
			"interviewer": INTERVIEWER,
			"job_applicant": applicant,
			"interview_type": interview_type,
			"result": result,
			"feedback": f"{SEED_PREFIX}招聘演示反馈：{result}。",
		},
	)
	doc.append("skill_assessment", {"skill": f"{SEED_PREFIX}沟通表达", "rating": rating})
	doc.append("skill_assessment", {"skill": f"{SEED_PREFIX}岗位基础", "rating": rating})
	doc.insert(ignore_permissions=True)
	doc.submit()
	return doc


def _ensure_offer(applicant: Any, designation: str, status: str, terms: list[tuple[str, str]]) -> Any:
	name = frappe.db.exists("Job Offer", {"job_applicant": applicant.name, "docstatus": ["!=", 2]})
	if name:
		return frappe.get_doc("Job Offer", name)

	doc = frappe.new_doc("Job Offer")
	_set_fields(
		doc,
		{
			"job_applicant": applicant.name,
			"applicant_name": applicant.applicant_name,
			"applicant_email": applicant.email_id,
			"status": status,
			"offer_date": getdate("2026-07-10"),
			"designation": designation,
			"company": COMPANY,
			"job_offer_term_template": OFFER_TEMPLATE,
		},
	)
	for offer_term, value in terms:
		doc.append("offer_terms", {"offer_term": offer_term, "value": value})
	doc.insert(ignore_permissions=True)
	doc.submit()
	return doc


@frappe.whitelist()
def seed_recruitment_demo(company: str = COMPANY) -> dict[str, Any]:
	"""Seed the complete recruitment trial chain, refusing every non-test company."""
	_require_test_company(company)

	_ensure_designation(PRODUCTION_DESIGNATION, "TEST-HRMS 招聘演示：生产操作员")
	_ensure_designation(QUALITY_DESIGNATION, "TEST-HRMS 招聘演示：质量检验员")
	_ensure_skill(f"{SEED_PREFIX}沟通表达", "候选人的沟通、协作与安全意识表达。")
	_ensure_skill(f"{SEED_PREFIX}岗位基础", "候选人的岗位基础、作业规范与质量意识。")
	for term in [f"{SEED_PREFIX}工作地点", f"{SEED_PREFIX}试用期", f"{SEED_PREFIX}薪资说明"]:
		_ensure_offer_term(term)

	_ensure_job_opening_template(
		PRODUCTION_TEMPLATE,
		PRODUCTION_DESIGNATION,
		"负责生产线操作、设备点检与5S；接受倒班。",
		5500,
		7000,
	)
	_ensure_job_opening_template(
		QUALITY_TEMPLATE,
		QUALITY_DESIGNATION,
		"负责来料、过程与成品检验；记录质量异常并跟进。",
		6000,
		7500,
	)
	_ensure_interview_type(HR_SCREENING, [f"{SEED_PREFIX}沟通表达"], "核验基本信息、稳定性与安全意识。")
	_ensure_interview_type(
		TECHNICAL_INTERVIEW,
		[f"{SEED_PREFIX}岗位基础", f"{SEED_PREFIX}沟通表达"],
		"由用人部门评估岗位技能、质量意识与作业规范。",
	)
	offer_terms = [
		(f"{SEED_PREFIX}工作地点", "TEST-HRMS 制造现场"),
		(f"{SEED_PREFIX}试用期", "3个月，依法办理。"),
		(f"{SEED_PREFIX}薪资说明", "以录用通知与薪资核算规则为准。"),
	]
	_ensure_offer_template(offer_terms)

	plan = _ensure_staffing_plan()
	requester = _require_requester()
	production_requisition = _ensure_job_requisition(PRODUCTION_DESIGNATION, 6000, requester)
	quality_requisition = _ensure_job_requisition(QUALITY_DESIGNATION, 7000, requester)
	production_opening = _ensure_job_opening(
		f"{SEED_PREFIX}生产操作员招聘", PRODUCTION_DESIGNATION, PRODUCTION_TEMPLATE, production_requisition.name, 5500, 7000
	)
	quality_opening = _ensure_job_opening(
		f"{SEED_PREFIX}质量检验员招聘", QUALITY_DESIGNATION, QUALITY_TEMPLATE, quality_requisition.name, 6000, 7500
	)

	accepted = _ensure_applicant(
		"陈试用", "test-rec-accepted@example.test", PRODUCTION_DESIGNATION, production_opening.name, "Accepted", "完成两轮面试，录用。"
	)
	pending = _ensure_applicant(
		"林待定", "test-rec-pending@example.test", QUALITY_DESIGNATION, quality_opening.name, "Shortlisted", "通过筛选，等待候选人回复录用。"
	)
	rejected = _ensure_applicant(
		"周淘汰", "test-rec-rejected@example.test", PRODUCTION_DESIGNATION, production_opening.name, "Rejected", "HR 初筛未通过。"
	)

	accepted_hr = _ensure_interview(accepted.name, production_opening.name, PRODUCTION_DESIGNATION, HR_SCREENING, "Cleared")
	accepted_technical = _ensure_interview(accepted.name, production_opening.name, PRODUCTION_DESIGNATION, TECHNICAL_INTERVIEW, "Cleared")
	rejected_hr = _ensure_interview(rejected.name, production_opening.name, PRODUCTION_DESIGNATION, HR_SCREENING, "Rejected")
	_ensure_feedback(accepted_hr.name, accepted.name, HR_SCREENING, "Cleared", 4)
	_ensure_feedback(accepted_technical.name, accepted.name, TECHNICAL_INTERVIEW, "Cleared", 4)
	_ensure_feedback(rejected_hr.name, rejected.name, HR_SCREENING, "Rejected", 2)
	accepted_offer = _ensure_offer(accepted, PRODUCTION_DESIGNATION, "Accepted", offer_terms)
	pending_offer = _ensure_offer(pending, QUALITY_DESIGNATION, "Awaiting Response", offer_terms)

	return {
		"company": COMPANY,
		"staffing_plan": plan.name,
		"job_openings": [production_opening.name, quality_opening.name],
		"applicants": [accepted.name, pending.name, rejected.name],
		"interviews": [accepted_hr.name, accepted_technical.name, rejected_hr.name],
		"offers": [accepted_offer.name, pending_offer.name],
	}
