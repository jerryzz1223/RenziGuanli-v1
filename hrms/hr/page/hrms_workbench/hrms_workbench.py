import calendar
from datetime import date

import frappe
from frappe.utils import add_days, getdate, nowdate


def _doctype_exists(doctype):
	return frappe.db.exists("DocType", doctype)


def _has_field(doctype, fieldname):
	if not _doctype_exists(doctype):
		return False
	meta = frappe.get_meta(doctype)
	return meta.has_field(fieldname) or fieldname == "name"


def _count(doctype, filters=None):
	if not _doctype_exists(doctype):
		return 0
	try:
		return frappe.db.count(doctype, filters=filters or {})
	except Exception:
		return 0


def _safe_filters(doctype, filters):
	return {field: value for field, value in (filters or {}).items() if _has_field(doctype, field)}


def _count_with_safe_filters(doctype, filters=None):
	return _count(doctype, _safe_filters(doctype, filters))


def _count_today(doctype, date_field, filters=None):
	if not _has_field(doctype, date_field):
		return 0
	safe_filters = _safe_filters(doctype, filters)
	safe_filters[date_field] = nowdate()
	return _count(doctype, safe_filters)


def _calendar_days(today):
	_, days_in_month = calendar.monthrange(today.year, today.month)
	start_weekday = date(today.year, today.month, 1).weekday()
	days = []

	for _ in range(start_weekday):
		days.append({"label": "", "day": "", "is_today": False, "is_weekend": False})

	for day in range(1, days_in_month + 1):
		current = date(today.year, today.month, day)
		days.append(
			{
				"label": str(day),
				"day": day,
				"lunar": "",
				"is_today": current == today,
				"is_weekend": current.weekday() >= 5,
			}
		)

	return days


def _recent_policy_items():
	items = []
	if _doctype_exists("Newsletter"):
		for row in frappe.get_all("Newsletter", fields=["name", "subject", "modified"], order_by="modified desc", limit=4):
			items.append({"date": frappe.format(row.modified, {"fieldtype": "Date"}), "title": row.subject or row.name})

	if items:
		return items

	return [
		{"date": "11-13", "title": "关于执行《工伤保险条例》若干问题的意见"},
		{"date": "08-01", "title": "最高法发布劳动争议典型案例"},
		{"date": "07-31", "title": "关于审理劳动争议案件适用法律问题的解释"},
		{"date": "05-13", "title": "劳动能力鉴定管理办法"},
	]


def _route(label, route, icon):
	return {"label": label, "route": route, "icon": icon}


def _format_date(value):
	if not value:
		return ""
	return frappe.format(value, {"fieldtype": "Date"})


def _format_datetime(value):
	if not value:
		return ""
	return frappe.format(value, {"fieldtype": "Datetime"})


def _as_int(value, default=0):
	try:
		return int(value)
	except Exception:
		return default


def _page_args(start=0, page_length=20):
	start = max(_as_int(start), 0)
	page_length = min(max(_as_int(page_length, 20), 5), 100)
	return start, page_length


def _like_filters(search, fields):
	if not search:
		return []
	search = f"%{search}%"
	return [[field, "like", search] for field in fields]


def _or_filters(search, fields):
	conditions = _like_filters(search, fields)
	if len(conditions) <= 1:
		return conditions
	return conditions


def _count_related(doctype, filters):
	if not _doctype_exists(doctype):
		return 0
	try:
		return frappe.db.count(doctype, filters)
	except Exception:
		return 0


def _get_list(doctype, fields, filters=None, or_filters=None, order_by="modified desc", start=0, page_length=20):
	if not _doctype_exists(doctype):
		return []
	return frappe.get_list(
		doctype,
		fields=[field for field in fields if _has_field(doctype, field) or field == "name"],
		filters=_safe_filters(doctype, filters or {}),
		or_filters=or_filters or [],
		order_by=order_by,
		start=start,
		page_length=page_length,
	)


