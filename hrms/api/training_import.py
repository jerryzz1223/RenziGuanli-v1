"""Controlled import for the 2026 training plan and actual education records."""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime, time, timedelta
from html import escape

import frappe
from frappe import _
from frappe.utils import flt, now_datetime

from hrms.access_control import require_hrms_capability
from hrms.hr.training_importer import (
	parse_plan_workbook,
	parse_record_workbook,
	preview_token,
	text,
	workbook_digest,
)


def _file(file_url):
	name = frappe.db.get_value("File", {"file_url": file_url}, "name")
	if not name:
		frappe.throw(_("未找到上传文件：{0}").format(file_url))
	doc = frappe.get_doc("File", name)
	content = doc.get_content()
	if isinstance(content, str):
		content = content.encode()
	return doc, content


def _company(company):
	if not company or not frappe.db.exists("Company", company):
		frappe.throw(_("请选择有效公司。"))
	if not frappe.has_permission("Company", "read", company):
		frappe.throw(_("无权使用该公司的培训数据。"), frappe.PermissionError)
	return company


def _department_display(value):
	value = text(value)
	if not value:
		return ""
	department_name = frappe.db.get_value("Department", value, "department_name")
	if department_name:
		return text(department_name)
	return re.sub(r"\s+-\s+[^-]+$", "", value).strip()


def _department_link(company, business_name):
	business_name = text(business_name)
	if not business_name:
		return ""
	return (
		frappe.db.get_value("Department", {"company": company, "name": business_name}, "name")
		or frappe.db.get_value("Department", {"company": company, "department_name": business_name}, "name")
		or ""
	)


def _employee_directory(company):
	if not frappe.db.has_column("Employee", "custom_employee_code"):
		frappe.throw(_("员工主档尚未配置公司工号字段，不能导入培训人员记录。"))
	fields = ["name", "employee_name", "department", "status", "date_of_joining", "relieving_date"]
	fields.append("custom_employee_code")
	rows = frappe.get_all(
		"Employee",
		filters={"company": company},
		fields=fields,
		order_by="employee_name asc, custom_employee_code asc",
		limit_page_length=0,
	)
	for row in rows:
		row["employee_code"] = text(row.get("custom_employee_code"))
		row["department_display"] = _department_display(row.get("department"))
	return rows


def _covers_training_dates(employee, training_dates):
	if not training_dates or not employee.get("employee_code"):
		return False
	joined = employee.get("date_of_joining")
	relieved = employee.get("relieving_date")
	if joined and not hasattr(joined, "year"):
		joined = datetime.fromisoformat(text(joined)).date()
	if relieved and not hasattr(relieved, "year"):
		relieved = datetime.fromisoformat(text(relieved)).date()
	return all((not joined or joined <= day) and (not relieved or day <= relieved) for day in training_dates)


def _identity_preview(records, employees):
	counts = Counter(row["identity_key"] for row in records["rows"])
	dates_by_identity = defaultdict(set)
	for record in records["rows"]:
		for value in record["actual_dates"]:
			dates_by_identity[record["identity_key"]].add(datetime.fromisoformat(value).date())
	by_name = defaultdict(list)
	for employee in employees:
		by_name[text(employee.get("employee_name"))].append(employee)
	items = []
	for identity_key in sorted(counts):
		employee_name, source_department = identity_key.split("|", 1)
		name_matches = by_name.get(employee_name, [])
		exact = [row for row in name_matches if row.get("department_display") == source_department]
		training_dates = sorted(dates_by_identity[identity_key])
		period_matches = [row for row in name_matches if _covers_training_dates(row, training_dates)]
		proposed = exact[0] if len(exact) == 1 and exact[0].get("employee_code") else None
		match_basis = "name_department" if proposed else ""
		if not proposed and len(period_matches) == 1:
			proposed = period_matches[0]
			match_basis = "employment_period"
		if proposed:
			status = "matched"
		elif len(exact) == 1:
			status = "missing_code"
		elif len(exact) > 1:
			status = "ambiguous"
		elif name_matches:
			status = "department_mismatch"
		else:
			status = "unmatched"
		items.append(
			{
				"identity_key": identity_key,
				"employee_name": employee_name,
				"source_department": source_department,
				"record_count": counts[identity_key],
				"status": status,
				"match_basis": match_basis,
				"employee_code": proposed.get("employee_code") if proposed else "",
				"candidates": [
					{
						"employee_code": row.get("employee_code"),
						"employee_name": row.get("employee_name"),
						"department": row.get("department_display"),
						"status": row.get("status"),
						"date_of_joining": text(row.get("date_of_joining")),
						"relieving_date": text(row.get("relieving_date")),
					}
					for row in name_matches
				],
			}
		)
	return items


