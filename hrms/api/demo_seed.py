"""Idempotent, company-scoped demo data for the local TEST-HRMS site.

This module intentionally uses create-if-missing semantics. Existing records are
never updated by the seed. Attendance and payroll phases are hard-gated and
must not call legacy global month generators.
"""

from __future__ import annotations

import json
import hashlib
from collections import OrderedDict

import frappe
from frappe.utils import now_datetime


TEST_COMPANY = "TEST-HRMS"
DEMO_MONTH = "2099-01"
TEST_PAYROLL_LOCK_VERSION = "TEST-2099-01-V1"
PROTECTED_COMPANIES = ("永新", "1")

PHASES = (
	"foundation",
	"employees",
	"training",
	"recruitment",
	"personnel_lists",
	"performance",
	"attendance",
	"payroll",
)

PERSONNEL_MENU_LABELS = (
	"入职管理",
	"转正管理",
	"人事异动",
	"任职记录",
	"培训经历",
	"奖惩记录",
	"离职管理",
	"离职面谈",
)

DEMO_EDITABLE_DOCTYPES = (
	"Company",
	"Department",
	"Employee",
	"HRMS Monthly Attendance Summary",
	"HRMS Employee Salary Change",
	"HRMS Payroll Variable Record",
	"HRMS Payroll Welfare Source Record",
	"HRMS Payroll Input Record",
	"HRMS Payroll Settlement Record",
)

EMPLOYEE_MANIFEST = (
	("TEST-INT-001", "TEST-INT-001", "Intern", "TEST-实习岗位", "Female", "19900000001"),
	("TEST-PRO-002", "TEST-PRO-002", "Probation", "TEST-试用岗位", "Male", "19900000002"),
	("TEST-REG-003", "TEST-REG-003", "Full-time", "TEST-正式岗位", "Female", "19900000003"),
	("TEST-TRN-004", "TEST-TRN-004", "Full-time", "TEST-异动岗位", "Male", "19900000004"),
	("TEST-OUT-005", "TEST-OUT-005", "Contract", "TEST-外包岗位", "Male", "19900000005"),
	("TEST-REH-006", "TEST-REH-006", "Retainer", "TEST-返聘顾问", "Female", "19900000006"),
	("TEST-MOV-007", "TEST-MOV-007", "Probation", "TEST-试用岗位", "Male", "19900000007"),
	("TEST-LEFT-008", "TEST-LEFT-008", "Full-time", "TEST-离职岗位", "Female", "19900000008"),
)


def _new_result(dry_run=False):
	return {
		"company": TEST_COMPANY,
		"demo_month": DEMO_MONTH,
		"dry_run": bool(int(dry_run or 0)),
		"started_at": str(now_datetime()),
		"phases": OrderedDict(
			(
				phase,
				{
					"created": [],
					"existing": [],
					"planned": [],
					"blocked": [],
					"warnings": [],
				},
			)
			for phase in PHASES
		),
	}


def _event(result, phase, bucket, doctype, key, detail=""):
	result["phases"][phase][bucket].append(
		{"doctype": doctype, "key": str(key or ""), "detail": str(detail or "")}
	)


def _protected_snapshot():
	snapshot = {}
	for company in PROTECTED_COMPANIES:
		latest = frappe.get_all(
			"Employee",
			filters={"company": company},
			fields=["modified"],
			order_by="modified desc",
			limit_page_length=1,
		)
		snapshot[company] = {
			"employee_count": frappe.db.count("Employee", {"company": company}),
			"employee_max_modified": str(latest[0].modified) if latest else "",
			"company_modified": str(frappe.db.get_value("Company", company, "modified") or ""),
		}
	return snapshot


def _assert_protected_unchanged(before):
	after = _protected_snapshot()
	if before != after:
		frappe.throw(
			"Protected company invariant changed during TEST-HRMS seed: "
			+ json.dumps({"before": before, "after": after}, ensure_ascii=False, default=str)
		)
	return after


def _doctype_exists(doctype):
	return bool(frappe.db.exists("DocType", doctype))


def _has_fields(doctype, fields):
	if not _doctype_exists(doctype):
		return False, ["DocType missing"]
	meta = frappe.get_meta(doctype)
	missing = [field for field in fields if not meta.has_field(field)]
	return not missing, missing


def _safe_values(doctype, values):
	meta = frappe.get_meta(doctype)
	return {key: value for key, value in values.items() if key in ("doctype", "__newname") or meta.has_field(key)}


def _validate_scope(doctype, filters, values, allow_global=False):
	meta = frappe.get_meta(doctype)
	company = values.get("company", filters.get("company"))
	if meta.has_field("company") and company != TEST_COMPANY:
		frappe.throw(f"{doctype} seed scope must be company={TEST_COMPANY}")
	if not meta.has_field("company") and not allow_global:
		linked_employee = values.get("employee") or filters.get("employee")
		if linked_employee and frappe.db.get_value("Employee", linked_employee, "company") != TEST_COMPANY:
			frappe.throw(f"{doctype} seed employee must belong to {TEST_COMPANY}")


def _get_existing(doctype, filters):
	return frappe.db.exists(doctype, filters)