def _get_count(doctype, filters=None, or_filters=None):
	if not _doctype_exists(doctype):
		return 0
	safe_filters = _safe_filters(doctype, filters or {})
	if not or_filters:
		return frappe.db.count(doctype, safe_filters)
	return len(
		frappe.get_list(
			doctype,
			fields=["name"],
			filters=safe_filters,
			or_filters=or_filters or [],
			page_length=100000,
		)
	)


def _dataset(title, doctype, columns, rows, total=0, start=0, page_length=20, statuses=None, primary_action=None):
	return {
		"title": title,
		"doctype": doctype,
		"columns": columns,
		"rows": rows,
		"total": total,
		"start": start,
		"page_length": page_length,
		"statuses": statuses or [],
		"primary_action": primary_action,
	}


def _module_configs():
	return {
		"people": {
			"title": "员工花名册",
			"doctype": "Employee",
			"new_route": ["Form", "Employee", "new-employee"],
			"new_label": "添加员工",
			"search_fields": ["name", "employee_name", "cell_number", "department", "designation"],
			"fields": [
				("姓名", "employee_name"),
				("工号", "name"),
				("部门", "department"),
				("岗位", "designation"),
				("工作性质", "employment_type"),
				("入职日期", "date_of_joining", "date"),
				("状态", "status"),
				("手机号", "cell_number"),
			],
			"status_field": "status",
			"statuses": [("在职", "Active"), ("已离职", "Left"), ("停用", "Inactive")],
		},
		"organization": {
			"title": "组织管理",
			"doctype": "Department",
			"new_route": ["Form", "Department", "new-department"],
			"new_label": "新增组织",
			"search_fields": ["name", "department_name", "parent_department", "company"],
			"fields": [
				("组织名称", "department_name"),
				("上级组织", "parent_department"),
				("所属公司", "company"),
				("是否分组", "is_group"),
				("最近更新", "modified", "datetime"),
			],
		},
		"recruitment": {
			"title": "招聘职位",
			"doctype": "Job Opening",
			"new_route": ["Form", "Job Opening", "new-job-opening"],
			"new_label": "添加招聘职位",
			"search_fields": ["name", "job_title", "department", "designation", "status"],
			"fields": [
				("职位名称", "job_title"),
				("部门", "department"),
				("岗位", "designation"),
				("状态", "status"),
				("发布日期", "posted_on", "date"),
				("截止日期", "closes_on", "date"),
				("最近更新", "modified", "datetime"),
			],
			"status_field": "status",
			"statuses": [("开放", "Open"), ("关闭", "Closed")],
		},
		"attendance": {
			"title": "每日考勤",
			"doctype": "Attendance",
			"new_route": ["Form", "Attendance", "new-attendance"],
			"new_label": "新增考勤",
			"search_fields": ["name", "employee", "employee_name", "department", "status"],
			"fields": [
				("员工", "employee_name"),
				("工号", "employee"),
				("部门", "department"),
				("考勤日期", "attendance_date", "date"),
				("状态", "status"),
				("上班时间", "in_time", "datetime"),
				("下班时间", "out_time", "datetime"),
				("工时", "working_hours"),
			],
			"status_field": "status",
			"statuses": [("出勤", "Present"), ("缺勤", "Absent"), ("请假", "On Leave"), ("半天", "Half Day")],
		},
		"payroll": {
			"title": "月工资表",
			"doctype": "Salary Slip",
			"new_route": ["Form", "Salary Slip", "new-salary-slip"],
			"new_label": "添加工资表",
			"search_fields": ["name", "employee", "employee_name", "department", "status"],
			"fields": [
				("工资单", "name"),
				("员工", "employee_name"),
				("工号", "employee"),
				("部门", "department"),
				("开始日期", "start_date", "date"),
				("结束日期", "end_date", "date"),
				("应发工资", "gross_pay", "currency"),
				("实发工资", "net_pay", "currency"),
				("状态", "status"),
			],
			"status_field": "status",
			"statuses": [("草稿", "Draft"), ("已提交", "Submitted"), ("已取消", "Cancelled")],
		},
		"approval": {
			"title": "审批表单",
			"doctype": "Workflow",
			"new_route": ["Form", "Workflow", "new-workflow"],
			"new_label": "新建审批表单",
			"search_fields": ["name", "workflow_name", "document_type"],
			"fields": [
				("审批名称", "workflow_name"),
				("关联单据", "document_type"),
				("启用", "is_active"),
				("最近更新", "modified", "datetime"),
			],
			"status_field": "is_active",
			"statuses": [("启用", "1"), ("停用", "0")],
		},
		"training": {
			"title": "培训计划",
			"doctype": "Training Program",
			"new_route": ["Form", "Training Program", "new-training-program"],
			"new_label": "新增培训计划",
			"search_fields": ["name", "training_program", "description", "status"],
			"fields": [
				("培训计划", "training_program"),
				("状态", "status"),
				("说明", "description"),
				("最近更新", "modified", "datetime"),
			],
			"status_field": "status",
			"statuses": [("计划中", "Planned"), ("完成", "Completed"), ("取消", "Cancelled")],
		},
	}