def _preview(plan_file_url, record_file_url, company):
	plan_file, plan_content = _file(plan_file_url)
	record_file, record_content = _file(record_file_url)
	plan = parse_plan_workbook(plan_content)
	records = parse_record_workbook(record_content)
	identities = _identity_preview(records, _employee_directory(company))
	plan_errors = sum(bool(row["errors"]) for row in plan["rows"])
	record_errors = sum(bool(row["errors"]) for row in records["rows"])
	unresolved = sum(item["record_count"] for item in identities if item["status"] != "matched")
	plan_digest = workbook_digest(plan_content)
	record_digest = workbook_digest(record_content)
	return {
		"company": company,
		"plan_file": {"file_url": plan_file.file_url, "file_name": plan_file.file_name, "sha256": plan_digest},
		"record_file": {"file_url": record_file.file_url, "file_name": record_file.file_name, "sha256": record_digest},
		"plan": {
			"sheet_name": plan["sheet_name"],
			"year": plan["plan_year"],
			"row_count": len(plan["rows"]),
			"error_count": plan_errors,
			"planned_count": sum(row["classification"] == "计划" for row in plan["rows"]),
			"temporary_count": sum(row["classification"] == "临时" for row in plan["rows"]),
			"missing_hours": sum(row["course_hours"] is None for row in plan["rows"]),
			"sample_rows": plan["rows"][:8],
		},
		"records": {
			"sheet_name": records["sheet_name"],
			"row_count": len(records["rows"]),
			"event_count": len(records["events"]),
			"error_count": record_errors,
			"scored_count": sum(bool(row["score_text"]) for row in records["rows"]),
			"sample_events": [
				{
					"actual_date_text": event["actual_date_text"],
					"content": event["content"],
					"participant_count": len(event["participants"]),
					"owner_department": event["owner_department"],
					"instructor": event["instructor"],
				}
				for event in records["events"][:8]
			],
		},
		"identities": identities,
		"unresolved_record_count": unresolved,
		"blocking_error_count": plan_errors + record_errors + unresolved,
		"plan_token": preview_token(company, plan_digest, record_digest, plan["rows"], records["rows"]),
		"_plan": plan,
		"_records": records,
	}


@frappe.whitelist()
def preview_training_workbooks(plan_file_url: str, record_file_url: str, company: str):
	require_hrms_capability("training_submit", legacy_roles=("HR Manager",))
	_company(company)
	preview = _preview(plan_file_url, record_file_url, company)
	preview.pop("_plan", None)
	preview.pop("_records", None)
	return preview


def _identity_selection(identity_map, preview):
	if isinstance(identity_map, str):
		try:
			identity_map = json.loads(identity_map)
		except json.JSONDecodeError:
			frappe.throw(_("员工工号映射格式不正确。"))
	identity_map = identity_map or {}
	expected = {item["identity_key"]: item for item in preview["identities"]}
	selected = {}
	errors = []
	for key, item in expected.items():
		code = text(identity_map.get(key) or item.get("employee_code"))
		if not code:
			errors.append(_("{0}（{1}）未指定公司工号").format(item["employee_name"], item["source_department"]))
			continue
		rows = frappe.get_all(
			"Employee",
			filters={"company": preview["company"], "custom_employee_code": code},
			fields=["name", "employee_name", "custom_employee_code", "department", "status"],
			limit_page_length=2,
		)
		if len(rows) != 1:
			errors.append(_("公司工号 {0} 在当前公司中未唯一匹配员工").format(code))
			continue
		employee = rows[0]
		if text(employee.employee_name) != item["employee_name"]:
			errors.append(_("公司工号 {0} 对应姓名 {1}，与来源姓名 {2} 不一致").format(code, employee.employee_name, item["employee_name"]))
			continue
		selected[key] = employee
	if errors:
		frappe.throw(_("员工身份映射未通过：<br>{0}").format("<br>".join(escape(item) for item in errors[:50])))
	return selected


def _training_category(course_type, mode):
	if "外" in text(mode) or "外部" in text(course_type):
		return "外部培训"
	if "安全" in text(course_type) or "环保" in text(course_type):
		return "安全教育"
	if "岗位" in text(course_type) or "职位能力" in text(course_type):
		return "岗位资格"
	return "内部培训"


def _training_mode(value):
	return "外部" if "外" in text(value) else "内部"