def _create_if_missing(
	result,
	phase,
	doctype,
	filters,
	values,
	*,
	key=None,
	allow_global=False,
	submit=False,
	cancel=False,
):
	key = key or next(iter(filters.values()), doctype)
	if not _doctype_exists(doctype):
		_event(result, phase, "blocked", doctype, key, "DocType missing")
		return None

	existing = _get_existing(doctype, filters)
	if existing:
		meta = frappe.get_meta(doctype)
		if meta.has_field("company"):
			company = frappe.db.get_value(doctype, existing, "company")
			if company != TEST_COMPANY:
				_event(result, phase, "blocked", doctype, key, f"existing company is {company}")
				return None
		_event(result, phase, "existing", doctype, existing, key)
		return existing

	try:
		_validate_scope(doctype, filters, values, allow_global=allow_global)
		if result["dry_run"]:
			_event(result, phase, "planned", doctype, key, filters)
			return f"DRY-RUN:{doctype}:{key}"

		savepoint = f"demo_seed_{phase}_{sum(len(v) for v in result['phases'][phase].values())}"
		frappe.db.savepoint(savepoint)
		doc_values = _safe_values(doctype, {"doctype": doctype, **values})
		doc = frappe.get_doc(doc_values)
		doc.insert(ignore_permissions=True)
		if submit:
			doc.submit()
		if cancel:
			if doc.docstatus == 0:
				doc.submit()
			doc.cancel()
		_event(result, phase, "created", doctype, doc.name, key)
		return doc.name
	except Exception as exc:
		try:
			frappe.db.rollback(save_point=savepoint)
		except Exception:
			pass
		_event(result, phase, "blocked", doctype, key, f"{type(exc).__name__}: {exc}")
		return None


def _department_name(department_name):
	return frappe.db.get_value(
		"Department", {"department_name": department_name, "company": TEST_COMPANY}, "name"
	)


def _employee(employee_number):
	return frappe.db.get_value(
		"Employee", {"employee_number": employee_number, "company": TEST_COMPANY}, "name"
	)


def _demo_source_trace(source_type, employee_number="", extra=None):
	payload = {
		"company": TEST_COMPANY,
		"payroll_month": DEMO_MONTH,
		"attendance_lock_version": TEST_PAYROLL_LOCK_VERSION,
		"source_type": source_type,
		"employee_number": employee_number,
		"seed": "TEST-HRMS local demo",
	}
	if extra:
		payload.update(extra)
	text = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
	return text, hashlib.sha256(text.encode("utf-8")).hexdigest()


def _test_payroll_people():
	return (
		{
			"number": "TEST-REG-003",
			"salary": (2800, 120, 80, 0),
			"attendance": (176, 168, 12, 8, 0, 0, 1, 0, 12),
			"variables": {
				"全勤奖": 150,
				"住房补贴": 100,
				"学历补贴": 0,
				"社保个人": 420,
				"公积金个人": 160,
				"提案改善奖": 80,
				"生产奖": 120,
				"所得税": 35,
				"水电费及扣款": 20,
			},
		},
		{
			"number": "TEST-MOV-007",
			"salary": (2600, 80, 50, 0),
			"attendance": (176, 176, 8, 16, 0, 0, 0, 1, 0),
			"variables": {
				"全勤奖": 200,
				"住房补贴": 0,
				"学历补贴": 100,
				"社保个人": 0,
				"公积金个人": 0,
				"苹果树": 60,
				"生产奖": 100,
				"所得税": 0,
			},
		},
		{
			"number": "TEST-LEFT-008",
			"salary": (3000, 100, 100, 0),
			"attendance": (176, 120, 4, 0, 0, 8, 0, 0, -20),
			"variables": {
				"全勤奖": 0,
				"住房补贴": 0,
				"学历补贴": 0,
				"社保个人": 360,
				"公积金个人": 140,
				"离职薪资结算": -80,
				"其他扣款": 80,
				"所得税": 10,
			},
		},
	)


def _seed_foundation(result):
	phase = "foundation"
	_create_if_missing(
		result,
		phase,
		"Company",
		{"name": TEST_COMPANY},
		{
			"company_name": TEST_COMPANY,
			"abbr": "TEST",
			"default_currency": "CNY",
			"country": "China",
		},
		key=TEST_COMPANY,
	)

	for department in ("TEST-HRMS-DEPT", "TEST-研发部", "TEST-生产部", "TEST-人资部"):
		_create_if_missing(
			result,
			phase,
			"Department",
			{"department_name": department, "company": TEST_COMPANY},
			{"department_name": department, "company": TEST_COMPANY},
			key=department,
		)

	for designation in (
		"TEST-实习岗位",
		"TEST-试用岗位",
		"TEST-正式岗位",
		"TEST-异动岗位",
		"TEST-外包岗位",
		"TEST-返聘顾问",
		"TEST-招聘专员",
		"TEST-离职岗位",
	):
		_create_if_missing(
			result,
			phase,
			"Designation",
			{"name": designation},
			{"designation_name": designation},
			key=designation,
			allow_global=True,
		)

	# Contract is standard and already present. Retainer is the canonical value
	# required by the roster's retirement-rehire filter; creating it does not
	# change any Employee belonging to a protected company.
	_create_if_missing(
		result,
		phase,
		"Employment Type",
		{"name": "Retainer"},
		{"employee_type_name": "Retainer"},
		key="Retainer",
		allow_global=True,
	)

	for name, start, end in (
		("TEST-白班-0800-1700", "08:00:00", "17:00:00"),
		("TEST-夜班-2000-0430", "20:00:00", "04:30:00"),
	):
		_create_if_missing(
			result,
			phase,
			"Shift Type",
			{"name": name},
			{"__newname": name, "start_time": start, "end_time": end},
			key=name,
			allow_global=True,
		)