def _format_module_value(value, formatter=None):
	if formatter == "date":
		return _format_date(value)
	if formatter == "datetime":
		return _format_datetime(value)
	if formatter == "currency" and value not in (None, ""):
		return frappe.format(value, {"fieldtype": "Currency"})
	if value is None:
		return ""
	return value


def _module_status_counts(config, base_filters):
	status_field = config.get("status_field")
	statuses = config.get("statuses") or []
	if not status_field or not _has_field(config["doctype"], status_field):
		return []

	items = [{"label": "全部", "value": "", "count": _get_count(config["doctype"], filters=base_filters)}]
	for label, value in statuses:
		filters = dict(base_filters)
		filters[status_field] = _as_int(value) if str(value).isdigit() else value
		items.append({"label": label, "value": value, "count": _get_count(config["doctype"], filters=filters)})
	return items


@frappe.whitelist()
def get_module_view(module: str, search: str = "", status: str = "", start: int = 0, page_length: int = 20):
	start, page_length = _page_args(start, page_length)
	config = _module_configs().get(module)
	if not config:
		frappe.throw("未知模块")

	doctype = config["doctype"]
	if not _doctype_exists(doctype):
		return _dataset(
			config["title"],
			doctype,
			[],
			[],
			start=start,
			page_length=page_length,
			primary_action={"label": config.get("new_label") or "新建", "route": config.get("new_route")},
		)

	search = (search or "").strip()
	status = (status or "").strip()
	base_filters = {}
	status_field = config.get("status_field")
	if status and status_field and _has_field(doctype, status_field):
		base_filters[status_field] = _as_int(status) if status.isdigit() else status

	search_fields = [field for field in config.get("search_fields", []) if _has_field(doctype, field)]
	or_filters = _or_filters(search, search_fields) if search else []
	fieldnames = ["name", "modified"]
	for _, fieldname, *_ in config.get("fields", []):
		if fieldname not in fieldnames:
			fieldnames.append(fieldname)

	records = _get_list(
		doctype,
		fieldnames,
		filters=base_filters,
		or_filters=or_filters,
		start=start,
		page_length=page_length,
	)

	rows = []
	for row in records:
		cells = []
		for _, fieldname, *rest in config.get("fields", []):
			cells.append(_format_module_value(row.get(fieldname), rest[0] if rest else None))
		rows.append({"name": row.name, "route": ["Form", doctype, row.name], "cells": cells})

	return _dataset(
		config["title"],
		doctype,
		[label for label, *_ in config.get("fields", [])],
		rows,
		total=_get_count(doctype, filters=base_filters, or_filters=or_filters),
		start=start,
		page_length=page_length,
		statuses=_module_status_counts(config, {}),
		primary_action={"label": config.get("new_label") or "新建", "route": config.get("new_route")},
	)


