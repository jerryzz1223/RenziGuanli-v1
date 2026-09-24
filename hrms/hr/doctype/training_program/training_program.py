# Copyright (c) 2017, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


import json
import re
from collections import defaultdict

import frappe
from frappe.model.document import Document
from frappe.utils import add_days, cint, nowdate

from hrms.access_control import require_hrms_capability
from hrms.hr.training_importer import match_training_events, parse_dates, text


class TrainingProgram(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		amended_from: DF.Link | None
		company: DF.Link
		contact_number: DF.Data | None
		description: DF.TextEditor
		status: DF.Literal["Scheduled", "Completed", "Cancelled"]
		supplier: DF.Link | None
		trainer_email: DF.Data | None
		trainer_name: DF.Data | None
		training_program: DF.Data
	# end: auto-generated types

	pass


def _dashboard_company(company: str | None = None):
	"""Return a company that the current user may use for training summaries."""
	company = company or frappe.defaults.get_user_default("Company")
	if not company:
		return None
	if not frappe.has_permission("Company", "read", company):
		frappe.throw("无权查看该公司的培训数据", frappe.PermissionError)
	return company


def _attendance_summary(company):
	"""Aggregate attendee outcomes from submitted training results only."""
	return frappe.db.sql(
		"""
			select
				coalesce(sum(case when employee.needs_retraining = 1 then 1 else 0 end), 0) as retraining_count,
				coalesce(sum(case when employee.assessment_result in ('Fail', 'Absent') then 1 else 0 end), 0) as exception_count
			from `tabTraining Result Employee` employee
			inner join `tabTraining Result` result on result.name = employee.parent
			inner join `tabTraining Event` event on event.name = result.training_event
			where result.docstatus = 1 and event.company = %(company)s
		""",
		{"company": company},
		as_dict=True,
	)[0]


def _program_source_content(row):
	if row.get("source_content"):
		return text(row.source_content)
	return re.sub(r"（20\d{2}·.+?·第\d+行）$", "", text(row.training_program)).strip()


def _training_plan_sources(company):
	programs = frappe.get_all(
		"Training Program",
		filters={"company": company},
		fields=[
			"name", "training_program", "status", "approval_status", "owner_department", "plan_period",
			"source_import_key", "source_content", "source_department", "source_classification",
			"source_training_type", "source_course_hours", "source_planned_month", "training_mode",
			"trainer_name", "source_convener_department", "source_location", "source_target",
			"source_actual_dates", "source_audience_matrix", "source_file", "source_sheet", "source_row",
			"source_imported_by", "source_imported_on",
		],
		limit_page_length=0,
	)
	plan_rows = []
	program_by_key = {}
	for row in programs:
		if not row.source_import_key:
			continue
		row.source_content = _program_source_content(row)
		plan_rows.append(
			{
				"source_key": row.source_import_key,
				"content": row.source_content,
				"department": row.source_department,
				"classification": row.source_classification or "计划",
				"training_type": row.source_training_type,
				"course_hours": row.source_course_hours,
				"planned_month": row.source_planned_month,
				"internal_external": "外" if row.training_mode == "外部" else "内",
			}
		)
		program_by_key[row.source_import_key] = row
	return programs, plan_rows, program_by_key


def _training_event_sources(company):
	events = frappe.get_all(
		"Training Event",
		filters={"company": company, "docstatus": ["<", 2]},
		fields=[
			"name", "event_name", "event_status", "training_program", "course", "start_time", "location",
			"source_import_key", "source_owner_department", "source_course_type", "source_course_hours",
			"source_actual_dates", "training_mode", "plan_match_status", "plan_match_basis", "plan_match_score",
			"trainer_name", "source_courseware", "source_target", "source_file", "source_sheet", "source_rows",
			"source_imported_by", "source_imported_on",
		],
		limit_page_length=0,
	)
	event_rows = []
	for row in events:
		if not row.source_import_key:
			continue
		dates = parse_dates(row.source_actual_dates, row.start_time.year if row.start_time else 2026)
		if not dates and row.start_time:
			dates = [row.start_time.date()]
		event_rows.append(
			{
				"source_key": row.source_import_key,
				"content": row.course or row.event_name,
				"owner_department": row.source_owner_department,
				"course_type": row.source_course_type,
				"hours": row.source_course_hours,
				"actual_dates": [item.isoformat() for item in dates],
				"internal_external": "外" if row.training_mode == "外部" else "内",
			}
		)
	return events, event_rows


def _plan_reconciliation(company):
	programs, plan_rows, program_by_key = _training_plan_sources(company)
	events, event_rows = _training_event_sources(company)
	matches = {item["event_key"]: item for item in match_training_events(plan_rows, event_rows)}
	program_name_by_key = {key: row.name for key, row in program_by_key.items()}
	for item in matches.values():
		for candidate in item["candidates"]:
			candidate["program"] = program_name_by_key.get(candidate["plan_key"], "")
	return programs, events, matches, program_by_key


@frappe.whitelist()
def reconcile_training_plan_matches(company: str, confirm: int = 0):
	"""Rebuild imported actual-to-plan links while preserving manual decisions."""
	require_hrms_capability("training_submit", legacy_roles=("HR Manager",))
	company = _dashboard_company(company)
	programs, events, matches, program_by_key = _plan_reconciliation(company)
	counts = defaultdict(int)
	if not int(confirm or 0):
		for item in matches.values():
			counts[item["status"]] += 1
		return {"matched": counts["matched"], "review": counts["review"], "temporary": counts["temporary"]}

	for program in programs:
		if program.source_import_key and not program.source_content:
			frappe.db.set_value("Training Program", program.name, "source_content", _program_source_content(program), update_modified=False)
	for event in events:
		if not event.source_import_key or event.plan_match_basis == "人工确认":
			continue
		match = matches[event.source_import_key]
		program = program_by_key.get(match.get("plan_key")) if match.get("plan_key") else None
		if event.training_program and not program:
			program = next((row for row in programs if row.name == event.training_program), None)
		if program and (program.source_classification or "计划") == "计划":
			status = "已匹配计划"
		elif program:
			status = "临时新增"
		elif match["status"] == "review":
			status = "待确认"
		else:
			status = "临时新增"
		frappe.db.set_value(
			"Training Event",
			event.name,
			{
				"training_program": program.name if program else "",
				"plan_match_status": status,
				"plan_match_basis": match["basis"] if not event.training_program else "已有课程关联",
				"plan_match_score": match["score"],
			},
			update_modified=False,
		)
		counts[status] += 1
	frappe.db.commit()
	return {"matched": counts["已匹配计划"], "review": counts["待确认"], "temporary": counts["临时新增"]}


@frappe.whitelist()
def set_training_event_plan_match(event_name: str, training_program: str = "", mark_temporary: int = 0):
	require_hrms_capability("training_submit", legacy_roles=("HR Manager",))
	event = frappe.get_doc("Training Event", event_name)
	company = _dashboard_company(event.company)
	if int(mark_temporary or 0):
		values = {"training_program": "", "plan_match_status": "临时新增", "plan_match_basis": "人工确认", "plan_match_score": 0}
	else:
		if not training_program:
			frappe.throw("请选择培训计划，或明确标记为临时新增。")
		program_company = frappe.db.get_value("Training Program", training_program, "company")
		if program_company != company:
			frappe.throw("培训计划与实际上课记录不属于同一公司。")
		classification = frappe.db.get_value("Training Program", training_program, "source_classification") or "计划"
		values = {
			"training_program": training_program,
			"plan_match_status": "已匹配计划" if classification == "计划" else "临时新增",
			"plan_match_basis": "人工确认",
			"plan_match_score": 100,
		}
	frappe.db.set_value("Training Event", event.name, values)
	return {"name": event.name, **values}


@frappe.whitelist()
def get_training_plan_management(company: str | None = None):
	if not frappe.has_permission("Training Program", "read"):
		frappe.throw("无权查看培训计划管理数据", frappe.PermissionError)
	company = _dashboard_company(company)
	if not company:
		return {"metrics": {}, "rows": []}
	programs, events, matches, program_by_key = _plan_reconciliation(company)
	participant_counts = {
		row.parent: int(row.participant_count or 0)
		for row in frappe.db.sql(
			"""select parent, count(name) participant_count from `tabTraining Event Employee`
			where parenttype = 'Training Event' group by parent""",
			as_dict=True,
		)
	}
	events_by_program = defaultdict(list)
	for event in events:
		if event.training_program:
			events_by_program[event.training_program].append(event)
	rows = []
	for program in programs:
		linked = events_by_program.get(program.name, [])
		classification = program.source_classification or "计划"
		if classification == "临时":
			status = "临时课程"
		elif any(item.event_status == "Completed" for item in linked):
			status = "已实施"
		else:
			status = "待实施"
		rows.append(
			{
				"key": f"program:{program.name}", "kind": "plan", "status": status,
				"course": _program_source_content(program), "department": program.source_department,
				"planned_month": program.source_planned_month, "classification": classification,
				"training_type": program.source_training_type, "training_mode": program.training_mode,
				"course_hours": program.source_course_hours, "convener": program.trainer_name,
				"convener_department": program.source_convener_department, "location": program.source_location,
				"target": program.source_target, "source_row": program.source_row,
				"program": program.name, "event": "", "event_count": len(linked),
				"participant_count": sum(participant_counts.get(item.name, 0) for item in linked),
				"actual_dates": "；".join(filter(None, (item.source_actual_dates for item in linked))),
				"actual_courses": "；".join(dict.fromkeys(item.course or item.event_name for item in linked)),
				"match_basis": "；".join(dict.fromkeys(item.plan_match_basis for item in linked if item.plan_match_basis)),
				"candidates": [],
			}
		)
	for event in events:
		if event.training_program:
			continue
		match = matches.get(event.source_import_key, {})
		status = event.plan_match_status or ("待确认" if match.get("status") == "review" else "临时新增")
		rows.append(
			{
				"key": f"event:{event.name}", "kind": "actual", "status": status,
				"course": event.course or event.event_name, "department": event.source_owner_department,
				"planned_month": "", "classification": "实际发生", "program": "", "event": event.name,
				"training_type": event.source_course_type, "training_mode": event.training_mode,
				"course_hours": event.source_course_hours, "convener": event.trainer_name,
				"convener_department": event.source_owner_department, "location": event.location,
				"target": event.source_target, "source_row": event.source_rows,
				"event_count": 1, "participant_count": participant_counts.get(event.name, 0),
				"actual_dates": event.source_actual_dates, "actual_courses": event.course or event.event_name,
				"match_basis": event.plan_match_basis or match.get("basis", ""),
				"match_score": event.plan_match_score or match.get("score", 0),
				"candidates": match.get("candidates", []),
			}
		)
	planned = [row for row in rows if row["kind"] == "plan" and row["classification"] == "计划"]
	program_classification = {program.name: (program.source_classification or "计划") for program in programs}
	temporary_event_count = 0
	review_event_count = 0
	for event in events:
		status = event.plan_match_status
		if not status and event.training_program:
			status = "临时新增" if program_classification.get(event.training_program) == "临时" else "已匹配计划"
		elif not status:
			status = "待确认" if matches.get(event.source_import_key, {}).get("status") == "review" else "临时新增"
		temporary_event_count += status == "临时新增"
		review_event_count += status == "待确认"
	return {
		"metrics": {
			"planned_courses": len(planned),
			"implemented_plans": sum(row["status"] == "已实施" for row in planned),
			"pending_plans": sum(row["status"] == "待实施" for row in planned),
			"temporary_events": temporary_event_count,
			"review_matches": review_event_count,
		},
		"rows": rows,
	}


def _json_list(value):
	if not value:
		return []
	try:
		parsed = json.loads(value)
		return parsed if isinstance(parsed, list) else []
	except (TypeError, ValueError):
		return []


def _event_details(event_names):
	if not event_names:
		return []
	events = frappe.get_all(
		"Training Event",
		filters={"name": ["in", event_names], "docstatus": ["<", 2]},
		fields=[
			"name", "event_name", "event_status", "training_program", "course", "company", "training_category",
			"training_mode", "type", "trainer_name", "location", "start_time", "end_time",
			"source_owner_department", "source_course_type", "source_courseware", "source_course_hours",
			"source_target", "source_actual_dates", "plan_match_status", "plan_match_basis", "plan_match_score",
			"source_file", "source_sheet", "source_rows", "source_imported_by", "source_imported_on",
		],
		order_by="start_time desc",
		limit_page_length=0,
	)
	participants = frappe.get_all(
		"Training Event Employee",
		filters={"parent": ["in", event_names], "parenttype": "Training Event"},
		fields=["parent", "employee_code", "employee_name", "department", "status", "attendance", "source_row"],
		order_by="parent asc, idx asc",
		limit_page_length=0,
	)
	result_names = frappe.get_all(
		"Training Result",
		filters={"training_event": ["in", event_names], "docstatus": ["<", 2]},
		fields=["name", "training_event", "docstatus"],
		limit_page_length=0,
	)
	result_event = {row.name: row.training_event for row in result_names}
	result_rows = []
	if result_event:
		result_rows = frappe.get_all(
			"Training Result Employee",
			filters={"parent": ["in", list(result_event)]},
			fields=[
				"parent", "employee_code", "employee_name", "department", "score", "assessment_result",
				"needs_retraining", "source_study_hours", "comments", "source_row",
			],
			limit_page_length=0,
		)
	result_by_event_employee = {
		(result_event.get(row.parent), row.employee_code or row.employee_name): row for row in result_rows
	}
	participants_by_event = defaultdict(list)
	for row in participants:
		result = result_by_event_employee.get((row.parent, row.employee_code or row.employee_name))
		participants_by_event[row.parent].append(
			{
				"employee_code": row.employee_code, "employee_name": row.employee_name, "department": row.department,
				"status": row.status, "attendance": row.attendance, "source_row": row.source_row,
				"score": result.score if result else None,
				"assessment_result": result.assessment_result if result else "",
				"needs_retraining": result.needs_retraining if result else 0,
				"study_hours": result.source_study_hours if result else None,
				"comments": result.comments if result else "",
			}
		)
	for event in events:
		event["participants"] = participants_by_event.get(event.name, [])
		event["participant_count"] = len(event["participants"])
	return events


@frappe.whitelist()
def get_training_plan_detail(kind: str, name: str, company: str | None = None):
	"""Return a presentation-oriented plan/actual detail without exposing the native form."""
	if not frappe.has_permission("Training Program", "read"):
		frappe.throw("无权查看培训计划详情", frappe.PermissionError)
	company = _dashboard_company(company)
	if kind == "plan":
		program = frappe.get_doc("Training Program", name)
		if program.company != company:
			frappe.throw("该培训计划不属于当前公司。")
		event_names = frappe.get_all(
			"Training Event", filters={"company": company, "training_program": program.name, "docstatus": ["<", 2]},
			pluck="name", limit_page_length=0,
		)
		events = _event_details(event_names)
		classification = program.source_classification or "计划"
		status = "临时课程" if classification == "临时" else ("已实施" if events else "待实施")
		return {
			"kind": "plan", "name": program.name, "title": _program_source_content(program), "status": status,
			"company": company, "department": program.source_department, "classification": classification,
			"training_type": program.source_training_type, "training_mode": program.training_mode,
			"course_hours": program.source_course_hours, "convener": program.trainer_name,
			"convener_department": program.source_convener_department, "location": program.source_location,
			"target": program.source_target, "planned_month": program.source_planned_month,
			"source_actual_dates": program.source_actual_dates, "audience_matrix": _json_list(program.source_audience_matrix),
			"events": events, "event_count": len(events),
			"participant_count": sum(row.participant_count for row in events),
			"source": {
				"file": program.source_file, "sheet": program.source_sheet, "row": program.source_row,
				"imported_by": program.source_imported_by, "imported_on": program.source_imported_on,
			},
		}
	if kind == "actual":
		event = frappe.get_doc("Training Event", name)
		if event.company != company:
			frappe.throw("该实际上课记录不属于当前公司。")
		events = _event_details([event.name])
		detail = events[0]
		program = None
		if event.training_program:
			program = frappe.db.get_value(
				"Training Program", event.training_program,
				["name", "source_content", "source_department", "source_planned_month", "source_classification"],
				as_dict=True,
			)
		return {
			"kind": "actual", "name": event.name, "title": event.course or event.event_name,
			"status": event.plan_match_status or "临时新增", "company": company,
			"department": event.source_owner_department, "classification": "实际发生",
			"training_type": event.source_course_type, "training_mode": event.training_mode,
			"course_hours": event.source_course_hours, "convener": event.trainer_name,
			"convener_department": event.source_owner_department, "location": event.location,
			"target": event.source_target, "planned_month": "", "audience_matrix": [],
			"events": events, "event_count": 1, "participant_count": detail.participant_count,
			"matched_program": program, "match_basis": event.plan_match_basis, "match_score": event.plan_match_score,
			"source": {
				"file": event.source_file, "sheet": event.source_sheet, "row": event.source_rows,
				"imported_by": event.source_imported_by, "imported_on": event.source_imported_on,
			},
		}
	frappe.throw("未识别的培训详情类型。")


@frappe.whitelist()
def get_training_learning_dashboard(company: str | None = None, include_plan_management: int = 1):
	"""Read-only operational summary for the training home page."""
	if not frappe.has_permission("Training Program", "read"):
		frappe.throw("无权查看培训学习数据", frappe.PermissionError)
	company = _dashboard_company(company)
	if not company:
		return {"metrics": {}, "upcoming_events": [], "risks": []}

	today = nowdate()
	soon = add_days(today, 30)
	metrics = {
		"total_programs": frappe.db.count("Training Program", {"company": company}),
		"active_programs": frappe.db.count("Training Program", {"company": company, "status": "Scheduled"}),
		"scheduled_events": frappe.db.count("Training Event", {"company": company, "event_status": "Scheduled"}),
		"completed_events": frappe.db.count("Training Event", {"company": company, "event_status": "Completed"}),
		"feedback_count": frappe.db.sql(
			"""
				select count(feedback.name)
				from `tabTraining Feedback` feedback
				inner join `tabTraining Event` event on event.name = feedback.training_event
				where feedback.docstatus < 2 and event.company = %(company)s
			""",
			{"company": company},
		)[0][0],
		"retraining_due": frappe.db.count(
			"Training Event",
			{"company": company, "retraining_due_on": ["between", [today, soon]]},
		),
	}
	attendance = _attendance_summary(company)
	metrics["retraining_count"] = int(attendance.retraining_count or 0)
	metrics["exception_count"] = int(attendance.exception_count or 0)

	upcoming_events = frappe.get_all(
		"Training Event",
		filters={"company": company, "event_status": "Scheduled", "start_time": [">=", today]},
		fields=["name", "event_name", "training_program", "start_time", "location", "training_category", "qualification_gate"],
		order_by="start_time asc",
		limit_page_length=5,
	)

	risks = []
	if metrics["retraining_due"]:
		risks.append({"tone": "warning", "title": "复训临期", "value": metrics["retraining_due"], "detail": "未来 30 天内有培训需要安排复训"})
	if metrics["retraining_count"]:
		risks.append({"tone": "danger", "title": "补训待处理", "value": metrics["retraining_count"], "detail": "已提交结果中标记为需要补训的员工"})
	if metrics["exception_count"]:
		risks.append({"tone": "danger", "title": "考核异常", "value": metrics["exception_count"], "detail": "已提交结果中不合格或缺考的员工"})
	if not risks:
		risks.append({"tone": "success", "title": "当前无高风险待办", "value": 0, "detail": "可从培训计划开始安排下一轮培训"})

	plan_management = get_training_plan_management(company)
	metrics.update(plan_management["metrics"])
	result = {"metrics": metrics, "upcoming_events": upcoming_events, "risks": risks}
	if cint(include_plan_management):
		result["plan_management"] = plan_management
	return result