def _seed_employees(result):
	phase = "employees"
	department = _department_name("TEST-HRMS-DEPT")
	if not department:
		_event(result, phase, "blocked", "Employee", "manifest", "TEST department unavailable")
		return

	for index, (number, employee_name, employment_type, designation, gender, phone) in enumerate(
		EMPLOYEE_MANIFEST, start=5
	):
		any_company = frappe.db.get_value("Employee", {"employee_number": number}, ["name", "company"], as_dict=True)
		if any_company and any_company.company != TEST_COMPANY:
			_event(result, phase, "blocked", "Employee", number, f"business code belongs to {any_company.company}")
			continue
		values = {
			"first_name": employee_name,
			"gender": gender,
			"date_of_birth": f"198{index - 5}-0{index - 4}-0{index - 4}",
			"date_of_joining": "2026-06-01",
			"status": "Left" if number == "TEST-LEFT-008" else "Active",
			"company": TEST_COMPANY,
			"department": department,
			"designation": designation,
			"employee_number": number,
			"custom_employee_code": number,
			"employment_type": employment_type,
			"cell_number": phone,
			"personal_email": f"{number.lower()}@example.invalid",
			"custom_probation_months": 3 if number == "TEST-MOV-007" else 0,
			"custom_is_confirmed": "否" if number == "TEST-MOV-007" else "是",
			"scheduled_confirmation_date": "2026-07-01" if number == "TEST-MOV-007" else None,
			"final_confirmation_date": None if number == "TEST-MOV-007" else "2026-06-01",
			"relieving_date": "2026-07-31" if number == "TEST-LEFT-008" else None,
			"reason_for_leaving": "TEST-虚拟离职演示" if number == "TEST-LEFT-008" else None,
		}
		_create_if_missing(
			result,
			phase,
			"Employee",
			{"employee_number": number, "company": TEST_COMPANY},
			values,
			key=number,
		)


def _seed_training(result):
	phase = "training"
	trainee = _employee("TEST-MOV-007") or _employee("TEST-INT-001")
	if not trainee:
		_event(result, phase, "blocked", "Training Program", "TEST training", "TEST trainee unavailable")
		return

	skill = _create_if_missing(
		result,
		phase,
		"Skill",
		{"name": "TEST-安全作业能力"},
		{"skill_name": "TEST-安全作业能力", "description": "TEST-虚拟技能"},
		key="TEST-安全作业能力",
		allow_global=True,
	)
	program = _create_if_missing(
		result,
		phase,
		"Training Program",
		{"name": "TEST-入职安全培训"},
		{
			"training_program": "TEST-入职安全培训",
			"status": "Scheduled",
			"company": TEST_COMPANY,
			"description": "TEST-虚拟入职安全培训与资格确认。",
		},
		key="TEST-入职安全培训",
	)
	completed_event = _create_if_missing(
		result,
		phase,
		"Training Event",
		{"name": "TEST-2099-入职培训-已完成"},
		{
			"event_name": "TEST-2099-入职培训-已完成",
			"training_program": program if program and not str(program).startswith("DRY-RUN:") else None,
			"event_status": "Completed",
			"type": "Workshop",
			"company": TEST_COMPANY,
			"location": "TEST-虚拟培训室",
			"start_time": "2026-06-10 09:00:00",
			"end_time": "2026-06-10 17:00:00",
			"introduction": "TEST-已完成的虚拟培训。",
			"employees": [{"employee": trainee, "status": "Completed", "attendance": "Present"}],
		},
		key="TEST-2099-入职培训-已完成",
	)
	_create_if_missing(
		result,
		phase,
		"Training Event",
		{"name": "TEST-2099-资格复训-待参加"},
		{
			"event_name": "TEST-2099-资格复训-待参加",
			"training_program": program if program and not str(program).startswith("DRY-RUN:") else None,
			"event_status": "Scheduled",
			"type": "Workshop",
			"company": TEST_COMPANY,
			"location": "TEST-虚拟培训室",
			"start_time": "2099-01-20 09:00:00",
			"end_time": "2099-01-20 17:00:00",
			"introduction": "TEST-待参加的虚拟资格复训。",
			"employees": [{"employee": trainee, "status": "Open", "is_mandatory": 1}],
		},
		key="TEST-2099-资格复训-待参加",
	)
	if completed_event and not str(completed_event).startswith("DRY-RUN:"):
		_create_if_missing(
			result,
			phase,
			"Training Result",
			{"training_event": completed_event},
			{
				"training_event": completed_event,
				"employees": [
					{
						"employee": trainee,
						"hours": 8,
						"grade": "TEST-合格",
						"comments": "TEST-虚拟培训结果",
					}
				],
			},
			key=completed_event,
		)
		_create_if_missing(
			result,
			phase,
			"Employee Skill Map",
			{"employee": trainee},
			{
				"employee": trainee,
				"employee_skills": [{"skill": skill, "proficiency": 4}],
				"trainings": [{"training": completed_event, "training_date": "2026-06-10"}],
			},
			key="TEST-MOV-007 training history",
		)