def _appraisal_cycle_rows(records):
	rows = []
	for row in records:
		name = row.get("name")
		total = _count_related("Appraisal", {"appraisal_cycle": name})
		completed = _count_related("Appraisal", {"appraisal_cycle": name, "docstatus": 1})
		draft = _count_related("Appraisal", {"appraisal_cycle": name, "docstatus": 0})
		rows.append(
			{
				"name": name,
				"route": ["Form", "Appraisal Cycle", name],
				"cells": [
					row.get("cycle_name") or name,
					row.get("status") or "",
					total,
					completed,
					draft,
					row.get("kra_evaluation_method") or "",
					f"{_format_date(row.get('start_date'))} 至 {_format_date(row.get('end_date'))}",
					frappe.utils.strip_html(row.get("description") or "") or "暂无说明",
				],
			}
		)
	return rows


def _performance_overview(start, page_length):
	recent = _get_list(
		"Appraisal Cycle",
		["name", "cycle_name", "status", "start_date", "end_date"],
		order_by="end_date desc",
		start=0,
		page_length=1,
	)
	cycle = recent[0] if recent else frappe._dict()
	cycle_name = cycle.get("name")
	appraisals = []
	if cycle_name and _doctype_exists("Appraisal"):
		appraisals = frappe.get_list(
			"Appraisal",
			fields=["name", "employee", "employee_name", "department", "appraisal_template", "docstatus", "final_score", "total_score"],
			filters={"appraisal_cycle": cycle_name},
			start=start,
			page_length=page_length,
			order_by="modified desc",
		)

	rows = []
	for row in appraisals:
		score = row.get("final_score") or row.get("total_score") or ""
		status = "已完成" if row.get("docstatus") == 1 else "未提交"
		rows.append(
			{
				"name": row.name,
				"route": ["Form", "Appraisal", row.name],
				"cells": [
					row.get("employee_name") or row.get("employee") or "",
					row.get("department") or "",
					row.get("appraisal_template") or "",
					status,
					"--",
					score,
					"",
				],
			}
		)

	total = _count_related("Appraisal", {"appraisal_cycle": cycle_name}) if cycle_name else 0
	completed = _count_related("Appraisal", {"appraisal_cycle": cycle_name, "docstatus": 1}) if cycle_name else 0
	return _dataset(
		"绩效概览",
		"Appraisal",
		["姓名", "部门", "所属考核计划", "考核状态", "待处理人", "评分", "等级"],
		rows,
		total=total,
		start=start,
		page_length=page_length,
		statuses=[{"label": "全部", "value": "", "count": total}, {"label": "已完成", "value": "completed", "count": completed}, {"label": "未提交", "value": "draft", "count": max(total - completed, 0)}],
		primary_action={"label": "发起考核", "route": ["Form", "Appraisal Cycle", "new-appraisal-cycle"]},
	)


def _performance_plan(view, search, status, start, page_length):
	filters = {}
	if view == "performance_history":
		filters["status"] = "Completed"
	elif status:
		filters["status"] = status
	or_filters = _or_filters(search, ["name", "cycle_name"]) if search else []
	records = _get_list(
		"Appraisal Cycle",
		["name", "cycle_name", "status", "start_date", "end_date", "kra_evaluation_method", "description"],
		filters=filters,
		or_filters=or_filters,
		order_by="end_date desc",
		start=start,
		page_length=page_length,
	)
	total = _get_count("Appraisal Cycle", filters=filters, or_filters=or_filters)
	statuses = [
		{"label": "全部", "value": "", "count": _count_related("Appraisal Cycle", {})},
		{"label": "未开始", "value": "Not Started", "count": _count_related("Appraisal Cycle", {"status": "Not Started"})},
		{"label": "进行中", "value": "In Progress", "count": _count_related("Appraisal Cycle", {"status": "In Progress"})},
		{"label": "已完成", "value": "Completed", "count": _count_related("Appraisal Cycle", {"status": "Completed"})},
	]
	return _dataset(
		"历史绩效考核" if view == "performance_history" else "绩效考核",
		"Appraisal Cycle",
		["考核计划名称", "状态", "考核人数", "完成人数", "未提交人数", "考核方式", "考核周期", "考核说明"],
		_appraisal_cycle_rows(records),
		total=total,
		start=start,
		page_length=page_length,
		statuses=statuses,
		primary_action={"label": "新增考核计划", "route": ["Form", "Appraisal Cycle", "new-appraisal-cycle"]},
	)