def _event_type(course_type, courseware):
	if "实操" in text(courseware):
		return "Workshop"
	if "会议" in text(course_type) or "月会" in text(course_type):
		return "Conference"
	if "考试" in text(courseware):
		return "Exam"
	return "Theory"


def _source_rows_text(rows):
	rows = sorted(set(int(item) for item in rows))
	if not rows:
		return ""
	parts = []
	start = previous = rows[0]
	for item in rows[1:]:
		if item == previous + 1:
			previous = item
			continue
		parts.append(str(start) if start == previous else f"{start}-{previous}")
		start = previous = item
	parts.append(str(start) if start == previous else f"{start}-{previous}")
	return "、".join(parts)


def _plan_title(row):
	base = _("{0}（{1}·{2}·第{3}行）").format(row["content"], row["plan_year"], row["department"], row["source_row"])
	return base if len(base) <= 140 else f"{base[:128]}…{row['source_key'][-8:]}"


def _plan_description(row):
	audiences = "；".join(f"{item['unit']}：{item['requirement']}" for item in row["audience_matrix"])
	return "<br>".join(
		f"<strong>{escape(label)}</strong>：{escape(text(value) or '—')}"
		for label, value in (
			("培训内容", row["content"]),
			("主要培训岗位/人员", row["target"]),
			("召集部门", row["convener_department"]),
			("地点", row["location"]),
			("课程对象矩阵", audiences),
			("备注", row["remarks"]),
		)
	)


def _upsert_program(company, source_file, source_digest, row):
	values = {
		"training_program": _plan_title(row),
		"status": "Scheduled",
		"approval_status": "Draft",
		"company": company,
		"owner_department": _department_link(company, row["department"]),
		"plan_period": f"{row['plan_year']} {row['planned_month']}".strip(),
		"training_category": _training_category(row["training_type"], row["internal_external"]),
		"training_mode": _training_mode(row["internal_external"]),
		"trainer_name": row["convener"],
		"description": _plan_description(row),
		"source_import_key": row["source_key"],
		"source_file": source_file,
		"source_sheet": "2026年计划总表",
		"source_row": row["source_row"],
		"source_fingerprint": source_digest,
		"source_department": row["department"],
		"source_classification": row["classification"],
		"source_training_type": row["training_type"],
		"source_course_hours": row["course_hours"],
		"source_convener_department": row["convener_department"],
		"source_location": row["location"],
		"source_target": row["target"],
		"source_planned_month": row["planned_month"],
		"source_actual_dates": row["actual_dates_text"],
		"source_audience_matrix": json.dumps(row["audience_matrix"], ensure_ascii=False),
		"source_imported_by": frappe.session.user,
		"source_imported_on": now_datetime(),
	}
	existing = frappe.db.get_value("Training Program", {"source_import_key": row["source_key"]}, "name")
	if existing:
		doc = frappe.get_doc("Training Program", existing)
		if doc.company != company:
			frappe.throw(_("培训计划来源键跨公司冲突：{0}").format(row["source_key"]))
		if doc.approval_status != "Draft":
			return doc, "locked"
		doc.update(values)
		doc.save(ignore_permissions=True)
		return doc, "updated"
	doc = frappe.get_doc({"doctype": "Training Program", **values}).insert(ignore_permissions=True)
	return doc, "created"


def _event_name(event):
	date_label = "、".join(event["actual_dates"]) or event["actual_date_text"]
	base = f"{date_label}｜{event['content']}｜{event['instructor']}"
	suffix = event["source_key"][-6:]
	return f"{base[:132]}｜{suffix}" if len(base) > 132 else f"{base}｜{suffix}"


def _event_introduction(event):
	return "<br>".join(
		f"<strong>{escape(label)}</strong>：{escape(text(value) or '—')}"
		for label, value in (
			("培训内容", event["content"]),
			("来源日期", event["actual_date_text"]),
			("课程归属部门", event["owner_department"]),
			("课件方式", event["courseware"]),
			("培训对象", event["target"]),
		)
	)