def _seed_recruitment(result):
	phase = "recruitment"
	try:
		from hrms.api import recruitment_demo_seed
	except Exception as exc:
		_event(result, phase, "blocked", "recruitment_demo_seed", "TEST-REC", f"入口不可用: {exc}")
		return

	staffing_plan = getattr(recruitment_demo_seed, "STAFFING_PLAN", "TEST-REC-STAFFING-2026")
	complete = bool(frappe.db.exists("Staffing Plan", staffing_plan))
	complete = complete and frappe.db.count(
		"Job Opening", {"company": TEST_COMPANY, "job_title": ("like", "TEST-REC-%")}
	) >= 2
	complete = complete and frappe.db.count(
		"Job Applicant", {"email_id": ("like", "test-rec-%")}
	) >= 3
	complete = complete and frappe.db.count(
		"Job Offer", {"company": TEST_COMPANY, "applicant_email": ("like", "test-rec-%")}
	) >= 2

	if complete:
		for doctype, key in (
			("Staffing Plan", staffing_plan),
			("Job Opening", "TEST-REC x2"),
			("Job Applicant", "TEST-REC x3"),
			("Interview", "TEST-REC submitted x3"),
			("Interview Feedback", "TEST-REC submitted x3"),
			("Job Offer", "TEST-REC x2"),
		):
			_event(result, phase, "existing", doctype, key, "owned by recruitment_demo_seed")
	else:
		if result["dry_run"]:
			_event(result, phase, "planned", "recruitment_demo_seed", "TEST-REC", "call seed_recruitment_demo")
			return
		try:
			payload = recruitment_demo_seed.seed_recruitment_demo(company=TEST_COMPANY)
			for field, names in payload.items():
				if field == "company":
					continue
				for name in names if isinstance(names, list) else [names]:
					_event(result, phase, "created", field, name, "created by recruitment_demo_seed")
		except Exception as exc:
			_event(result, phase, "blocked", "recruitment_demo_seed", "TEST-REC", f"{type(exc).__name__}: {exc}")
			return

	accepted = frappe.db.get_value("Job Applicant", {"email_id": "test-rec-accepted@example.test"}, "name")
	offer = frappe.db.get_value("Job Offer", {"job_applicant": accepted, "company": TEST_COMPANY}, "name") if accepted else None
	opening = frappe.db.get_value("Job Applicant", accepted, "job_title") if accepted else None
	result["links"] = {"job_applicant": accepted, "job_offer": offer, "job_opening": opening}


def _seed_personnel_lists(result):
	phase = "personnel_lists"
	links = result.get("links", {})
	moving_employee = _employee("TEST-MOV-007")
	leaver = _employee("TEST-LEFT-008")
	regular = _employee("TEST-REG-003")
	if not moving_employee:
		_event(result, phase, "blocked", "Employee Promotion", "TEST-MOV-007", "employee unavailable")
		return

	applicant = links.get("job_applicant") or frappe.db.get_value(
		"Job Applicant", {"email_id": "test-rec-accepted@example.test"}, "name"
	)
	offer = links.get("job_offer") or (frappe.db.get_value("Job Offer", {"job_applicant": applicant}, "name") if applicant else None)
	if applicant and offer:
		_create_if_missing(
			result,
			phase,
			"Employee Onboarding",
			{"job_applicant": applicant, "docstatus": ("!=", 2)},
			{
				"job_applicant": applicant,
				"job_offer": offer,
				"employee": moving_employee,
				"employee_name": "TEST-MOV-007",
				"company": TEST_COMPANY,
				"department": _department_name("TEST-人资部") or _department_name("TEST-HRMS-DEPT"),
				"designation": "TEST-招聘专员",
				"date_of_joining": "2026-06-01",
				"boarding_begins_on": "2026-05-20",
				"boarding_status": "Completed",
				"notify_users_by_email": 0,
			},
			key="入职管理 TEST-MOV-007",
		)
	else:
		_event(result, phase, "blocked", "Employee Onboarding", "入职管理", "招聘 Offer 链不可用")

	promotion = _create_if_missing(
		result,
		phase,
		"Employee Promotion",
		{"employee": moving_employee, "promotion_date": "2026-07-01", "docstatus": ("!=", 2)},
		{
			"employee": moving_employee,
			"company": TEST_COMPANY,
			"promotion_date": "2026-07-01",
			"promotion_details": [
				{"property": "工作性质", "fieldname": "employment_type", "current": "Probation", "new": "Full-time"},
				{"property": "转正日期", "fieldname": "final_confirmation_date", "current": "", "new": "2026-07-01"},
				{"property": "岗位", "fieldname": "designation", "current": "TEST-试用岗位", "new": "TEST-异动岗位"},
			],
		},
		key="转正管理 TEST-MOV-007",
		submit=True,
	)
	if promotion:
		_event(result, phase, "warnings", "Employee Promotion", promotion, "以标准 Promotion 属性变更表达转正确认")

	if not result["dry_run"]:
		current_department = frappe.db.get_value("Employee", moving_employee, "department")
		current_designation = frappe.db.get_value("Employee", moving_employee, "designation")
	else:
		current_department = _department_name("TEST-HRMS-DEPT")
		current_designation = "TEST-异动岗位"

	_create_if_missing(
		result,
		phase,
		"Employee Transfer",
		{"employee": moving_employee, "transfer_date": "2026-07-02", "docstatus": 1},
		{
			"employee": moving_employee,
			"company": TEST_COMPANY,
			"transfer_date": "2026-07-02",
			"transfer_details": [
				{"property": "部门", "fieldname": "department", "current": current_department, "new": _department_name("TEST-生产部")},
				{"property": "岗位", "fieldname": "designation", "current": current_designation, "new": "TEST-正式岗位"},
			],
		},
		key="人事异动-已生效-TEST-MOV-007",
		submit=True,
	)

	if regular:
		_create_if_missing(
			result,
			phase,
			"Employee Transfer",
			{"employee": regular, "transfer_date": "2026-07-03", "docstatus": 2},
			{
				"employee": regular,
				"company": TEST_COMPANY,
				"transfer_date": "2026-07-03",
				"transfer_details": [
					{
						"property": "岗位",
						"fieldname": "designation",
						"current": frappe.db.get_value("Employee", regular, "designation"),
						"new": "TEST-异动岗位",
					}
				],
			},
			key="人事异动-已撤销-TEST-REG-003",
			cancel=True,
		)

	_event(
		result,
		phase,
		"blocked",
		"Employee Transfer",
		"异动原因字段",
		"标准 Employee Transfer/Employee Property History 无原因字段；未虚造",
	)

	grievance_type = _create_if_missing(
		result,
		phase,
		"Grievance Type",
		{"name": "TEST-奖惩演示"},
		{"__newname": "TEST-奖惩演示", "description": "TEST-虚拟奖惩/申诉类型"},
		key="TEST-奖惩演示",
		allow_global=True,
	)
	if regular and grievance_type:
		grievance = _create_if_missing(
			result,
			phase,
			"Employee Grievance",
			{"subject": "TEST-奖惩记录演示", "raised_by": regular},
			{
				"subject": "TEST-奖惩记录演示",
				"raised_by": regular,
				"date": "2026-07-05",
				"status": "Open",
				"grievance_against_party": "Employee",
				"grievance_against": moving_employee,
				"grievance_type": grievance_type,
				"description": "TEST-虚拟奖惩/申诉记录，不涉及真实员工。",
			},
			key="奖惩记录 TEST-001",
		)
		_event(result, phase, "warnings", "Employee Grievance", grievance, "标准 DocType 语义为员工申诉，并非正式奖惩单")

	if leaver:
		_create_if_missing(
			result,
			phase,
			"Employee Separation",
			{"employee": leaver, "docstatus": 0},
			{
				"employee": leaver,
				"company": TEST_COMPANY,
				"boarding_begins_on": "2026-07-15",
				"boarding_status": "Pending",
				"notify_users_by_email": 0,
				"resignation_letter_date": "2026-07-01",
				"exit_interview": "TEST-待安排离职面谈",
			},
			key="离职管理 TEST-LEFT-008",
		)
		_create_if_missing(
			result,
			phase,
			"Exit Interview",
			{"employee": leaver, "docstatus": ("!=", 2)},
			{
				"employee": leaver,
				"company": TEST_COMPANY,
				"status": "Pending",
				"interview_summary": "TEST-待安排，不发送问卷。",
			},
			key="离职面谈 TEST-LEFT-008",
		)