def _performance_archive(search, status, start, page_length):
	filters = {}
	if status:
		filters["docstatus"] = _as_int(status)
	or_filters = _or_filters(search, ["employee", "employee_name", "department", "designation", "appraisal_cycle"]) if search else []
	records = _get_list(
		"Appraisal",
		["name", "employee", "employee_name", "department", "designation", "appraisal_cycle", "final_score", "total_score", "docstatus"],
		filters=filters,
		or_filters=or_filters,
		order_by="modified desc",
		start=start,
		page_length=page_length,
	)
	rows = []
	for row in records:
		score = row.get("final_score") or row.get("total_score") or ""
		rows.append(
			{
				"name": row.name,
				"route": ["Form", "Appraisal", row.name],
				"cells": [
					row.get("employee_name") or row.get("employee") or "",
					row.get("employee") or "",
					row.get("department") or "",
					row.get("designation") or "",
					"已提交" if row.get("docstatus") == 1 else "草稿",
					row.get("appraisal_cycle") or "",
					score,
					"",
					1,
				],
			}
		)
	return _dataset(
		"员工绩效档案",
		"Appraisal",
		["姓名", "工号", "部门", "岗位", "员工状态", "最近考核计划", "最近绩效评分", "最近绩效等级", "考核次数"],
		rows,
		total=_get_count("Appraisal", filters=filters, or_filters=or_filters),
		start=start,
		page_length=page_length,
		statuses=[{"label": "全部", "value": "", "count": _count_related("Appraisal", {})}, {"label": "草稿", "value": "0", "count": _count_related("Appraisal", {"docstatus": 0})}, {"label": "已提交", "value": "1", "count": _count_related("Appraisal", {"docstatus": 1})}],
	)


def _performance_template(search, start, page_length):
	or_filters = _or_filters(search, ["name", "template_title", "description"]) if search else []
	records = _get_list(
		"Appraisal Template",
		["name", "template_title", "description", "modified", "owner"],
		or_filters=or_filters,
		order_by="modified desc",
		start=start,
		page_length=page_length,
	)
	rows = []
	for row in records:
		rows.append(
			{
				"name": row.name,
				"route": ["Form", "Appraisal Template", row.name],
				"cells": [
					row.get("template_title") or row.name,
					"KPI考核",
					"",
					row.get("owner") or "",
					_format_datetime(row.get("modified")),
				],
			}
		)
	return _dataset(
		"考核模板库",
		"Appraisal Template",
		["模板名称", "考核方式", "总分", "创建人", "最近更新时间"],
		rows,
		total=_get_count("Appraisal Template", or_filters=or_filters),
		start=start,
		page_length=page_length,
		primary_action={"label": "新建考核模板", "route": ["Form", "Appraisal Template", "new-appraisal-template"]},
	)


def _performance_kra(search, start, page_length):
	or_filters = _or_filters(search, ["name", "title", "description"]) if search else []
	records = _get_list(
		"KRA",
		["name", "title", "description", "modified", "owner"],
		or_filters=or_filters,
		order_by="modified desc",
		start=start,
		page_length=page_length,
	)
	return _dataset(
		"指标库",
		"KRA",
		["指标名称", "说明", "创建人", "最近更新时间"],
		[
			{
				"name": row.name,
				"route": ["Form", "KRA", row.name],
				"cells": [row.get("title") or row.name, row.get("description") or "", row.get("owner") or "", _format_datetime(row.get("modified"))],
			}
			for row in records
		],
		total=_get_count("KRA", or_filters=or_filters),
		start=start,
		page_length=page_length,
		primary_action={"label": "新建指标", "route": ["Form", "KRA", "new-kra"]},
	)