def _insert_event_and_result(company, source_file, source_digest, event, identities, program_by_content):
	existing = frappe.db.get_value("Training Event", {"source_import_key": event["source_key"]}, "name")
	if existing:
		return existing, "existing", bool(frappe.db.exists("Training Result", {"training_event": existing}))
	start_day = datetime.fromisoformat(event["actual_dates"][0]).date()
	start_time = datetime.combine(start_day, time.min)
	end_time = start_time + timedelta(hours=max(flt(event["hours"]), 1))
	participants = []
	result_rows = []
	for row in event["participants"]:
		employee = identities[row["identity_key"]]
		participants.append(
			{
				"employee": employee.name,
				"employee_code": employee.custom_employee_code,
				"status": "Completed",
				"attendance": "Present",
				"source_row": row["source_row"],
			}
		)
		result_rows.append(
			{
				"employee": employee.name,
				"employee_code": employee.custom_employee_code,
				"hours": row["hours"],
				"score": row["score"],
				"grade": row["score_text"] if row["score"] is None else "",
				"assessment_result": "Pass",
				"needs_retraining": 0,
				"comments": row["remarks"],
				"source_row": row["source_row"],
				"source_month": row["month"],
				"source_employee_name": row["employee_name"],
				"source_department": row["department"],
				"source_study_hours": row["study_hours"],
			}
		)
	programs = program_by_content.get(event["content"], [])
	program = programs[0] if len(programs) == 1 else ""
	doc = frappe.get_doc(
		{
			"doctype": "Training Event",
			"event_name": _event_name(event),
			"training_program": program,
			"event_status": "Completed",
			"type": _event_type(event["course_type"], event["courseware"]),
			"company": company,
			"training_category": _training_category(event["course_type"], event["internal_external"]),
			"training_mode": _training_mode(event["internal_external"]),
			"trainer_name": event["instructor"],
			"course": event["content"],
			"location": event["location"],
			"start_time": start_time,
			"end_time": end_time,
			"introduction": _event_introduction(event),
			"employees": participants,
			"source_import_key": event["source_key"],
			"source_file": source_file,
			"source_sheet": event["source_sheet"],
			"source_rows": _source_rows_text(event["source_rows"]),
			"source_fingerprint": source_digest,
			"source_actual_dates": event["actual_date_text"],
			"source_date_only": 1,
			"source_owner_department": event["owner_department"],
			"source_course_type": event["course_type"],
			"source_courseware": event["courseware"],
			"source_course_hours": event["hours"],
			"source_target": event["target"],
			"source_imported_by": frappe.session.user,
			"source_imported_on": now_datetime(),
		}
	).insert(ignore_permissions=True)
	doc.submit()
	result = frappe.get_doc({"doctype": "Training Result", "training_event": doc.name, "employees": result_rows})
	result.insert(ignore_permissions=True)
	return doc.name, "created", True


@frappe.whitelist()
def import_training_workbooks(
	plan_file_url: str,
	record_file_url: str,
	company: str,
	plan_token: str,
	identity_map: str = "",
	confirm_import: int = 0,
):
	require_hrms_capability("training_submit", legacy_roles=("HR Manager",))
	_company(company)
	if not int(confirm_import or 0):
		frappe.throw(_("请先预览并明确确认导入。"))
	preview = _preview(plan_file_url, record_file_url, company)
	if plan_token != preview["plan_token"]:
		frappe.throw(_("文件或预览结果已变化，请重新预览后再导入。"))
	if preview["plan"]["error_count"] or preview["records"]["error_count"]:
		frappe.throw(_("来源表仍有结构或数据错误，不能导入。"))
	identities = _identity_selection(identity_map, preview)

	plan_counts = Counter()
	event_counts = Counter()
	result_count = 0
	program_by_content = defaultdict(list)
	previous_import_flag = getattr(frappe.flags, "in_import", False)
	frappe.flags.in_import = True
	try:
		for row in preview["_plan"]["rows"]:
			doc, outcome = _upsert_program(company, plan_file_url, preview["plan_file"]["sha256"], row)
			plan_counts[outcome] += 1
			program_by_content[row["content"]].append(doc.name)
		for event in preview["_records"]["events"]:
			_event_name_value, outcome, has_result = _insert_event_and_result(
				company,
				record_file_url,
				preview["record_file"]["sha256"],
				event,
				identities,
				program_by_content,
			)
			event_counts[outcome] += 1
			result_count += int(outcome == "created" and has_result)
		frappe.db.commit()
	except Exception:
		frappe.db.rollback()
		raise
	finally:
		frappe.flags.in_import = previous_import_flag
	return {
		"company": company,
		"plan_rows": len(preview["_plan"]["rows"]),
		"programs_created": plan_counts["created"],
		"programs_updated": plan_counts["updated"],
		"programs_locked": plan_counts["locked"],
		"events_created": event_counts["created"],
		"events_existing": event_counts["existing"],
		"results_created_as_draft": result_count,
		"participant_records": len(preview["_records"]["rows"]),
		"message": _("培训计划和实际培训记录已导入。培训结果保留为草稿，复核并提交后才沉淀员工技能。"),
	}