def _seed_performance(result):
	phase = "performance"
	employee = _employee("TEST-REG-003")
	reviewer = _employee("TEST-MOV-007") or _employee("TEST-PRO-002")
	if not employee or not reviewer:
		_event(result, phase, "blocked", "Appraisal Cycle", "TEST-2099-Q1", "TEST employee/reviewer unavailable")
		return
	kra = _create_if_missing(
		result,
		phase,
		"KRA",
		{"name": "TEST-交付质量"},
		{"title": "TEST-交付质量", "description": "TEST-虚拟绩效目标"},
		key="TEST-交付质量",
		allow_global=True,
	)
	template = _create_if_missing(
		result,
		phase,
		"Appraisal Template",
		{"name": "TEST-2099年度绩效模板"},
		{
			"template_title": "TEST-2099年度绩效模板",
			"description": "TEST-虚拟绩效模板",
			"goals": [{"key_result_area": kra, "per_weightage": 100}],
		},
		key="TEST-2099年度绩效模板",
		allow_global=True,
	)
	cycle = _create_if_missing(
		result,
		phase,
		"Appraisal Cycle",
		{"name": "TEST-2099-Q1"},
		{
			"cycle_name": "TEST-2099-Q1",
			"company": TEST_COMPANY,
			"status": "In Progress",
			"start_date": "2099-01-01",
			"end_date": "2099-03-31",
			"kra_evaluation_method": "Manual Rating",
			"description": "TEST-虚拟绩效周期",
			"appraisees": [
				{
					"employee": employee,
					"appraisal_template": template,
				}
			],
		},
		key="TEST-2099-Q1",
	)
	if cycle and not str(cycle).startswith("DRY-RUN:"):
		appraisal = _create_if_missing(
			result,
			phase,
			"Appraisal",
			{"employee": employee, "appraisal_cycle": cycle, "docstatus": ("!=", 2)},
			{
				"naming_series": "HR-APR-.YYYY.-",
				"employee": employee,
				"company": TEST_COMPANY,
				"appraisal_cycle": cycle,
				"appraisal_template": template,
				"start_date": "2099-01-01",
				"end_date": "2099-03-31",
				"rate_goals_manually": 1,
				"goals": [{"kra": kra, "per_weightage": 100, "score": 4}],
				"remarks": "TEST-虚拟绩效结果",
			},
			key="TEST-REG-003/TEST-2099-Q1",
		)
		if appraisal:
			_create_if_missing(
				result,
				phase,
				"Employee Performance Feedback",
				{"employee": employee, "appraisal": appraisal, "reviewer": reviewer},
				{
					"employee": employee,
					"appraisal": appraisal,
					"reviewer": reviewer,
					"company": TEST_COMPANY,
					"appraisal_cycle": cycle,
					"added_on": "2099-03-31 17:00:00",
					"feedback": "TEST-目标完成，演示反馈。",
				},
				key="TEST-REG-003 feedback",
			)