def _performance_feedback(search, start, page_length):
	or_filters = _or_filters(search, ["employee", "employee_name", "department", "appraisal", "reviewer_name"]) if search else []
	records = _get_list(
		"Employee Performance Feedback",
		["name", "employee", "employee_name", "department", "appraisal", "reviewer_name", "total_score", "added_on"],
		or_filters=or_filters,
		order_by="modified desc",
		start=start,
		page_length=page_length,
	)
	return _dataset(
		"绩效面谈记录",
		"Employee Performance Feedback",
		["员工", "部门", "考核", "面谈人/评审人", "评分", "时间"],
		[
			{
				"name": row.name,
				"route": ["Form", "Employee Performance Feedback", row.name],
				"cells": [row.get("employee_name") or row.get("employee") or "", row.get("department") or "", row.get("appraisal") or "", row.get("reviewer_name") or "", row.get("total_score") or "", _format_datetime(row.get("added_on"))],
			}
			for row in records
		],
		total=_get_count("Employee Performance Feedback", or_filters=or_filters),
		start=start,
		page_length=page_length,
	)


@frappe.whitelist()
def get_performance_view(
	view: str = "performance_overview",
	search: str = "",
	status: str = "",
	start: int = 0,
	page_length: int = 20,
):
	start, page_length = _page_args(start, page_length)
	view = view or "performance_overview"
	search = (search or "").strip()
	status = (status or "").strip()

	if view == "performance_overview":
		return _performance_overview(start, page_length)
	if view in ("performance_plan", "performance_history", "performance_probation", "performance_promotion", "performance_group"):
		return _performance_plan(view, search, status, start, page_length)
	if view in ("performance_archive", "performance_assessment"):
		return _performance_archive(search, status, start, page_length)
	if view == "performance_template":
		return _performance_template(search, start, page_length)
	if view == "performance_indicators":
		return _performance_kra(search, start, page_length)
	if view in ("performance_interview", "performance_team", "performance_custom", "performance_log"):
		return _performance_feedback(search, start, page_length)

	return _performance_overview(start, page_length)