def _seed_attendance(result):
	phase = "attendance"
	required = {
		"HRMS Monthly Attendance Summary": ("company", "attendance_month", "attendance_lock_version", "lock_status"),
	}
	missing = {}
	for doctype, fields in required.items():
		ok, absent = _has_fields(doctype, fields)
		if not ok:
			missing[doctype] = absent
	if missing:
		_event(
			result,
			phase,
			"blocked",
			"attendance company lock gate",
			DEMO_MONTH,
			json.dumps(missing, ensure_ascii=False),
		)
		return

	for item in _test_payroll_people():
		employee = _employee(item["number"])
		if not employee:
			_event(result, phase, "blocked", "HRMS Monthly Attendance Summary", item["number"], "TEST employee unavailable")
			continue
		standard, actual, ot_1_5, ot_2, ot_3, absent, large_night, small_night, apple_amount = item["attendance"]
		employee_doc = frappe.db.get_value(
			"Employee",
			employee,
			["employee_name", "department", "date_of_joining"],
			as_dict=True,
		) or {}
		values = {
			"company": TEST_COMPANY,
			"attendance_month": DEMO_MONTH,
			"attendance_lock_version": TEST_PAYROLL_LOCK_VERSION,
			"lock_status": "已锁定",
			"locked_by": frappe.session.user,
			"locked_on": now_datetime(),
			"source_batch_ids": "TEST-HRMS seed attendance",
			"source_checksum": _demo_source_trace("monthly_attendance", item["number"])[1],
			"employee": employee,
			"employee_code": item["number"],
			"employee_name": employee_doc.get("employee_name") or item["number"],
			"department": employee_doc.get("department"),
			"date_of_joining": employee_doc.get("date_of_joining"),
			"standard_hours": standard,
			"actual_attendance_hours": actual,
			"adjusted_working_hours": actual,
			"overtime_1_5_hours": ot_1_5,
			"overtime_2_hours": ot_2,
			"overtime_3_hours": ot_3,
			"leave_hours": max(standard - actual - absent, 0),
			"absent_hours": absent,
			"large_night_shift_count": large_night,
			"small_night_shift_count": small_night,
			"apple_reward_amount": apple_amount,
			"status": "已确认",
		}
		_create_if_missing(
			result,
			phase,
			"HRMS Monthly Attendance Summary",
			{
				"company": TEST_COMPANY,
				"attendance_month": DEMO_MONTH,
				"attendance_lock_version": TEST_PAYROLL_LOCK_VERSION,
				"employee": employee,
			},
			values,
			key=f"{item['number']} {DEMO_MONTH} {TEST_PAYROLL_LOCK_VERSION}",
		)


def _seed_payroll(result):
	phase = "payroll"
	required = {
		"HRMS Employee Salary Change": ("company", "employee"),
		"HRMS Payroll Variable Record": ("company", "employee", "payroll_month", "attendance_lock_version"),
		"HRMS Payroll Input Record": ("company", "employee", "payroll_month", "attendance_lock_version"),
		"HRMS Payroll Settlement Record": ("company", "employee", "payroll_month", "attendance_lock_version"),
	}
	missing = {}
	for doctype, fields in required.items():
		ok, absent = _has_fields(doctype, fields)
		if not ok:
			missing[doctype] = absent
	lock_ready, lock_missing = _has_fields(
		"HRMS Monthly Attendance Summary", ("company", "attendance_month", "attendance_lock_version", "lock_status")
	)
	if not lock_ready:
		missing["HRMS Monthly Attendance Summary"] = lock_missing
	if missing:
		_event(
			result,
			phase,
			"blocked",
			"payroll company lock gate",
			DEMO_MONTH,
			json.dumps(missing, ensure_ascii=False),
		)
		return

	for item in _test_payroll_people():
		employee = _employee(item["number"])
		if not employee:
			_event(result, phase, "blocked", "HRMS Employee Salary Change", item["number"], "TEST employee unavailable")
			continue
		employee_doc = frappe.db.get_value(
			"Employee",
			employee,
			["employee_name", "department", "designation", "date_of_joining"],
			as_dict=True,
		) or {}
		base, function_allowance, certificate_allowance, multi_skill_allowance = item["salary"]
		full_salary = base + function_allowance + certificate_allowance + multi_skill_allowance
		_create_if_missing(
			result,
			phase,
			"HRMS Employee Salary Change",
			{"company": TEST_COMPANY, "employee": employee, "effective_date": f"{DEMO_MONTH}-01"},
			{
				"company": TEST_COMPANY,
				"employee": employee,
				"employee_code": item["number"],
				"employee_name": employee_doc.get("employee_name") or item["number"],
				"department": employee_doc.get("department"),
				"designation": employee_doc.get("designation"),
				"date_of_joining": employee_doc.get("date_of_joining"),
				"effective_date": f"{DEMO_MONTH}-01",
				"change_reason": "TEST-HRMS 本地薪资主数据",
				"base_salary": base,
				"function_allowance": function_allowance,
				"certificate_allowance": certificate_allowance,
				"multi_skill_allowance": multi_skill_allowance,
				"full_salary": full_salary,
				"housing_fund_enabled": 1 if item["variables"].get("公积金个人") else 0,
				"social_insurance_enabled": 1 if item["variables"].get("社保个人") else 0,
				"status": "已批准",
				"source_file": "TEST-HRMS seed",
				"remarks": f"TEST-HRMS local editable salary seed {TEST_PAYROLL_LOCK_VERSION}",
			},
			key=f"{item['number']} salary",
		)

		for variable_type, amount in item["variables"].items():
			if variable_type == "离职薪资结算":
				continue
			source_sheet = "离职人员薪资结算" if item["number"] == "TEST-LEFT-008" and variable_type == "其他扣款" else "TEST-HRMS seed variable"
			trace, source_hash = _demo_source_trace(
				source_sheet,
				item["number"],
				{"variable_type": variable_type, "amount": amount},
			)
			_create_if_missing(
				result,
				phase,
				"HRMS Payroll Variable Record",
				{
					"company": TEST_COMPANY,
					"payroll_month": DEMO_MONTH,
					"attendance_lock_version": TEST_PAYROLL_LOCK_VERSION,
					"employee": employee,
					"variable_type": variable_type,
					"source_sheet": source_sheet,
				},
				{
					"company": TEST_COMPANY,
					"payroll_month": DEMO_MONTH,
					"attendance_lock_version": TEST_PAYROLL_LOCK_VERSION,
					"employee": employee,
					"employee_code": item["number"],
					"employee_name": employee_doc.get("employee_name") or item["number"],
					"department": employee_doc.get("department"),
					"variable_type": variable_type,
					"amount": amount,
					"source_sheet": source_sheet,
					"remarks": f"TEST-HRMS 本地可编辑变量：{variable_type}",
					"raw_row_json": json.dumps({"employee_number": item["number"], "variable_type": variable_type, "amount": amount}, ensure_ascii=False),
					"source_trace_json": trace,
					"source_hash": source_hash,
				},
				key=f"{item['number']} {variable_type}",
			)

	if result["dry_run"]:
		_event(result, phase, "planned", "HRMS Payroll Input Record", DEMO_MONTH, TEST_PAYROLL_LOCK_VERSION)
		_event(result, phase, "planned", "HRMS Payroll Settlement Record", DEMO_MONTH, TEST_PAYROLL_LOCK_VERSION)
		return

	try:
		from hrms.api.payroll_input import generate_payroll_input_records, generate_payroll_settlement_records

		input_result = generate_payroll_input_records(TEST_COMPANY, DEMO_MONTH, TEST_PAYROLL_LOCK_VERSION)
		settlement_result = generate_payroll_settlement_records(TEST_COMPANY, DEMO_MONTH, TEST_PAYROLL_LOCK_VERSION)
		_event(result, phase, "created", "HRMS Payroll Input Record", DEMO_MONTH, json.dumps(input_result, ensure_ascii=False, default=str))
		_event(result, phase, "created", "HRMS Payroll Settlement Record", DEMO_MONTH, json.dumps(settlement_result, ensure_ascii=False, default=str))
	except Exception as exc:
		_event(result, phase, "blocked", "payroll calculation", DEMO_MONTH, f"{type(exc).__name__}: {exc}")


def _phase_functions():
	return OrderedDict(
		(
			("foundation", _seed_foundation),
			("employees", _seed_employees),
			("training", _seed_training),
			("recruitment", _seed_recruitment),
			("personnel_lists", _seed_personnel_lists),
			("performance", _seed_performance),
			("attendance", _seed_attendance),
			("payroll", _seed_payroll),
		)
	)


def _selected_phases(phases):
	if not phases:
		return list(PHASES)
	if isinstance(phases, str):
		try:
			parsed = json.loads(phases)
			phases = parsed if isinstance(parsed, list) else [item.strip() for item in phases.split(",")]
		except Exception:
			phases = [item.strip() for item in phases.split(",")]
	selected = [phase for phase in phases if phase in PHASES]
	unknown = [phase for phase in phases if phase not in PHASES]
	if unknown:
		frappe.throw(f"Unknown demo seed phases: {', '.join(unknown)}")
	return selected


@frappe.whitelist()
def get_test_hrms_demo_status():
	"""Read-only inventory and capability status."""
	result = _new_result(dry_run=True)
	result["protected"] = _protected_snapshot()
	result["payroll_scope"] = {
		"company": TEST_COMPANY,
		"payroll_month": DEMO_MONTH,
		"attendance_lock_version": TEST_PAYROLL_LOCK_VERSION,
	}
	result["inventory"] = {
		"company_exists": bool(frappe.db.exists("Company", TEST_COMPANY)),
		"employees": frappe.get_all(
			"Employee",
			filters={"company": TEST_COMPANY},
			fields=["name", "employee_name", "employee_number", "employment_type", "status"],
			order_by="employee_number asc",
		),
		"departments": frappe.get_all(
			"Department",
			filters={"company": TEST_COMPANY},
			fields=["name", "department_name"],
			order_by="name asc",
		),
		"designations": frappe.get_all(
			"Designation", filters={"name": ("like", "TEST-%")}, fields=["name"], order_by="name asc"
		),
	}
	_seed_attendance(result)
	_seed_payroll(result)
	return result