@frappe.whitelist()
def get_data():
	today = getdate(nowdate())
	weekdays = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]

	employee_total = _count("Employee")
	active_employees = _count_with_safe_filters("Employee", {"status": "Active"})
	left_employees = _count_with_safe_filters("Employee", {"status": "Left"})
	inactive_employees = _count_with_safe_filters("Employee", {"status": "Inactive"})

	open_jobs = _count_with_safe_filters("Job Opening", {"status": "Open"})
	today_interviews = _count_today("Interview", "scheduled_on")
	today_attendance = _count_today("Attendance", "attendance_date")
	today_absent = _count_with_safe_filters("Attendance", {"attendance_date": nowdate(), "status": "Absent"})
	today_late = _count_with_safe_filters("Attendance", {"attendance_date": nowdate(), "late_entry": 1})
	today_early = _count_with_safe_filters("Attendance", {"attendance_date": nowdate(), "early_exit": 1})
	open_leave = _count_with_safe_filters("Leave Application", {"status": "Open"})
	approved_leave = _count_with_safe_filters("Leave Application", {"status": "Approved"})

	onboarding = _count_with_safe_filters("Employee Onboarding", {"boarding_status": "Pending"})
	separation = _count_with_safe_filters("Employee Separation", {"boarding_status": "Pending"})

	return {
		"today": {
			"day": today.day,
			"weekday": weekdays[today.weekday()],
			"date_label": frappe.format(today, {"fieldtype": "Date"}),
			"month_title": f"{today.year}年{today.month}月",
			"calendar_days": _calendar_days(today),
			"pending_count": open_leave + open_jobs,
		},
		"quick_entries": [
			_route("邀请员工加入", ["List", "User"], "users"),
			_route("健康上报", ["List", "Employee Health Insurance"], "heart"),
			_route("导入花名册", ["List", "Data Import"], "upload"),
			_route("添加员工", ["Form", "Employee", "new-employee"], "user-plus"),
			_route("办理入职", ["List", "Employee Onboarding"], "log-in"),
			_route("办理转正", ["List", "Employee Promotion"], "check-circle"),
			_route("招聘门户", ["List", "Job Opening"], "briefcase"),
			_route("假勤助手", ["List", "Leave Application"], "calendar"),
			_route("人事库", ["List", "Employee"], "database"),
			_route("考勤导入中心", ["attendance-import-center"], "upload"),
			_route("每日考勤核对", ["attendance-import-center", "daily"], "calendar"),
			_route("考勤异常处理", ["attendance-import-center", "exceptions"], "alert-triangle"),
			_route("月度考勤终稿", ["attendance-import-center", "monthly"], "file-text"),
			_route("薪酬管理中心", ["payroll-input-center", "monthly-payroll"], "database"),
			_route("员工薪资", ["payroll-input-center", "employee-salary"], "users"),
			_route("月工资表", ["payroll-input-center", "monthly-payroll"], "file-text"),
			_route("工资发放", ["payroll-input-center", "payroll-disbursement"], "credit-card"),
			_route("计薪规则", ["payroll-input-center", "salary-rules"], "settings"),
			_route("薪资规则", ["payroll-input-center", "salary-rules"], "settings"),
			_route("薪资主数据", ["payroll-input-center", "salary-master"], "database"),
			_route("福利扣款来源中心", ["payroll-input-center", "welfare-sources"], "credit-card"),
			_route("数据闭环导入", ["payroll-input-center", "data-closure"], "upload"),
			_route("薪资输入中心", ["payroll-input-center"], "database"),
			_route("变量导入", ["payroll-input-center", "variables"], "upload"),
			_route("薪资输入表", ["payroll-input-center", "inputs"], "file-text"),
			_route("薪资结算表", ["payroll-input-center", "settlements"], "file-spreadsheet"),
			_route("薪酬报表", ["payroll-input-center", "payroll-reports"], "bar-chart"),
			_route("薪酬分析", ["payroll-input-center", "payroll-analysis"], "trending-up"),
			_route("年终奖计算", ["payroll-input-center", "annual-bonus"], "gift"),
			_route("发送工资条", ["payroll-input-center", "salary-slips"], "send"),
		],
		"common_tools": [
			_route("人力成本变化速算", ["query-report", "Salary Register"], "trending-up"),
			_route("人事计算器", ["List", "Salary Structure"], "calculator"),
			_route("社保计算器", ["List", "Employee Benefit Application"], "credit-card"),
			_route("人事常用表格", ["List", "File"], "table"),
		],
		"cards": {
			"recruitment": {"open_jobs": open_jobs, "interviews": today_interviews},
			"attendance": {
				"checkins": today_attendance,
				"exceptions": today_absent + today_late + today_early,
				"late": today_late,
				"early": today_early,
				"absent": today_absent,
			},
			"onboarding": {"count": onboarding},
			"regularization": {"count": 0},
			"resignation": {"count": separation},
			"leave": {"open": open_leave, "approved": approved_leave},
		},
		"right_rail": {
			"risk_level": "正常" if employee_total else "暂无数据",
			"reminders": {
				"birthdays": _count_with_safe_filters("Employee", {"date_of_birth": nowdate()}),
				"work_anniversaries": _count_with_safe_filters("Employee", {"date_of_joining": nowdate()}),
				"contracts": 0,
				"onboarding": onboarding,
			},
			"overview": {
				"total": employee_total,
				"active": active_employees,
				"probation": _count_with_safe_filters("Employee", {"employment_type": "Probation"}),
				"left": left_employees,
				"inactive": inactive_employees,
			},
		},
		"policy_items": _recent_policy_items(),
	}