def _demo_filters_for_doctype(doctype):
	if doctype == "Company":
		return {"name": TEST_COMPANY}
	if doctype == "Department":
		return {"company": TEST_COMPANY}
	if doctype == "Employee":
		return {"company": TEST_COMPANY}
	if doctype == "HRMS Monthly Attendance Summary":
		return {
			"company": TEST_COMPANY,
			"attendance_month": DEMO_MONTH,
			"attendance_lock_version": TEST_PAYROLL_LOCK_VERSION,
		}
	if doctype == "HRMS Employee Salary Change":
		return {"company": TEST_COMPANY}
	if doctype in (
		"HRMS Payroll Variable Record",
		"HRMS Payroll Welfare Source Record",
		"HRMS Payroll Input Record",
		"HRMS Payroll Settlement Record",
	):
		return {
			"company": TEST_COMPANY,
			"payroll_month": DEMO_MONTH,
			"attendance_lock_version": TEST_PAYROLL_LOCK_VERSION,
		}
	return {}


def _doctype_route(doctype, name):
	return f"/app/{frappe.scrub(doctype).replace('_', '-')}/{name}"


@frappe.whitelist()
def get_test_hrms_demo_records(doctype: str = "", page_length: int = 200):
	"""List local TEST-HRMS seed records with Frappe edit routes."""
	doctypes = [doctype] if doctype else list(DEMO_EDITABLE_DOCTYPES)
	rows = []
	for current in doctypes:
		if current not in DEMO_EDITABLE_DOCTYPES:
			frappe.throw(f"Unsupported TEST-HRMS demo doctype: {current}")
		if not _doctype_exists(current):
			rows.append({"doctype": current, "blocked": "DocType missing"})
			continue
		meta = frappe.get_meta(current)
		fields = ["name", "modified"]
		for field in (
			"company",
			"employee",
			"employee_name",
			"employee_number",
			"employee_code",
			"department",
			"attendance_month",
			"payroll_month",
			"attendance_lock_version",
			"lock_status",
			"calculation_status",
			"settlement_status",
			"variable_type",
			"amount",
		):
			if meta.has_field(field) and field not in fields:
				fields.append(field)
		for row in frappe.get_all(
			current,
			filters=_demo_filters_for_doctype(current),
			fields=fields,
			order_by="modified desc",
			limit_page_length=int(page_length or 200),
		):
			row = dict(row)
			row["doctype"] = current
			row["edit_route"] = _doctype_route(current, row["name"])
			rows.append(row)
	return {
		"company": TEST_COMPANY,
		"payroll_month": DEMO_MONTH,
		"attendance_lock_version": TEST_PAYROLL_LOCK_VERSION,
		"editable_doctypes": DEMO_EDITABLE_DOCTYPES,
		"rows": rows,
	}


@frappe.whitelist()
def reset_test_hrms_payroll_seed(confirm: str = "", dry_run: int | str = 0):
	"""Delete only TEST-HRMS local payroll seed records for the demo month/version."""
	if confirm != "RESET TEST-HRMS PAYROLL":
		frappe.throw('必须传入 confirm="RESET TEST-HRMS PAYROLL" 才会清空本地薪酬 seed。')
	result = {
		"company": TEST_COMPANY,
		"payroll_month": DEMO_MONTH,
		"attendance_lock_version": TEST_PAYROLL_LOCK_VERSION,
		"dry_run": bool(int(dry_run or 0)),
		"deleted": OrderedDict(),
	}
	targets = (
		("HRMS Payroll Settlement Record", _demo_filters_for_doctype("HRMS Payroll Settlement Record")),
		("HRMS Payroll Input Record", _demo_filters_for_doctype("HRMS Payroll Input Record")),
		("HRMS Payroll Variable Record", _demo_filters_for_doctype("HRMS Payroll Variable Record")),
		("HRMS Payroll Welfare Source Record", _demo_filters_for_doctype("HRMS Payroll Welfare Source Record")),
		("HRMS Monthly Attendance Summary", _demo_filters_for_doctype("HRMS Monthly Attendance Summary")),
		("HRMS Employee Salary Change", {"company": TEST_COMPANY, "source_file": "TEST-HRMS seed"}),
	)
	for doctype, filters in targets:
		if not _doctype_exists(doctype):
			result["deleted"][doctype] = {"blocked": "DocType missing", "records": []}
			continue
		names = frappe.get_all(doctype, filters=filters, pluck="name")
		result["deleted"][doctype] = {"count": len(names), "records": names}
		if not result["dry_run"]:
			for name in names:
				frappe.delete_doc(doctype, name, ignore_permissions=True, force=True)
	if not result["dry_run"]:
		frappe.db.commit()
	return result


@frappe.whitelist()
def seed_test_hrms_demo(phases: str | list | None = None, dry_run: int | str = 0):
	"""Create missing TEST-HRMS demo records without updating existing records."""
	result = _new_result(dry_run=dry_run)
	before = _protected_snapshot()
	result["protected_before"] = before
	try:
		for phase, handler in _phase_functions().items():
			if phase in _selected_phases(phases):
				handler(result)
		after = _assert_protected_unchanged(before)
		result["protected_after"] = after
		if not result["dry_run"]:
			frappe.db.commit()
		result["completed_at"] = str(now_datetime())
		result["summary"] = {
			phase: {bucket: len(items) for bucket, items in data.items()}
			for phase, data in result["phases"].items()
		}
		return result
	except Exception:
		if not result["dry_run"]:
			frappe.db.rollback()
		raise
