"""Persistent orchestration for the three manually uploaded attendance sources.

This module intentionally does not change ``attendance_import.py``.  It owns a
small, auditable workflow backed by existing import batches plus one unified
processing-record DocType.  Each source produces one processed dataset and all
uncertain records share the same review contract.
"""

from __future__ import annotations

import hashlib
import json
from calendar import monthrange
from collections import defaultdict
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any

import frappe
from frappe import _
from frappe.utils import cint, now_datetime

from hrms.api.attendance_processors.apple_tree import AppleTreeRules, preflight_apple_tree_rows, process_apple_tree_rows
from hrms.api.attendance_processors.attendance_draft import (
	flatten_dingtalk_headers,
	precheck_attendance_draft_structure,
	process_attendance_draft_rows,
	rows_from_dingtalk_daily_sheet,
)
from hrms.api.attendance_processors.missed_punch import precheck_missed_punch_structure, process_missed_punch_rows


IMPORT_BATCH_DOCTYPE = "HRMS Attendance Import Batch"
PROCESSING_RECORD_DOCTYPE = "HRMS Attendance Processing Record"
SOURCE_TYPES = ("attendance_draft", "apple_tree", "missing_card")
MONTHLY_SUPPORT_SOURCE_TYPES = ("housing_allowance", "full_attendance", "special_hours")
SOURCE_LABELS = {
	"attendance_draft": "考勤初稿",
	"apple_tree": "苹果树",
	"missing_card": "忘打卡",
	"housing_allowance": "住房补贴",
	"full_attendance": "全勤奖",
	"special_hours": "特殊工时",
}
MONTHLY_SUPPORT_SOURCE_CONFIG = {
	"housing_allowance": {
		"label": "住房补贴",
		"required_headers": ("工号", "姓名", "住房补贴"),
		"description": "上传当月住房补贴明细；按工号、姓名和住房补贴金额核验。",
		"mode": "monthly_amount",
		"value_field": "housing_allowance",
		"value_header": "住房补贴",
	},
	"full_attendance": {
		"label": "全勤奖",
		"required_headers": ("工号", "姓名", "全勤奖"),
		"description": "上传当月全勤奖明细；按工号、姓名和全勤奖金额核验。",
		"mode": "monthly_amount",
		"value_field": "full_attendance_award",
		"value_header": "全勤奖",
	},
	"special_hours": {
		"label": "特殊工时",
		"required_headers": ("工号", "姓名"),
		"description": "上传当月特殊工时人工登记表；按员工与日期工时逐项核验。",
		"mode": "special_hours_grid",
		"value_field": "special_hours",
	},
}


# These identifiers deliberately remain stable in the database and in the
# processors.  They are implementation details though, not wording that an
# attendance administrator should have to interpret on the review screen.
PROCESSING_FIELD_LABELS = {
	"employee_code": "工号",
	"employee_name": "姓名",
	"department": "部门",
	"created_at": "创建时间",
	"punch_time": "补卡时间",
	"punch_type": "补卡类型",
	"reason": "补卡理由",
	"approval_result": "审批结果",
	"approval_status": "审批状态",
	"included": "是否计入",
	"red_apples": "红苹果",
	"amount": "红苹果金额",
	"housing_allowance": "住房补贴",
	"full_attendance_award": "全勤奖",
	"special_hours": "特殊工时（小时）",
	"special_hours_days": "特殊工时明细",
	"day": "日期",
	"hours": "工时",
	"standard_hours": "标准工时",
	"actual_attendance_hours": "实际出勤工时",
	"workday_overtime_hours": "工作日加班工时",
	"restday_overtime_hours": "休息日加班工时",
	"holiday_overtime_hours": "节假日加班工时",
	"large_night_shifts": "大夜班次数",
	"small_night_shifts": "小夜班次数",
	"personal_leave_hours": "事假工时",
	"sick_leave_hours": "病假工时",
	"annual_leave_hours": "特休工时",
	"work_injury_hours": "工伤工时",
	"rest_arrangement_hours": "排休工时",
	"absence_hours": "旷工工时",
	"clock_in_missing_count": "上班漏打卡次数",
	"clock_out_missing_count": "下班漏打卡次数",
	"source_row_count": "来源明细行数",
	"eligible_for_downstream": "计入下游",
	"include_in_downstream": "计入下游",
	"工号": "工号",
	"姓名": "姓名",
	"部门": "部门",
	"苹果类型": "苹果类型",
	"有效苹果数": "有效苹果数",
}

# The completed attendance-draft dataset mirrors the human-readable monthly
# attendance summary: one employee per row and one attendance metric per
# column.  It intentionally excludes special hours, allowance and award data,
# because those belong to the later confirmed sources rather than this draft.
ATTENDANCE_DRAFT_RESULT_COLUMNS = (
	("department", "部门"),
	("employee_name", "姓名"),
	("employee_code", "工号"),
	("standard_hours", "标准工时（小时）"),
	("actual_attendance_hours", "实际出勤（小时）"),
	("workday_overtime_hours", "工作日加班（小时）"),
	("restday_overtime_hours", "休息日加班（小时）"),
	("holiday_overtime_hours", "节假日加班（小时）"),
	("large_night_shifts", "大夜班"),
	("small_night_shifts", "小夜班"),
	("personal_leave_hours", "事假（小时）"),
	("sick_leave_hours", "病假（小时）"),
	("annual_leave_hours", "特休（小时）"),
	("work_injury_hours", "工伤（小时）"),
	("rest_arrangement_hours", "排休（小时）"),
	("absence_hours", "旷工（小时）"),
	("clock_in_missing_count", "上班漏打卡次数"),
	("clock_out_missing_count", "下班漏打卡次数"),
)

# A missed-punch result remains a single source dataset, one approval per row.
# Its business fields are intentionally explicit so the page and the download
# are the same complete form rather than a JSON summary cell.
MISSED_PUNCH_RESULT_COLUMNS = (
	("employee_code", "工号"),
	("employee_name", "姓名"),
	("department", "部门"),
	("created_at", "创建时间"),
	("punch_time", "补卡时间"),
	("punch_type", "补卡类型"),
	("reason", "补卡理由"),
	("approval_result", "审批结果"),
	("approval_status", "审批状态"),
	("included", "是否计入"),
	("red_apples", "红苹果"),
	("amount", "红苹果金额"),
)

# One Apple-tree source row stays one visible result row.  This is the same
# processed dataset used by the source download; it is not an extra business
# table or a raw-import export.
APPLE_TREE_RESULT_COLUMNS = (
	("数据ID", "数据ID"),
	("审批编号", "审批编号"),
	("奖惩日期", "奖惩日期"),
	("创建时间", "创建时间"),
	("部门", "部门"),
	("姓名", "姓名"),
	("工号", "工号"),
	("苹果类型", "苹果类型"),
	("有效苹果数", "有效苹果数"),
	("项目", "项目"),
	("备注", "备注"),
	("创建人", "创建人"),
	("审批结果", "审批结果"),
	("审批状态", "审批状态"),
)

EXCEPTION_LABELS = {
	"CLOCK_IN_MISSING": "上班漏打卡",
	"CLOCK_OUT_MISSING": "下班漏打卡",
	"SHIFT_MISSING": "班次缺失",
	"EMPLOYEE_DEPARTMENT_MISMATCH": "部门信息不一致",
	"EMPLOYEE_DEPARTMENT_CONFLICT": "来源部门信息冲突",
	"DEPARTMENT_CONFLICT": "部门信息不一致",
	"EMPLOYEE_NOT_FOUND": "花名册未找到员工",
	"EMPLOYEE_MATCH_PENDING": "员工匹配待确认",
	"EMPLOYEE_CODE_MISSING": "工号缺失",
	"EMPLOYEE_CODE_NAME_CONFLICT": "工号与姓名冲突",
	"EMPLOYEE_NAME_MISMATCH": "姓名信息不一致",
	"EMPLOYEE_NAME_CONFLICT": "姓名信息不一致",
	"EMPLOYEE_NAME_AMBIGUOUS": "姓名对应多名员工",
	"EMPLOYEE_AMBIGUOUS": "姓名对应多名员工",
	"ATTENDANCE_DATE_MISSING": "考勤日期缺失",
	"ATTENDANCE_DATE_INVALID": "考勤日期无效",
	"ATTENDANCE_DATE_DUPLICATE": "考勤日期重复",
	"ATTENDANCE_MONTH_MISMATCH": "考勤月份不一致",
	"INVALID_NUMERIC_VALUE": "工时或次数格式无效",
	"SOURCE_FILE_MISSING": "来源文件定位缺失",
	"SOURCE_SHEET_MISSING": "来源工作表定位缺失",
	"SOURCE_ROW_MISSING": "来源行号缺失",
	"STRUCTURE_MISSING_REQUIRED_FIELD": "源表缺少必要字段",
	"INVALID_PUNCH_TIME": "补卡时间无效",
	"OUTSIDE_ATTENDANCE_MONTH": "补卡不属于本月",
	"APPROVAL_NO_MISSING": "补卡审批编号缺失",
	"APPROVAL_NOT_APPROVED": "补卡审批未通过",
	"APPROVAL_NOT_ENDED": "补卡审批未结束",
	"OFFLINE_ENTRY_REQUIRES_CONFIRMATION": "线下补录待确认",
	"MONTHLY_AMOUNT_MISSING": "月度金额缺失",
	"MONTHLY_AMOUNT_INVALID": "月度金额格式无效",
	"SPECIAL_HOURS_INVALID": "特殊工时格式无效",
	"DUPLICATE_EMPLOYEE_RECORD": "员工在来源表中重复",
	"OFFLINE_REASON_REQUIRED": "线下补录缺少原因",
	"OFFLINE_CONFIRMER_REQUIRED": "线下补录缺少确认人",
	"DUPLICATE_APPROVAL_NO": "审批编号重复",
	"MULTIPLE_APPROVALS_SAME_PUNCH_TIME": "同一补卡时间有多笔审批",
	"FORMER_EMPLOYEE_REQUIRES_CONFIRMATION": "离职人员记录待确认",
	"AMOUNT_MISSING": "苹果数量缺失",
	"AMOUNT_INVALID": "苹果数量无效",
	"AMOUNT_TEXT_CONFLICT": "苹果数量与项目说明不一致",
	"APPLE_TYPE_UNRECOGNIZED": "无法识别红苹果或绿苹果",
	"APPROVAL_NOT_FINISHED": "审批未结束",
	"APPROVAL_NOT_PASSED": "审批未通过",
	"MISSING_APPROVAL_NO": "审批编号缺失",
	"MISSING_APPROVAL_RESULT": "审批结果缺失",
	"MISSING_APPROVAL_STATUS": "审批状态缺失",
	"MONTH_MISMATCH": "记录不属于本月",
	"OFFLINE_ENTRY_REQUIRES_CONFIRMATION": "线下补录待确认",
}


def _review_guidance(exception_codes: list[str], source_type: str) -> list[str]:
	"""Return concrete, policy-safe choices for the shared human review queue."""
	codes = set(exception_codes or [])
	guidance = []
	if {"CLOCK_IN_MISSING", "CLOCK_OUT_MISSING"} & codes:
		guidance.append("先核对钉钉补卡审批；补卡审批已通过时，在“忘打卡”来源上传对应审批后再确认。")
		guidance.append("确认确实未打卡且没有有效补卡时，可选择“确认未打卡（不计入下游）”。")
	if "SHIFT_MISSING" in codes:
		guidance.append("核对是否为入职前、离职后或无排班日；确认无排班可通过，需补排班则保留待审核。")
	if {"EMPLOYEE_DEPARTMENT_MISMATCH", "EMPLOYEE_DEPARTMENT_CONFLICT", "DEPARTMENT_CONFLICT"} & codes:
		guidance.append("以花名册当前部门为准；花名册无误可通过，需变更部门时先更新花名册或部门映射。")
	if {"EMPLOYEE_NOT_FOUND", "EMPLOYEE_MATCH_PENDING", "EMPLOYEE_CODE_MISSING", "EMPLOYEE_CODE_NAME_CONFLICT", "EMPLOYEE_NAME_MISMATCH", "EMPLOYEE_NAME_CONFLICT", "EMPLOYEE_NAME_AMBIGUOUS", "EMPLOYEE_AMBIGUOUS"} & codes:
		guidance.append("核对工号、姓名和花名册；无法唯一匹配前不要通过，也不要删除原始记录。")
	if {"OFFLINE_ENTRY_REQUIRES_CONFIRMATION", "OFFLINE_REASON_REQUIRED", "OFFLINE_CONFIRMER_REQUIRED"} & codes:
		guidance.append("线下补录须补齐原因和确认人；不能作为钉钉自动记录直接计入。")
	if {"APPROVAL_NOT_APPROVED", "APPROVAL_NOT_ENDED", "APPROVAL_NOT_FINISHED", "APPROVAL_NOT_PASSED"} & codes:
		guidance.append("等待审批“已通过且已结束”后重新上传该来源；当前记录不能自动计入。")
	if not guidance:
		guidance.append("核对来源追溯信息后，选择通过、驳回或保留待审核；原始导入行会继续保留。")
	return guidance


def _review_options(exception_codes: list[str], source_type: str) -> list[dict[str, str]]:
	"""Offer review decisions without changing a number merely to close a case."""
	codes = set(exception_codes or [])
	options = []
	if {"CLOCK_IN_MISSING", "CLOCK_OUT_MISSING"} & codes:
		options.extend([
			{"label": "忘记打卡，等待补卡审批", "review_status": "待审核", "reason": "等待员工补卡审批；当前不确认。"},
			{"label": "补卡审批已通过，确认当前考勤数据", "review_status": "已通过", "reason": "已核对补卡审批通过且已结束，确认当前考勤数据。"},
			{"label": "确认未打卡（不计入下游）", "review_status": "已驳回", "reason": "已核对无有效补卡审批，确认未打卡，本员工汇总不计入下游。"},
		])
	if "SHIFT_MISSING" in codes:
		options.extend([
			{"label": "确认无排班/入离职期间，保留当前数据", "review_status": "已通过", "reason": "已核对为无排班日或入离职期间，确认当前考勤数据。"},
			{"label": "等待补充或更正排班", "review_status": "待审核", "reason": "需补充或更正排班信息后再确认。"},
		])
	if {"EMPLOYEE_DEPARTMENT_MISMATCH", "EMPLOYEE_DEPARTMENT_CONFLICT", "DEPARTMENT_CONFLICT"} & codes:
		options.extend([
			{"label": "花名册部门无误，按花名册确认", "review_status": "已通过", "reason": "已核对花名册，按花名册当前部门确认。"},
			{"label": "等待更新花名册或部门映射", "review_status": "待审核", "reason": "需先更新花名册或部门映射后再确认。"},
		])
	if not options:
		options.extend([
			{"label": "核对无误，确认当前数据", "review_status": "已通过", "reason": "已核对来源和相关资料，确认当前数据。"},
			{"label": "资料不足，保留待审核", "review_status": "待审核", "reason": "资料不足，保留待审核。"},
			{"label": "确认不应计入（不计入下游）", "review_status": "已驳回", "reason": "已核对该记录不应计入下游。"},
		])
	return options
def _require_processing_manager():
	"""Guard every whitelisted read/write path before any ignore_permissions call."""
	# ``frappe.has_role`` is only exposed on the browser-side Frappe object in
	# this deployment.  Server methods must resolve roles from the current
	# session explicitly.
	roles = set(frappe.get_roles(frappe.session.user))
	if not ({"System Manager", "HR Manager"} & roles):
		frappe.throw(_("只有 System Manager 或 HR Manager 可以访问考勤处理中心。"), frappe.PermissionError)


def _require_company(company: str) -> str:
	company = (company or "").strip()
	if not company:
		frappe.throw(_("请先选择公司。"))
	return company


def _require_month(attendance_month: str) -> str:
	attendance_month = (attendance_month or "").strip()
	if not attendance_month or len(attendance_month) != 7 or attendance_month[4:5] != "-":
		frappe.throw(_("考勤月份必须使用 YYYY-MM。"))
	return attendance_month


def _require_source_type(source_type: str) -> str:
	source_type = (source_type or "").strip()
	if source_type not in SOURCE_TYPES:
		frappe.throw(_("不支持的考勤来源类型。"))
	return source_type


def _require_monthly_support_source_type(source_type: str) -> str:
	source_type = (source_type or "").strip()
	if source_type not in MONTHLY_SUPPORT_SOURCE_TYPES:
		frappe.throw(_("不支持的月度补充来源类型。"))
	return source_type


def _require_processing_source_type(source_type: str) -> str:
	source_type = (source_type or "").strip()
	if source_type not in SOURCE_TYPES + MONTHLY_SUPPORT_SOURCE_TYPES:
		frappe.throw(_("不支持的考勤处理来源类型。"))
	return source_type


def _json(value: Any) -> str:
	return json.dumps(value, ensure_ascii=False, default=str, sort_keys=True)


def _loads(value: Any, default: Any):
	if value in (None, ""):
		return default
	try:
		return json.loads(value)
	except (TypeError, ValueError):
		return default


def _source_department_values(original_value: Any) -> list[str]:
	"""Read the unmodified department values from retained source rows."""
	if not isinstance(original_value, dict):
		return []
	rows = original_value.get("rows") or []
	if not isinstance(rows, list):
		return []
	values = []
	for row in rows:
		if not isinstance(row, dict):
			continue
		value = row.get("实际部门") or row.get("部门") or row.get("department")
		value = str(value or "").strip()
		if value and value not in values:
			values.append(value)
	return values


def _department_comparison(record: dict[str, Any]) -> dict[str, str] | None:
	"""Expose both sides of an identity-department mismatch to the reviewer."""
	if "EMPLOYEE_DEPARTMENT_MISMATCH" not in (record.get("exception_codes") or []) and "DEPARTMENT_CONFLICT" not in (record.get("exception_codes") or []):
		return None
	source_departments = _source_department_values(record.get("original_value"))
	# The persisted proposed value is the roster department resolved at processing
	# time. Prefer it so reviewing old batches stays reproducible even after a
	# later roster update.
	roster_department = (record.get("proposed_value") or {}).get("department") or record.get("department") or ""
	if not source_departments and not roster_department:
		return None
	return {
		"source_department": "、".join(source_departments) or "（原表未提供）",
		"roster_department": str(roster_department).strip() or "（花名册未提供）",
	}


def _file_doc(file_url: str):
	name = frappe.db.get_value("File", {"file_url": file_url}, "name")
	if not name:
		frappe.throw(_("找不到上传的来源文件。"))
	return frappe.get_doc("File", name)


def _file_checksum(file_url: str) -> str:
	return hashlib.sha256(_file_doc(file_url).get_content()).hexdigest()


def _load_workbook(file_url: str):
	from openpyxl import load_workbook

	return load_workbook(BytesIO(_file_doc(file_url).get_content()), data_only=True, read_only=True)


def _latest_batch(company: str, attendance_month: str, source_type: str):
	name = frappe.db.get_value(
		IMPORT_BATCH_DOCTYPE,
		{
			"company": company,
			"attendance_month": attendance_month,
			"source_type": source_type,
			"status": ["!=", "已撤销"],
		},
		"name",
		order_by="modified desc, creation desc",
	)
	return frappe.get_doc(IMPORT_BATCH_DOCTYPE, name) if name else None


def _batch_notes(batch) -> dict[str, Any]:
	notes = _loads(batch.notes, {})
	return notes if isinstance(notes, dict) else {}


def _save_batch_notes(batch, updates: dict[str, Any]):
	notes = _batch_notes(batch)
	notes.setdefault("attendance_processing_center", {}).update(updates)
	batch.notes = _json(notes)
	batch.save(ignore_permissions=True)


def _processing_meta(batch) -> dict[str, Any]:
	return _batch_notes(batch).get("attendance_processing_center", {})


def _normalized_header(value: Any) -> str:
	"""Compare wide Excel headers without being sensitive to line breaks/spaces."""
	return "".join(str(value or "").split())


def _month_marker(attendance_month: str) -> str:
	return f"{int(attendance_month[5:7])}月"


def _sheet_matches_month(sheet, attendance_month: str) -> bool:
	"""Ignore comparison/last-month tabs when a workbook contains several tabs."""
	marker = _month_marker(attendance_month)
	values = [sheet.title]
	for row in sheet.iter_rows(min_row=1, max_row=3, values_only=True):
		values.extend(str(value or "") for value in row)
	return marker in "".join(values)


def _monthly_support_sheets(workbook, attendance_month: str):
	return [sheet for sheet in workbook.worksheets if _sheet_matches_month(sheet, attendance_month)]


def _support_header_matches(sheet, required_headers: tuple[str, ...]):
	required = tuple(_normalized_header(value) for value in required_headers)
	for row_number, row in enumerate(sheet.iter_rows(values_only=True), start=1):
		headers = [_normalized_header(value) for value in row]
		positions = {field: [index for index, value in enumerate(headers) if value == field] for field in required}
		if all(positions.values()):
			return row_number, positions
	return None, {}


def _monthly_amount_rows(sheet, batch, config: dict[str, Any]):
	header_row, positions = _support_header_matches(sheet, config["required_headers"])
	if not header_row:
		return []
	rows = []
	code_indexes = positions["工号"]
	name_indexes = positions["姓名"]
	amount_indexes = positions[_normalized_header(config["value_header"])]
	for source_row, values in enumerate(sheet.iter_rows(min_row=header_row + 1, values_only=True), start=header_row + 1):
		for table_index, code_index in enumerate(code_indexes):
			name_index = name_indexes[min(table_index, len(name_indexes) - 1)]
			amount_index = amount_indexes[min(table_index, len(amount_indexes) - 1)]
			department_index = code_index + 2 if code_index + 2 < len(values) else None
			code = values[code_index] if code_index < len(values) else None
			name = values[name_index] if name_index < len(values) else None
			amount = values[amount_index] if amount_index < len(values) else None
			department = values[department_index] if department_index is not None else None
			if not any(value not in (None, "") for value in (code, name, amount, department)):
				continue
			# Monthly sheets often end with amount totals.  A total has neither an
			# employee code nor a name, so it must not become a fake review record.
			if code in (None, "") and name in (None, ""):
				continue
			rows.append({
				"employee_code": str(code).strip() if code not in (None, "") else "",
				"employee_name": str(name).strip() if name not in (None, "") else "",
				"department": str(department).strip() if department not in (None, "") else "",
				config["value_field"]: amount,
				"source_file": batch.source_file,
				"source_sheet": sheet.title,
				"source_row": source_row,
				"source_id": f"{sheet.title}:{source_row}:{table_index + 1}",
			})
	return rows


def _special_hours_rows(sheet, batch):
	header_row, positions = _support_header_matches(sheet, ("工号", "姓名"))
	if not header_row:
		return []
	date_row = header_row + 1
	day_values = next(sheet.iter_rows(min_row=date_row, max_row=date_row, values_only=True), ())
	day_indexes = [(index, cint(value)) for index, value in enumerate(day_values) if 1 <= cint(value) <= 31]
	code_index, name_index = positions["工号"][0], positions["姓名"][0]
	department_index = name_index + 1
	rows = []
	for source_row, values in enumerate(sheet.iter_rows(min_row=date_row + 1, values_only=True), start=date_row + 1):
		code = values[code_index] if code_index < len(values) else None
		name = values[name_index] if name_index < len(values) else None
		department = values[department_index] if department_index < len(values) else None
		daily_values = [{"day": day, "hours": values[index] if index < len(values) else None} for index, day in day_indexes if index < len(values) and values[index] not in (None, "")]
		if not any(value not in (None, "") for value in (code, name, department)) and not daily_values:
			continue
		# The final "单日工时汇总" line contains daily totals but no employee.
		# It is a report footer, not a person with missing identifiers.
		if code in (None, "") and name in (None, ""):
			continue
		rows.append({
			"employee_code": str(code).strip() if code not in (None, "") else "",
			"employee_name": str(name).strip() if name not in (None, "") else "",
			"department": str(department).strip() if department not in (None, "") else "",
			"special_hours_days": daily_values,
			"source_file": batch.source_file,
			"source_sheet": sheet.title,
			"source_row": source_row,
			"source_id": f"{sheet.title}:{source_row}",
		})
	return rows


def _read_monthly_support_rows(batch):
	config = MONTHLY_SUPPORT_SOURCE_CONFIG[batch.source_type]
	workbook = _load_workbook(batch.source_file)
	sheets = _monthly_support_sheets(workbook, batch.attendance_month)
	rows = []
	for sheet in sheets:
		if config["mode"] == "monthly_amount":
			rows.extend(_monthly_amount_rows(sheet, batch, config))
		else:
			rows.extend(_special_hours_rows(sheet, batch))
	return rows, sheets


def _monthly_support_precheck(batch) -> dict[str, Any]:
	config = MONTHLY_SUPPORT_SOURCE_CONFIG[batch.source_type]
	workbook = _load_workbook(batch.source_file)
	matches = []
	monthly_sheets = _monthly_support_sheets(workbook, batch.attendance_month)
	for sheet in monthly_sheets:
		header_row, positions = _support_header_matches(sheet, config["required_headers"])
		if not header_row:
			continue
		if config["mode"] == "monthly_amount":
			record_count = len(_monthly_amount_rows(sheet, batch, config))
		else:
			record_count = len(_special_hours_rows(sheet, batch))
		matches.append({"sheet": sheet.title, "header_row": header_row, "record_count": record_count})
	if not matches:
		return {
			"is_valid": False,
			"status": "结构异常",
			"required_headers": list(config["required_headers"]),
			"message": _("未找到与处理月份匹配且同时包含 {0} 的工作表。").format("、".join(config["required_headers"])),
			"sheets": [sheet.title for sheet in monthly_sheets] or workbook.sheetnames,
		}
	record_count = sum(item["record_count"] for item in matches)
	if not record_count:
		return {
			"is_valid": False,
			"status": "结构异常",
			"required_headers": list(config["required_headers"]),
			"matching_sheets": matches,
			"record_count": 0,
			"message": _("已识别字段，但未找到任何工号记录。"),
		}
	return {
		"is_valid": True,
		"status": "结构通过",
		"required_headers": list(config["required_headers"]),
		"matching_sheets": matches,
		"record_count": record_count,
	}


def _employee_directory(company: str = ""):
	"""Return business employee codes, never Frappe's internal Employee name.

	The roster's visible 工号 is ``custom_employee_code`` in this deployment;
	``employee_number`` remains a compatibility fallback.  Internal document
	names (for example HR-EMP-00001) must not be used to match DingTalk rows.
	"""
	try:
		employees = frappe.get_all(
			"Employee",
			filters={"company": company} if company else None,
			fields=["custom_employee_code", "employee_number", "employee_name", "department", "status as employment_status"],
			# A small default page would make most name+department matches look
			# missing even though those employees exist in the roster.
			limit_page_length=5000,
		)
		return [
			{
				"employee_code": (employee.custom_employee_code or employee.employee_number or "").strip(),
				"employee_name": employee.employee_name,
				"department": employee.department,
				"employment_status": employee.employment_status,
			}
			for employee in employees
			if (employee.custom_employee_code or employee.employee_number or "").strip()
		]
	except Exception:
		return []


def _as_nonnegative_number(value: Any):
	if isinstance(value, bool) or value in (None, ""):
		return None
	try:
		number = float(value)
	except (TypeError, ValueError):
		return None
	return number if number >= 0 else None


def _process_monthly_support_rows(batch):
	"""Convert the three monthly auxiliary inputs into reviewable employee rows."""
	config = MONTHLY_SUPPORT_SOURCE_CONFIG[batch.source_type]
	raw_rows, sheets = _read_monthly_support_rows(batch)
	employees = {str(employee["employee_code"]).strip(): employee for employee in _employee_directory(batch.company)}
	seen_codes = set()
	processed_rows = []
	last_day = monthrange(int(batch.attendance_month[:4]), int(batch.attendance_month[5:]))[1]
	for raw in raw_rows:
		code = raw.get("employee_code") or ""
		name = raw.get("employee_name") or ""
		department = raw.get("department") or ""
		exception_codes = []
		if not code:
			exception_codes.append("EMPLOYEE_CODE_MISSING")
		elif code in seen_codes:
			exception_codes.append("DUPLICATE_EMPLOYEE_RECORD")
		else:
			seen_codes.add(code)
		employee = employees.get(code)
		if employees and code and not employee:
			exception_codes.append("EMPLOYEE_NOT_FOUND")
		elif employee:
			if name and str(employee.get("employee_name") or "").strip() and name != str(employee["employee_name"]).strip():
				exception_codes.append("EMPLOYEE_CODE_NAME_CONFLICT")
			if department and str(employee.get("department") or "").strip() and department != str(employee["department"]).strip():
				exception_codes.append("EMPLOYEE_DEPARTMENT_MISMATCH")
			department = str(employee.get("department") or department).strip()

		if config["mode"] == "monthly_amount":
			amount = _as_nonnegative_number(raw.get(config["value_field"]))
			if raw.get(config["value_field"]) in (None, ""):
				exception_codes.append("MONTHLY_AMOUNT_MISSING")
			elif amount is None:
				exception_codes.append("MONTHLY_AMOUNT_INVALID")
			proposed = {"employee_code": code, "employee_name": name, "department": department, config["value_field"]: amount if amount is not None else raw.get(config["value_field"]), "eligible_for_downstream": not exception_codes}
		else:
			daily_entries = []
			for entry in raw.get("special_hours_days") or []:
				hours = _as_nonnegative_number(entry.get("hours"))
				if hours is None or entry.get("day", 0) > last_day:
					exception_codes.append("SPECIAL_HOURS_INVALID")
					continue
				daily_entries.append({"day": entry["day"], "hours": hours})
			proposed = {"employee_code": code, "employee_name": name, "department": department, "special_hours": sum(entry["hours"] for entry in daily_entries), "special_hours_days": daily_entries, "eligible_for_downstream": not exception_codes}

		exception_codes = list(dict.fromkeys(exception_codes))
		proposed["eligible_for_downstream"] = not exception_codes
		processed_rows.append({
			"employee_code": code,
			"employee_name": name,
			"department": department,
			"source_file": raw["source_file"],
			"source_sheet": raw["source_sheet"],
			"source_row": raw["source_row"],
			"source_id": raw["source_id"],
			"original_data": raw,
			"processed_value": proposed,
			"proposed_value": proposed,
			"exception_codes": exception_codes,
			"exception_message": "；".join(EXCEPTION_LABELS.get(code, code) for code in exception_codes),
			"review_status": "待审核" if exception_codes else "无需审核",
			"eligible_for_downstream": not exception_codes,
		})
	exception_rows = sum(1 for row in processed_rows if row["review_status"] == "待审核")
	return {
		"status": "待处理异常" if exception_rows else "待确认",
		"processed_rows": processed_rows,
		"metrics": {"source_rows": len(raw_rows), "processed_rows": len(processed_rows), "exception_rows": exception_rows},
		"source_sheets": [sheet.title for sheet in sheets],
	}


def _simple_sheet_rows(sheet, file_url: str) -> list[dict[str, Any]]:
	rows = sheet.iter_rows(values_only=True)
	try:
		headers = [str(value).strip() if value is not None else "" for value in next(rows)]
	except StopIteration:
		return []
	result = []
	for source_row, values in enumerate(rows, start=2):
		if not any(value not in (None, "") for value in values):
			continue
		row = {headers[index]: values[index] if index < len(values) else None for index in range(len(headers)) if headers[index]}
		row.update({"source_file": file_url, "source_sheet": sheet.title, "source_row": source_row})
		result.append(row)
	return result


def _source_sheet(workbook, source_type: str):
	if source_type == "attendance_draft":
		if "每日明细（钉钉导出）" not in workbook.sheetnames:
			frappe.throw(_("考勤初稿必须包含“每日明细（钉钉导出）”工作表。"))
		return workbook["每日明细（钉钉导出）"]
	if "钉钉导出数据" in workbook.sheetnames:
		return workbook["钉钉导出数据"]
	return workbook[workbook.sheetnames[0]]


def _read_source_rows(batch):
	workbook = _load_workbook(batch.source_file)
	sheet = _source_sheet(workbook, batch.source_type)
	if batch.source_type == "attendance_draft":
		rows = rows_from_dingtalk_daily_sheet(sheet, source_file=batch.source_file)
		return rows, sheet.title
	return _simple_sheet_rows(sheet, batch.source_file), sheet.title


def _precheck(batch):
	rows, sheet_name = _read_source_rows(batch)
	if batch.source_type == "attendance_draft":
		workbook = _load_workbook(batch.source_file)
		sheet = _source_sheet(workbook, batch.source_type)
		values = sheet.iter_rows(values_only=True)
		try:
			headers = flatten_dingtalk_headers(next(values), next(values))
		except StopIteration:
			headers = []
		result = precheck_attendance_draft_structure(headers)
	elif batch.source_type == "apple_tree":
		result = preflight_apple_tree_rows(rows)
	else:
		headers = list(rows[0]) if rows else []
		result = precheck_missed_punch_structure(headers)
	return {"source_sheet": sheet_name, "row_count": len(rows), "result": result}


def _process_batch(batch) -> dict[str, Any]:
	rows, sheet_name = _read_source_rows(batch)
	employees = _employee_directory(batch.company)
	if batch.source_type == "attendance_draft":
		return process_attendance_draft_rows(
			rows,
			attendance_month=batch.attendance_month,
			source_file=batch.source_file,
			source_sheet=sheet_name,
			employee_directory=employees or None,
		)
	if batch.source_type == "apple_tree":
		processed_rows = process_apple_tree_rows(
			rows,
			rules=AppleTreeRules(target_month=batch.attendance_month),
			employees=employees or None,
			source_file=batch.source_file,
			source_sheet=sheet_name,
			start_row=2,
		)
		exception_rows = sum(1 for row in processed_rows if row.get("review_status") == "待审核")
		return {
			"status": "待处理异常" if exception_rows else "待确认",
			"structure_precheck": preflight_apple_tree_rows(rows),
			"processed_rows": processed_rows,
			"metrics": {"source_rows": len(rows), "processed_rows": len(processed_rows), "exception_rows": exception_rows},
		}
	return process_missed_punch_rows(
		rows,
		attendance_month=batch.attendance_month,
		source_file=batch.source_file,
		source_sheet=sheet_name,
		employee_directory=employees or None,
	)


def _row_value(row: dict[str, Any], *keys: str):
	for key in keys:
		if row.get(key) not in (None, ""):
			return row.get(key)
	return ""


def _confirmed_downstream_eligible(confirmed: Any) -> bool:
	"""Respect an approved reviewer's explicit inclusion decision.

	The three processors use slightly different field names while converging on
	the same review contract. A passed review whose confirmed value explicitly
	excludes a record must not enter final aggregation merely because it passed.
	"""
	if not isinstance(confirmed, dict):
		return True
	for fieldname in ("eligible_for_downstream", "include_in_downstream", "included"):
		if fieldname not in confirmed:
			continue
		value = confirmed[fieldname]
		if isinstance(value, bool):
			return value
		if isinstance(value, (int, float)):
			return value != 0
		return str(value or "").strip().lower() in {"1", "true", "yes", "y", "是", "计入"}
	return True


def _record_payload(batch, row: dict[str, Any]) -> dict[str, Any]:
	proposed = row.get("proposed_value") or {}
	processed = row.get("processed_value") or proposed
	# Retain the untouched DingTalk source row whenever the processor supplies
	# it.  The smaller original_value is an editable-field snapshot, not a
	# substitute for source-row traceability.
	original = row.get("original_data") or row.get("original_value") or {}
	# apple_tree uses include_in_downstream while the other processors use the
	# shared eligible_for_downstream field. Preserve either source contract.
	downstream_eligible = row.get("eligible_for_downstream")
	if downstream_eligible is None:
		downstream_eligible = row.get("include_in_downstream", False)
	review_status = row.get("review_status") or "待审核"
	# An unresolved or rejected mismatch is visible and retained, but must never
	# contaminate the otherwise usable source result or stop other employees from
	# moving to the next calculation step.
	downstream_eligible = bool(downstream_eligible) and review_status in {"无需审核", "已通过"}
	return {
		"doctype": PROCESSING_RECORD_DOCTYPE,
		"import_batch": batch.name,
		"company": batch.company,
		"attendance_month": batch.attendance_month,
		"source_type": batch.source_type,
		"employee_code": _row_value(row, "employee_code", "工号"),
		"employee_name": _row_value(row, "employee_name", "姓名"),
		"department": _row_value(row, "department", "部门"),
		"processed_value_json": _json(processed),
		"original_value_json": _json(original),
		"exception_codes": _json(row.get("exception_codes") or []),
		"exception_message": row.get("exception_message") or "",
		"review_status": review_status,
		"proposed_value_json": _json(proposed),
		"confirmed_value_json": _json(row.get("confirmed_value")) if row.get("confirmed_value") is not None else "",
		"reviewer": row.get("reviewer") or "",
		"reviewed_on": row.get("reviewed_on") or None,
		"review_note": row.get("review_note") or "",
		"review_history_json": _json(row.get("review_history") or []),
		"eligible_for_downstream": 1 if downstream_eligible else 0,
		"source_file": row.get("source_file") or batch.source_file,
		"source_sheet": row.get("source_sheet") or "",
		"source_row": cint(row.get("source_row")),
		"source_id": row.get("source_id") or "",
		"approval_no": row.get("approval_no") or "",
	}


def _persist_processed_rows(batch, result):
	if frappe.db.count(PROCESSING_RECORD_DOCTYPE, {"import_batch": batch.name}):
		return
	for row in result["processed_rows"]:
		frappe.get_doc(_record_payload(batch, row)).insert(ignore_permissions=True)


def _result_rows(batch, page_length: int = 5000):
	records = frappe.get_all(
		PROCESSING_RECORD_DOCTYPE,
		filters={"import_batch": batch.name},
		fields=["name", "employee_code", "employee_name", "department", "source_type", "processed_value_json", "original_value_json", "exception_codes", "exception_message", "review_status", "proposed_value_json", "confirmed_value_json", "reviewer", "reviewed_on", "review_note", "eligible_for_downstream", "source_file", "source_sheet", "source_row", "source_id", "approval_no"],
		order_by="employee_code asc, source_row asc",
		limit_page_length=page_length,
	)
	return [_serialize_record(row) for row in records]


def _serialize_record(record):
	result = dict(record)
	result["record_id"] = result.pop("name")
	result["processed_value"] = _loads(result.pop("processed_value_json", ""), {})
	result["original_value"] = _loads(result.pop("original_value_json", ""), {})
	result["exception_codes"] = _loads(result["exception_codes"], [])
	result["proposed_value"] = _loads(result.pop("proposed_value_json", ""), {})
	result["confirmed_value"] = _loads(result.pop("confirmed_value_json", ""), None)
	result["result_summary"] = _json(result["confirmed_value"] or result["proposed_value"] or result["processed_value"])
	result["source_label"] = SOURCE_LABELS.get(result.get("source_type"), result.get("source_type") or "--")
	result["exception_labels"] = [EXCEPTION_LABELS.get(code, "待人工确认") for code in result["exception_codes"]]
	result["department_comparison"] = _department_comparison(result)
	if result["department_comparison"]:
		comparison = result["department_comparison"]
		result["exception_detail"] = "钉钉考勤表部门：{0}；花名册部门：{1}。".format(comparison["source_department"], comparison["roster_department"])
	else:
		result["exception_detail"] = result.get("exception_message") or ""
	result["review_guidance"] = _review_guidance(result["exception_codes"], result.get("source_type") or "")
	result["review_options"] = _review_options(result["exception_codes"], result.get("source_type") or "")
	return result


def _effective_result_values(row: dict[str, Any]) -> dict[str, Any]:
	"""Build the current display/export row without changing its audit trail."""
	values = dict(row.get("processed_value") or {})
	values.update(row.get("proposed_value") or {})
	if row.get("confirmed_value") is not None:
		values.update(row["confirmed_value"])
	for fieldname in ("employee_code", "employee_name", "department"):
		if row.get(fieldname) not in (None, ""):
			values[fieldname] = row[fieldname]
	# Proposed values are intentionally retained for review, but they cannot be
	# presented as final red-apple amounts while a row is pending or rejected.
	if "included" in values:
		values["included"] = bool(row.get("eligible_for_downstream"))
		if not values["included"]:
			values["red_apples"] = 0
			values["amount"] = 0
	return values


def _export_processed_result(batch) -> dict[str, str]:
	from openpyxl import Workbook
	from frappe.utils.file_manager import save_file

	rows = _result_rows(batch)
	book = Workbook()
	sheet = book.active
	sheet.title = "加工结果"
	if batch.source_type == "attendance_draft":
		headers = ["序号"] + [label for _field, label in ATTENDANCE_DRAFT_RESULT_COLUMNS] + ["异常说明", "审核状态", "是否计入下游", "来源文件", "来源工作表", "来源行"]
	elif batch.source_type == "apple_tree":
		headers = [label for _field, label in APPLE_TREE_RESULT_COLUMNS] + ["异常类型", "异常说明", "审核状态", "建议值", "确认值", "是否计入下游", "来源文件", "来源工作表", "来源行"]
	elif batch.source_type == "missing_card":
		headers = ["序号"] + [label for _field, label in MISSED_PUNCH_RESULT_COLUMNS] + ["异常类型", "异常说明", "审核状态", "是否计入下游", "来源文件", "来源工作表", "来源行", "来源ID", "审批编号"]
	else:
		headers = ["工号", "姓名", "部门", "加工结果", "异常类型", "异常说明", "审核状态", "建议值", "确认值", "可进入下游", "来源文件", "来源工作表", "来源行", "来源ID", "审批编号"]
	sheet.append(headers)
	for index, row in enumerate(rows, start=1):
		if batch.source_type == "attendance_draft":
			values = _effective_result_values(row)
			sheet.append([
				index,
				*[values.get(field, "") for field, _label in ATTENDANCE_DRAFT_RESULT_COLUMNS],
				"；".join(row.get("exception_labels") or []) or "无",
				row.get("review_status"),
				"是" if row.get("eligible_for_downstream") else "否",
				row.get("source_file"), row.get("source_sheet"), row.get("source_row"),
			])
		elif batch.source_type == "apple_tree":
			values = row.get("processed_value") or {}
			sheet.append([
				*[values.get(field, "") for field, _label in APPLE_TREE_RESULT_COLUMNS],
				"、".join(row.get("exception_labels") or []) or "无", row.get("exception_message"), row.get("review_status"),
				_json(row.get("proposed_value")), _json(row.get("confirmed_value")) if row.get("confirmed_value") is not None else "",
				"是" if row.get("eligible_for_downstream") else "否", row.get("source_file"), row.get("source_sheet"), row.get("source_row"),
			])
		elif batch.source_type == "missing_card":
			values = _effective_result_values(row)
			sheet.append([
				index,
				*["是" if field == "included" and values.get(field) else "否" if field == "included" else values.get(field, "") for field, _label in MISSED_PUNCH_RESULT_COLUMNS],
				"、".join(row.get("exception_labels") or []) or "无", row.get("exception_message"), row.get("review_status"),
				"是" if row.get("eligible_for_downstream") else "否", row.get("source_file"), row.get("source_sheet"),
				row.get("source_row"), row.get("source_id"), row.get("approval_no"),
			])
		else:
			sheet.append([
				row.get("employee_code"), row.get("employee_name"), row.get("department"), _json(row.get("processed_value")),
				"、".join(row.get("exception_labels") or []), row.get("exception_message"), row.get("review_status"),
				_json(row.get("proposed_value")), _json(row.get("confirmed_value")) if row.get("confirmed_value") is not None else "",
				"是" if row.get("eligible_for_downstream") else "否", row.get("source_file"), row.get("source_sheet"),
				row.get("source_row"), row.get("source_id"), row.get("approval_no"),
			])
	for column in sheet.columns:
		sheet.column_dimensions[column[0].column_letter].width = min(max(max(len(str(cell.value or "")) for cell in column) + 2, 12), 48)
	output = BytesIO()
	book.save(output)
	file = save_file(f"{batch.attendance_month}_{SOURCE_LABELS[batch.source_type]}_加工结果.xlsx", output.getvalue(), None, None, is_private=1)
	return {"file_url": file.file_url, "file_name": file.file_name}


def _slot_payload(batch):
	if not batch:
		return None
	meta = _processing_meta(batch)
	metrics = meta.get("metrics", {})
	processed_rows = frappe.db.count(PROCESSING_RECORD_DOCTYPE, {"import_batch": batch.name})
	pending_exception_count = frappe.db.count(
		PROCESSING_RECORD_DOCTYPE,
		{"import_batch": batch.name, "review_status": "待审核"},
	)
	effective_status = "待处理异常" if pending_exception_count else batch.status
	return {
		"source_type": batch.source_type,
		"source_file": batch.source_file,
		"source_file_name": Path(batch.source_file or "").name,
		"attendance_month": batch.attendance_month,
		"row_count": metrics.get("source_rows", batch.daily_sheet_rows or 0),
		# This is a live pending count, rather than the historic number detected
		# at import. Resolved rows stay auditable but disappear from the work queue.
		"exception_count": pending_exception_count,
		"historic_exception_count": metrics.get("exception_rows", 0),
		"status": effective_status,
		"stored_status": batch.status,
		"can_precheck": bool(batch.source_file) and batch.status in {"待加工", "预览", "已导入"},
		"can_process": bool(batch.source_file) and batch.status in {"待加工", "预览", "已导入"},
		"can_edit": batch.status in {"待处理异常", "待确认", "已确认"},
		"can_confirm": bool(processed_rows) and batch.status in {"待处理异常", "待确认"},
		"processed_result": meta.get("processed_result"),
	}


def _refresh_batch_review_status(batch):
	"""Keep a confirmed source usable while unresolved rows remain excluded."""
	if batch.status == "已确认":
		return batch.status
	pending_rows = frappe.db.count(
		PROCESSING_RECORD_DOCTYPE,
		{"import_batch": batch.name, "review_status": "待审核"},
	)
	batch.status = "待处理异常" if pending_rows else "待确认"
	batch.save(ignore_permissions=True)
	return batch.status


@frappe.whitelist()
def get_processing_batch(company: str, attendance_month: str):
	_require_processing_manager()
	company, attendance_month = _require_company(company), _require_month(attendance_month)
	slots = []
	for source_type in SOURCE_TYPES:
		batch = _latest_batch(company, attendance_month, source_type)
		slot = _slot_payload(batch)
		if slot:
			slots.append(slot)
	batch_statuses = [slot["status"] for slot in slots]
	status = "未上传" if not slots else "已确认" if len(slots) == 3 and all(value == "已确认" for value in batch_statuses) else "待处理异常" if "待处理异常" in batch_statuses else "待确认" if "待确认" in batch_statuses else "待加工"
	finalization_inputs = _finalization_inputs(company, attendance_month, slots)
	anchor_batch = _latest_batch(company, attendance_month, "attendance_draft")
	final_outputs = _processing_meta(anchor_batch).get("monthly_final_outputs", {}) if anchor_batch else {}
	return {
		"batch_id": f"{company}:{attendance_month}",
		"company": company,
		"attendance_month": attendance_month,
		"status": status,
		"slots": slots,
		"finalization_inputs": finalization_inputs,
		"final_outputs": final_outputs,
		"locked_snapshot_version": final_outputs.get("locked_snapshot_version", ""),
		"snapshot_ready": bool(finalization_inputs) and all(item["ready"] for item in finalization_inputs),
	}


@frappe.whitelist()
def register_source_file(company: str, attendance_month: str, source_type: str, file_url: str):
	_require_processing_manager()
	company, attendance_month, source_type = _require_company(company), _require_month(attendance_month), _require_source_type(source_type)
	if not file_url:
		frappe.throw(_("请先上传来源文件。"))
	if not file_url.lower().split("?", 1)[0].endswith(".xlsx"):
		frappe.throw(_("当前考勤处理仅接受 .xlsx 文件，以保证结构预检和加工结果可追溯。"))
	checksum = _file_checksum(file_url)
	batch = frappe.get_doc({
		"doctype": IMPORT_BATCH_DOCTYPE,
		"company": company,
		"attendance_month": attendance_month,
		"source_file": file_url,
		"source_type": source_type,
		"source_checksum": checksum,
		"status": "待加工",
		"imported_by": frappe.session.user,
		"imported_on": now_datetime(),
		"notes": _json({"attendance_processing_center": {"source_version": now_datetime().isoformat(), "registered_by": frappe.session.user}}),
	}).insert(ignore_permissions=True)
	return {"batch": batch.name, "source_type": source_type, "status": batch.status, "file_url": file_url}


@frappe.whitelist()
def register_monthly_support_file(company: str, attendance_month: str, source_type: str, file_url: str):
	"""Register one allowance/award workbook for the monthly-final gate.

	It remains a separate source batch so an upload never overwrites the prior
	confirmed version and the eventual monthly snapshot can be audited.
	"""
	_require_processing_manager()
	company, attendance_month = _require_company(company), _require_month(attendance_month)
	source_type = _require_monthly_support_source_type(source_type)
	if not file_url:
		frappe.throw(_("请先上传来源文件。"))
	if not file_url.lower().split("?", 1)[0].endswith(".xlsx"):
		frappe.throw(_("月度补充来源仅接受 .xlsx 文件。"))
	batch = frappe.get_doc({
		"doctype": IMPORT_BATCH_DOCTYPE,
		"company": company,
		"attendance_month": attendance_month,
		"source_file": file_url,
		"source_type": source_type,
		"source_checksum": _file_checksum(file_url),
		"status": "待加工",
		"imported_by": frappe.session.user,
		"imported_on": now_datetime(),
		"notes": _json({"attendance_processing_center": {
			"source_version": now_datetime().isoformat(),
			"registered_by": frappe.session.user,
			"monthly_support": True,
		}}),
	}).insert(ignore_permissions=True)
	return {"batch": batch.name, "source_type": source_type, "status": batch.status, "file_url": file_url}


@frappe.whitelist()
def precheck_monthly_support_file(company: str, attendance_month: str, source_type: str):
	_require_processing_manager()
	company, attendance_month = _require_company(company), _require_month(attendance_month)
	source_type = _require_monthly_support_source_type(source_type)
	batch = _latest_batch(company, attendance_month, source_type)
	if not batch:
		frappe.throw(_("请先上传该月度补充来源文件。"))
	if batch.status == "已确认" and frappe.db.count(PROCESSING_RECORD_DOCTYPE, {"import_batch": batch.name}):
		frappe.throw(_("该来源已经确认；如需更正，请上传新的来源版本。"))
	precheck = _monthly_support_precheck(batch)
	if precheck["is_valid"]:
		batch.status = "待加工"
		batch.daily_sheet_rows = cint(precheck.get("record_count"))
	else:
		batch.status = "结构异常"
	batch.save(ignore_permissions=True)
	_save_batch_notes(batch, {"monthly_support_precheck": precheck, "metrics": {"source_rows": cint(precheck.get("record_count"))}})
	return {"batch": batch.name, "source_type": source_type, "status": batch.status, "precheck": precheck}


@frappe.whitelist()
def process_monthly_support_file(company: str, attendance_month: str, source_type: str):
	"""Create auditable rows and send only uncertain values to the shared queue."""
	_require_processing_manager()
	company, attendance_month = _require_company(company), _require_month(attendance_month)
	source_type = _require_monthly_support_source_type(source_type)
	batch = _latest_batch(company, attendance_month, source_type)
	if not batch:
		frappe.throw(_("请先上传该月度补充来源文件。"))
	if batch.status == "已确认" and frappe.db.count(PROCESSING_RECORD_DOCTYPE, {"import_batch": batch.name}):
		frappe.throw(_("该来源已经确认；如需更正，请上传新的来源版本。"))
	# 前台不再暴露“预检”这一步；点击加工时自动执行结构校验，
	# 只有失败才留在卡片上提示用户重新上传。
	precheck = _monthly_support_precheck(batch)
	_save_batch_notes(batch, {"monthly_support_precheck": precheck})
	if not precheck.get("is_valid"):
		batch.status = "结构异常"
		batch.save(ignore_permissions=True)
		frappe.throw(precheck.get("message") or _("来源文件结构不符合要求。"))
	result = _process_monthly_support_rows(batch)
	_persist_processed_rows(batch, result)
	batch.status = result["status"]
	batch.daily_sheet_rows = cint(result["metrics"]["source_rows"])
	batch.save(ignore_permissions=True)
	processed_result = _export_processed_result(batch)
	_save_batch_notes(batch, {
		"metrics": result["metrics"],
		"processed_result": processed_result,
		"processed_on": now_datetime().isoformat(),
		"monthly_support_processing_version": 1,
	})
	return {"batch": batch.name, "source_type": source_type, "status": batch.status, "metrics": result["metrics"], "processed_result": processed_result}


@frappe.whitelist()
def confirm_monthly_support_file(company: str, attendance_month: str, source_type: str):
	_require_processing_manager()
	company, attendance_month = _require_company(company), _require_month(attendance_month)
	source_type = _require_monthly_support_source_type(source_type)
	batch = _latest_batch(company, attendance_month, source_type)
	if not batch:
		frappe.throw(_("尚未上传该月度补充来源文件。"))
	if batch.status == "已确认":
		frappe.throw(_("该来源已经确认；如需更正，请上传新的来源版本。"))
	precheck = _processing_meta(batch).get("monthly_support_precheck") or {}
	if not precheck.get("is_valid"):
		frappe.throw(_("请先通过文件结构预检后再确认该来源。"))
	rows = frappe.get_all(PROCESSING_RECORD_DOCTYPE, filters={"import_batch": batch.name}, fields=["name", "review_status"], limit_page_length=0)
	if not rows:
		frappe.throw(_("请先完成加工检查；月度补充来源不能跳过异常处理。"))
	pending_review_rows = sum(1 for row in rows if row.review_status == "待审核")
	if pending_review_rows:
		frappe.throw(_("该来源仍有 {0} 条待处理异常，请先在“异常处理”完成审核。").format(pending_review_rows))
	batch.status = "已确认"
	batch.save(ignore_permissions=True)
	_save_batch_notes(batch, {"monthly_support_confirmed_on": now_datetime().isoformat(), "monthly_support_confirmed_by": frappe.session.user})
	return {"batch": batch.name, "source_type": source_type, "status": batch.status, "record_count": cint(precheck.get("record_count"))}


@frappe.whitelist()
def precheck_source_slot(company: str, attendance_month: str, source_type: str):
	_require_processing_manager()
	company, attendance_month, source_type = _require_company(company), _require_month(attendance_month), _require_source_type(source_type)
	batch = _latest_batch(company, attendance_month, source_type)
	if not batch:
		frappe.throw(_("请先上传该来源文件。"))
	precheck = _precheck(batch)
	row_count = precheck["row_count"]
	if source_type == "attendance_draft":
		batch.daily_sheet_rows = row_count
	else:
		batch.apple_sheet_rows = row_count
	_save_batch_notes(batch, {"precheck": precheck, "metrics": {"source_rows": row_count, "processed_rows": 0, "exception_rows": 0}})
	return {"batch": batch.name, "source_type": source_type, "status": batch.status, "precheck": precheck}


@frappe.whitelist()
def process_source_slot(company: str, attendance_month: str, source_type: str):
	_require_processing_manager()
	company, attendance_month, source_type = _require_company(company), _require_month(attendance_month), _require_source_type(source_type)
	batch = _latest_batch(company, attendance_month, source_type)
	if not batch:
		frappe.throw(_("请先上传该来源文件。"))
	if frappe.db.count(PROCESSING_RECORD_DOCTYPE, {"import_batch": batch.name}):
		return {"batch": batch.name, "status": batch.status, "processed_result": _processing_meta(batch).get("processed_result"), "message": _("该来源版本已加工；如需重新处理，请重新上传形成新版本。")}
	result = _process_batch(batch)
	_persist_processed_rows(batch, result)
	batch.status = result["status"]
	processed_result = _export_processed_result(batch)
	_save_batch_notes(batch, {"precheck": result.get("structure_precheck"), "metrics": result.get("metrics", {}), "processed_result": processed_result, "processed_on": now_datetime().isoformat()})
	return {"batch": batch.name, "source_type": source_type, "status": batch.status, "processed_result": processed_result, "metrics": result.get("metrics", {})}


@frappe.whitelist()
def list_processing_results(company: str, attendance_month: str, source_type: str, exception_only: int = 0, page_length: int = 500):
	_require_processing_manager()
	company, attendance_month, source_type = _require_company(company), _require_month(attendance_month), _require_processing_source_type(source_type)
	batch = _latest_batch(company, attendance_month, source_type)
	if not batch:
		return {"processed_rows": [], "can_confirm": False}
	rows = _result_rows(batch, min(max(cint(page_length), 1), 5000))
	if cint(exception_only):
		rows = [row for row in rows if row["exception_codes"] and row["review_status"] == "待审核"]
	return {"batch": batch.name, "processed_rows": rows, "processed_result": _processing_meta(batch).get("processed_result"), "can_confirm": bool(rows) or batch.status in {"待处理异常", "待确认"}}


@frappe.whitelist()
def export_processing_result(company: str, attendance_month: str, source_type: str):
	"""Generate the one current result file from persisted review values."""
	_require_processing_manager()
	company, attendance_month, source_type = _require_company(company), _require_month(attendance_month), _require_processing_source_type(source_type)
	batch = _latest_batch(company, attendance_month, source_type)
	if not batch:
		frappe.throw(_("尚未上传该来源文件。"))
	if not frappe.db.count(PROCESSING_RECORD_DOCTYPE, {"import_batch": batch.name}):
		frappe.throw(_("该来源尚未完成加工，不能下载加工结果。"))
	processed_result = _export_processed_result(batch)
	_save_batch_notes(batch, {
		"processed_result": processed_result,
		"processed_result_refreshed_on": now_datetime().isoformat(),
		"processed_result_refresh_reason": "manual_download",
	})
	return {"batch": batch.name, "source_type": source_type, "processed_result": processed_result}


@frappe.whitelist()
def get_processing_record(company: str, attendance_month: str, source_type: str, record_id: str):
	_require_processing_manager()
	_require_company(company)
	_require_month(attendance_month)
	_require_processing_source_type(source_type)
	doc = frappe.get_doc(PROCESSING_RECORD_DOCTYPE, record_id)
	if doc.company != company or doc.attendance_month != attendance_month or doc.source_type != source_type:
		frappe.throw(_("无权读取该加工记录。"))
	row = _serialize_record(doc.as_dict())
	editable = sorted(set((row["proposed_value"] or {}).keys()) | set((row["confirmed_value"] or {}).keys()))
	row["editable_fields"] = [{"fieldname": field, "label": PROCESSING_FIELD_LABELS.get(field, "人工调整字段"), "value": (row["confirmed_value"] or row["proposed_value"] or {}).get(field)} for field in editable]
	row["editable_fields"].insert(0, {"fieldname": "__review_decision__", "label": "仅记录处理决定（不改数值）", "value": ""})
	return row


@frappe.whitelist()
def update_processing_record(company: str, attendance_month: str, source_type: str, record_id: str, field_name: str, original_value: str = "", new_value: str = "", review_status: str = "待审核", reason: str = ""):
	_require_processing_manager()
	company, attendance_month, source_type = _require_company(company), _require_month(attendance_month), _require_processing_source_type(source_type)
	if review_status not in {"待审核", "已通过", "已驳回"}:
		frappe.throw(_("审核决定无效。"))
	if not (reason or "").strip():
		frappe.throw(_("人工调整必须填写原因。"))
	doc = frappe.get_doc(PROCESSING_RECORD_DOCTYPE, record_id)
	if doc.company != company or doc.attendance_month != attendance_month or doc.source_type != source_type:
		frappe.throw(_("无权修改该加工记录。"))
	proposed = _loads(doc.proposed_value_json, {})
	confirmed = _loads(doc.confirmed_value_json, None) or dict(proposed)
	decision_only = field_name == "__review_decision__"
	if decision_only and review_status == doc.review_status:
		frappe.throw(_("该记录已经完成相同处理；如需更正，请选择具体字段后提交新的调整。"))
	if not decision_only and field_name not in proposed and field_name not in confirmed:
		frappe.throw(_("不能修改未声明的加工字段。"))
	old_confirmed = deepcopy_json(confirmed)
	if not decision_only:
		confirmed[field_name] = _loads(new_value, new_value)
	history = _loads(doc.review_history_json, [])
	history.append({
		"old_value": old_confirmed,
		"new_value": deepcopy_json(confirmed),
		"field_name": field_name,
		"original_value": _loads(original_value, original_value) if not decision_only else deepcopy_json(old_confirmed),
		"reason": reason,
		"review_status": review_status,
		"reviewer": frappe.session.user,
		"reviewed_on": now_datetime().isoformat(),
	})
	doc.confirmed_value_json = _json(confirmed)
	# Keep source-specific display fields (for example Apple-tree date, project
	# and approval columns) while applying the latest reviewed editable value.
	# Earlier code replaced the whole projection with five editable fields.
	processed_value = _loads(doc.processed_value_json, {})
	if not isinstance(processed_value, dict):
		processed_value = {}
	processed_value.update(confirmed if review_status == "已通过" else proposed)
	doc.processed_value_json = _json(processed_value)
	# DingTalk forgot-punch exports normally omit 工号.  If an administrator
	# resolves the employee in review, persist that confirmed identity so the
	# current grid, export and sort key reflect the same business code.
	for identity_field, apple_field in (("employee_code", "工号"), ("employee_name", "姓名"), ("department", "部门")):
		identity_value = _row_value(confirmed, identity_field, apple_field)
		if identity_value not in (None, ""):
			setattr(doc, identity_field, identity_value)
	doc.review_status = review_status
	doc.reviewer = frappe.session.user
	doc.reviewed_on = now_datetime()
	doc.review_note = reason
	doc.review_history_json = _json(history)
	doc.eligible_for_downstream = 1 if review_status == "已通过" and _confirmed_downstream_eligible(confirmed) else 0
	doc.save(ignore_permissions=True)
	batch = frappe.get_doc(IMPORT_BATCH_DOCTYPE, doc.import_batch)
	batch_status = _refresh_batch_review_status(batch)
	# The stored file URL must always reflect the current persistent record, not
	# the original processing-time snapshot. Historical files remain untouched;
	# the batch points only at the newest auditable export.
	processed_result = _export_processed_result(batch)
	_save_batch_notes(batch, {
		"processed_result": processed_result,
		"processed_result_refreshed_on": now_datetime().isoformat(),
		"processed_result_refresh_reason": "manual_review_update",
	})
	result = _serialize_record(doc.as_dict())
	result["batch_status"] = batch_status
	result["processed_result"] = processed_result
	return result


@frappe.whitelist()
def bulk_update_processing_records(
	company: str,
	attendance_month: str,
	source_type: str,
	record_ids: str | list[str],
	review_status: str = "待审核",
	reason: str = "",
):
	"""Apply one reviewed decision to explicitly selected exception records.

	This is deliberately a *decision-only* batch action: it does not invent or
	overwrite attendance figures.  Each selected record receives its own audit
	history entry, exactly as it would through the single-record review dialog.
	"""
	_require_processing_manager()
	company, attendance_month, source_type = _require_company(company), _require_month(attendance_month), _require_processing_source_type(source_type)
	if review_status not in {"待审核", "已通过", "已驳回"}:
		frappe.throw(_("审核决定无效。"))
	if not (reason or "").strip():
		frappe.throw(_("批量处理必须填写原因。"))
	if isinstance(record_ids, str):
		record_ids = _loads(record_ids, [])
	if not isinstance(record_ids, list):
		frappe.throw(_("请选择要批量处理的记录。"))
	record_ids = list(dict.fromkeys(str(record_id).strip() for record_id in record_ids if str(record_id).strip()))
	if not record_ids:
		frappe.throw(_("请选择至少一条异常记录。"))
	if len(record_ids) > 500:
		frappe.throw(_("一次最多批量处理 500 条记录。"))
	batch = _latest_batch(company, attendance_month, source_type)
	if not batch:
		frappe.throw(_("尚未上传该来源文件。"))
	rows = frappe.get_all(
		PROCESSING_RECORD_DOCTYPE,
		filters={"name": ["in", record_ids]},
		fields=["name", "import_batch", "exception_codes", "review_status"],
		limit_page_length=len(record_ids),
	)
	if len(rows) != len(record_ids) or any(row.import_batch != batch.name for row in rows):
		frappe.throw(_("所选记录不属于当前来源的最新加工版本，请刷新后重试。"))
	if any(not _loads(row.exception_codes, []) for row in rows):
		frappe.throw(_("批量处理仅适用于异常记录；正常记录无需审核。"))
	if any(row.review_status != "待审核" for row in rows):
		frappe.throw(_("所选记录已经处理。若需更正，请逐条使用“查看/更正记录”。"))

	processed_at = now_datetime()
	for record_id in record_ids:
		doc = frappe.get_doc(PROCESSING_RECORD_DOCTYPE, record_id)
		proposed = _loads(doc.proposed_value_json, {})
		confirmed = _loads(doc.confirmed_value_json, None) or dict(proposed)
		old_confirmed = deepcopy_json(confirmed)
		history = _loads(doc.review_history_json, [])
		history.append({
			"old_value": old_confirmed,
			"new_value": deepcopy_json(confirmed),
			"field_name": "__review_decision__",
			"original_value": deepcopy_json(old_confirmed),
			"reason": reason.strip(),
			"review_status": review_status,
			"reviewer": frappe.session.user,
			"reviewed_on": processed_at.isoformat(),
		})
		doc.confirmed_value_json = _json(confirmed)
		processed_value = _loads(doc.processed_value_json, {})
		if not isinstance(processed_value, dict):
			processed_value = {}
		processed_value.update(confirmed if review_status == "已通过" else proposed)
		doc.processed_value_json = _json(processed_value)
		doc.review_status = review_status
		doc.reviewer = frappe.session.user
		doc.reviewed_on = processed_at
		doc.review_note = reason.strip()
		doc.review_history_json = _json(history)
		doc.eligible_for_downstream = 1 if review_status == "已通过" and _confirmed_downstream_eligible(confirmed) else 0
		doc.save(ignore_permissions=True)

	batch_status = _refresh_batch_review_status(batch)
	processed_result = _export_processed_result(batch)
	_save_batch_notes(batch, {
		"processed_result": processed_result,
		"processed_result_refreshed_on": processed_at.isoformat(),
		"processed_result_refresh_reason": "bulk_manual_review_update",
	})
	all_rows = frappe.get_all(
		PROCESSING_RECORD_DOCTYPE,
		filters={"import_batch": batch.name},
		fields=["review_status", "eligible_for_downstream"],
		limit_page_length=0,
	)
	return {
		"batch": batch.name,
		"source_type": source_type,
		"updated_rows": len(record_ids),
		"review_status": review_status,
		"batch_status": batch_status,
		"included_rows": sum(1 for row in all_rows if cint(row.eligible_for_downstream)),
		"rejected_rows": sum(1 for row in all_rows if row.review_status == "已驳回"),
		"processed_result": processed_result,
	}


def deepcopy_json(value):
	return _loads(_json(value), value)


@frappe.whitelist()
def confirm_source_result(company: str, attendance_month: str, source_type: str):
	_require_processing_manager()
	company, attendance_month, source_type = _require_company(company), _require_month(attendance_month), _require_source_type(source_type)
	batch = _latest_batch(company, attendance_month, source_type)
	if not batch:
		frappe.throw(_("尚未上传该来源文件。"))
	if batch.status == "已确认":
		frappe.throw(_("该来源已经确认；如需更正，请使用“查看/更正记录”。"))
	rows = frappe.get_all(PROCESSING_RECORD_DOCTYPE, filters={"import_batch": batch.name}, fields=["name", "review_status", "eligible_for_downstream"], limit_page_length=0)
	if not rows:
		frappe.throw(_("该来源尚未生成任何加工记录，不能确认。请先检查来源文件和结构预检结果。"))
	# Pending records are deliberately excluded from downstream calculations,
	# not used to block every matching employee in this source from proceeding.
	pending_review_rows = [row for row in rows if row.review_status == "待审核"]
	batch.status = "已确认"
	batch.save(ignore_permissions=True)
	_save_batch_notes(batch, {
		"confirmed_with_pending_reviews": bool(pending_review_rows),
		"pending_review_rows": len(pending_review_rows),
		"confirmation_note": "待审核记录不会阻塞来源确认，且不计入下游计算。",
	})
	return {
		"batch": batch.name,
		"status": batch.status,
		"confirmed_rows": len(rows),
		"included_rows": sum(1 for row in rows if cint(row.eligible_for_downstream)),
		"pending_review_rows": len(pending_review_rows),
		"confirmed_with_pending_reviews": bool(pending_review_rows),
		"rejected_rows": sum(1 for row in rows if row.review_status == "已驳回"),
	}


@frappe.whitelist()
def list_processing_exceptions(company: str, attendance_month: str, source_type: str = "", page_length: int = 500):
	_require_processing_manager()
	company, attendance_month = _require_company(company), _require_month(attendance_month)
	if source_type:
		_require_processing_source_type(source_type)
	batches = [_latest_batch(company, attendance_month, source) for source in SOURCE_TYPES + MONTHLY_SUPPORT_SOURCE_TYPES]
	all_batch_names = [batch.name for batch in batches if batch]
	batch_names = [batch.name for batch in batches if batch and (not source_type or batch.source_type == source_type)]
	total_pending_count = frappe.db.count(PROCESSING_RECORD_DOCTYPE, {"import_batch": ["in", all_batch_names], "review_status": "待审核"}) if all_batch_names else 0
	filtered_pending_count = frappe.db.count(PROCESSING_RECORD_DOCTYPE, {"import_batch": ["in", batch_names], "review_status": "待审核"}) if batch_names else 0
	if not batch_names:
		return {"review_rows": [], "total_pending_count": total_pending_count, "filtered_pending_count": 0, "source_type": source_type}
	records = frappe.get_all(
		PROCESSING_RECORD_DOCTYPE,
		# The work queue contains only unresolved records.  Resolved exceptions
		# remain in the source result and manual-adjustment ledger for traceability.
		filters={"import_batch": ["in", batch_names], "exception_codes": ["!=", "[]"], "review_status": "待审核"},
		fields=["name", "employee_code", "employee_name", "department", "source_type", "exception_codes", "exception_message", "review_status", "proposed_value_json", "confirmed_value_json", "reviewer", "reviewed_on", "review_note", "source_file", "source_sheet", "source_row", "source_id", "approval_no"],
		order_by="modified desc",
		limit_page_length=min(max(cint(page_length), 1), 5000),
	)
	return {"review_rows": [_serialize_record(row) for row in records], "total_pending_count": total_pending_count, "filtered_pending_count": filtered_pending_count, "source_type": source_type}


@frappe.whitelist()
def list_processing_batches(company: str, attendance_month: str, page_length: int = 100):
	_require_processing_manager()
	company, attendance_month = _require_company(company), _require_month(attendance_month)
	latest = {}
	for source_type in SOURCE_TYPES:
		batch = _latest_batch(company, attendance_month, source_type)
		if batch:
			latest[source_type] = batch
	if not latest:
		return {"items": []}
	created_at = min((batch.creation for batch in latest.values()), default="")
	return {
		"items": [{
			"batch_id": f"{company}:{attendance_month}",
			"attendance_month": attendance_month,
			"attendance_draft_status": latest.get("attendance_draft").status if latest.get("attendance_draft") else "未上传",
			"apple_tree_status": latest.get("apple_tree").status if latest.get("apple_tree") else "未上传",
			"missing_card_status": latest.get("missing_card").status if latest.get("missing_card") else "未上传",
			"created_at": created_at,
		}][: min(max(cint(page_length), 1), 200)]
	}


@frappe.whitelist()
def list_manual_adjustments(company: str, attendance_month: str, page_length: int = 500):
	_require_processing_manager()
	company, attendance_month = _require_company(company), _require_month(attendance_month)
	records = frappe.get_all(
		PROCESSING_RECORD_DOCTYPE,
		filters={"company": company, "attendance_month": attendance_month, "review_history_json": ["!=", "[]"]},
		fields=["name", "employee_code", "employee_name", "source_type", "review_history_json"],
		order_by="modified desc",
		limit_page_length=min(max(cint(page_length), 1), 5000),
	)
	items = []
	for record in records:
		for event in _loads(record.review_history_json, []):
			items.append({"record_id": record.name, "employee_code": record.employee_code, "employee_name": record.employee_name, "source_type": record.source_type, "field_name": event.get("field_name", ""), "original_value": event.get("old_value"), "new_value": event.get("new_value"), "reason": event.get("reason", ""), "modified_by": event.get("reviewer", ""), "modified_at": event.get("reviewed_on", "")})
	return {"items": items[: min(max(cint(page_length), 1), 5000)]}


@frappe.whitelist()
def get_processing_configuration(company: str, configuration_type: str):
	_require_processing_manager()
	_require_company(company)
	if configuration_type == "field-mapping":
		return {"items": [{"name": "考勤初稿", "source_value": "钉钉每日明细明确数值列", "target_value": "标准工时、实际出勤、加班、夜班、请假、排休、旷工", "status": "已发布"}]}
	if configuration_type == "department-mapping":
		return {"items": [{"name": "员工匹配", "source_value": "工号为主键；姓名与部门辅助", "target_value": "冲突进入统一待审核", "status": "已发布"}]}
	return {"items": [{"name": "自动化边界", "source_value": "特殊工时与样例人工差异", "target_value": "不猜测；进入其他来源或统一审核", "status": "已发布"}]}


def _finalization_inputs(company, attendance_month, slots):
	by_source = {slot["source_type"]: slot for slot in slots}
	inputs = []
	for source_type in SOURCE_TYPES:
		slot = by_source.get(source_type)
		ready = bool(slot and slot["status"] == "已确认" and not cint(slot.get("exception_count")))
		inputs.append({"key": source_type, "source_type": source_type, "label": SOURCE_LABELS[source_type], "status": "已就绪" if ready else slot["status"] if slot else "未就绪", "ready": ready, "snapshot_version": ""})
	for source_type in MONTHLY_SUPPORT_SOURCE_TYPES:
		batch = _latest_batch(company, attendance_month, source_type)
		meta = _processing_meta(batch) if batch else {}
		precheck = meta.get("monthly_support_precheck") or {}
		processed_rows = frappe.db.count(PROCESSING_RECORD_DOCTYPE, {"import_batch": batch.name}) if batch else 0
		pending_exception_count = frappe.db.count(PROCESSING_RECORD_DOCTYPE, {"import_batch": batch.name, "review_status": "待审核"}) if batch else 0
		needs_processing = bool(batch and batch.status == "已确认" and not processed_rows)
		inputs.append({
			"key": source_type,
			"source_type": source_type,
			"label": SOURCE_LABELS[source_type],
			"kind": "月度补充来源",
			"status": "需补做加工检查" if needs_processing else "已就绪" if batch and batch.status == "已确认" else batch.status if batch else "未就绪",
			"ready": bool(batch and batch.status == "已确认" and not needs_processing),
			"snapshot_version": "",
			"source_file": batch.source_file if batch else "",
			"source_file_name": Path(batch.source_file).name if batch and batch.source_file else "",
			"record_count": cint(precheck.get("record_count")),
			"processed_rows": processed_rows,
			"pending_exception_count": pending_exception_count,
			"can_precheck": bool(batch and batch.source_file and (batch.status in {"待加工", "预览", "已导入"} or needs_processing)),
			"can_process": bool(batch and precheck.get("is_valid") and not processed_rows and batch.status == "待加工"),
			"can_confirm": bool(batch and precheck.get("is_valid") and processed_rows and not pending_exception_count and batch.status == "待确认"),
			"description": MONTHLY_SUPPORT_SOURCE_CONFIG[source_type]["description"],
		})
	return inputs


FINAL_SIGNED_COLUMNS = (
	("employee_code", "工号"), ("employee_name", "姓名"), ("department", "部门"),
	("standard_hours", "标准工时"), ("actual_attendance_hours", "实际出勤"),
	("workday_overtime_hours", "工作日加班"), ("restday_overtime_hours", "休息日加班"), ("holiday_overtime_hours", "节假日加班"),
	("large_night_shifts", "大夜班"), ("small_night_shifts", "小夜班"),
	("personal_leave_hours", "事假"), ("sick_leave_hours", "病假"), ("annual_leave_hours", "特休"),
	("work_injury_hours", "工伤"), ("rest_arrangement_hours", "排休"), ("absence_hours", "旷工"),
	("clock_in_missing_count", "上班漏打卡"), ("clock_out_missing_count", "下班漏打卡"),
	("red_apples", "红苹果"), ("red_apple_amount", "红苹果金额"),
	("housing_allowance", "住房补贴"), ("full_attendance_award", "全勤奖"), ("special_hours", "特殊工时"),
	("employee_signature", "员工签字"), ("review_note", "备注"),
)
FINAL_FINANCE_COLUMNS = (
	("employee_code", "工号"), ("employee_name", "姓名"), ("department", "部门"),
	("actual_attendance_hours", "实际出勤"), ("workday_overtime_hours", "工作日加班"),
	("restday_overtime_hours", "休息日加班"), ("holiday_overtime_hours", "节假日加班"),
	("large_night_shifts", "大夜班"), ("small_night_shifts", "小夜班"),
	("absence_hours", "旷工"), ("red_apple_amount", "红苹果金额"), ("housing_allowance", "住房补贴"),
	("full_attendance_award", "全勤奖"), ("special_hours", "特殊工时"),
)


def _as_number(value: Any) -> float:
	try:
		return 0.0 if value in (None, "") else float(value)
	except (TypeError, ValueError):
		return 0.0


def _final_snapshot_batches(company: str, attendance_month: str):
	return {source_type: _latest_batch(company, attendance_month, source_type) for source_type in SOURCE_TYPES + MONTHLY_SUPPORT_SOURCE_TYPES}


def _processing_state_hash(batch) -> str:
	"""Fingerprint the reviewed values that are allowed into the monthly final."""
	rows = frappe.get_all(
		PROCESSING_RECORD_DOCTYPE,
		filters={"import_batch": batch.name},
		fields=["name", "review_status", "eligible_for_downstream", "confirmed_value_json", "modified"],
		order_by="name asc",
		limit_page_length=5000,
	)
	return hashlib.sha256(_json(rows).encode()).hexdigest()


def _monthly_snapshot_version(batches: dict[str, Any]) -> str:
	"""Create one version from both source files and reviewed processing values."""
	material = [
		{
			"source_type": source_type,
			"batch": batch.name,
			"checksum": batch.source_checksum,
			"processing_state": _processing_state_hash(batch),
		}
		for source_type, batch in sorted(batches.items())
	]
	return hashlib.sha256(_json(material).encode()).hexdigest()[:16]


def _monthly_final_rows(batches: dict[str, Any]):
	"""Aggregate confirmed processing rows without recalculating their source facts."""
	rows_by_employee = defaultdict(dict)
	for source_type, batch in batches.items():
		if not batch:
			continue
		for record in _result_rows(batch, 5000):
			if not record.get("eligible_for_downstream"):
				continue
			values = _effective_result_values(record)
			code = str(values.get("employee_code") or record.get("employee_code") or "").strip()
			name = str(values.get("employee_name") or record.get("employee_name") or "").strip()
			if not code and not name:
				continue
			key = code or f"name:{name}"
			output = rows_by_employee[key]
			output.setdefault("employee_code", code)
			output.setdefault("employee_name", name)
			output.setdefault("department", values.get("department") or record.get("department") or "")
			if source_type == "attendance_draft":
				for field, _label in ATTENDANCE_DRAFT_RESULT_COLUMNS:
					output[field] = values.get(field, output.get(field, 0))
			elif source_type == "missing_card":
				output["red_apples"] = _as_number(output.get("red_apples")) + _as_number(values.get("red_apples"))
				output["red_apple_amount"] = _as_number(output.get("red_apple_amount")) + _as_number(values.get("amount"))
			elif source_type == "apple_tree":
				apple_count = _as_number(values.get("有效苹果数"))
				if "红" in str(values.get("苹果类型") or ""):
					output["red_apples"] = _as_number(output.get("red_apples")) + apple_count
			elif source_type in {"housing_allowance", "full_attendance", "special_hours"}:
				field = MONTHLY_SUPPORT_SOURCE_CONFIG[source_type]["value_field"]
				output[field] = _as_number(output.get(field)) + _as_number(values.get(field))
	return sorted(rows_by_employee.values(), key=lambda row: (str(row.get("department") or ""), str(row.get("employee_code") or ""), str(row.get("employee_name") or "")))


def _save_monthly_final_file(attendance_month: str, title: str, columns, rows):
	from openpyxl import Workbook
	from frappe.utils.file_manager import save_file

	book = Workbook()
	sheet = book.active
	sheet.title = title
	sheet.append([label for _field, label in columns])
	for row in rows:
		sheet.append([row.get(field, 0 if field not in {"employee_code", "employee_name", "department", "employee_signature", "review_note"} else "") for field, _label in columns])
	for column in sheet.columns:
		sheet.column_dimensions[column[0].column_letter].width = min(max(max(len(str(cell.value or "")) for cell in column) + 2, 12), 24)
	sheet.freeze_panes = "A2"
	output = BytesIO()
	book.save(output)
	file = save_file(f"{attendance_month}_{title}.xlsx", output.getvalue(), None, None, is_private=1)
	return {"file_url": file.file_url, "file_name": file.file_name}


@frappe.whitelist()
def generate_monthly_final_files(company: str, attendance_month: str, snapshot_version: str = ""):
	_require_processing_manager()
	company, attendance_month = _require_company(company), _require_month(attendance_month)
	state = get_processing_batch(company, attendance_month)
	readiness = state["finalization_inputs"]
	blocked = [item for item in readiness if not item["ready"]]
	if blocked:
		return {"blocked": True, "reason": _("月度终稿来源未完备，尚未生成任何文件。"), "readiness": readiness, "missing_sources": [item["label"] for item in blocked]}
	batches = _final_snapshot_batches(company, attendance_month)
	if any(not batch for batch in batches.values()):
		return {"blocked": True, "reason": _("终稿来源不完整，尚未生成文件。"), "readiness": readiness}
	locked_snapshot_version = _monthly_snapshot_version(batches)
	anchor_batch = batches["attendance_draft"]
	existing_outputs = _processing_meta(anchor_batch).get("monthly_final_outputs", {})
	if existing_outputs.get("locked_snapshot_version") == locked_snapshot_version and existing_outputs.get("signed_file_url") and existing_outputs.get("finance_file_url"):
		return {"blocked": False, "readiness": readiness, "final_outputs": existing_outputs, "snapshot_version": locked_snapshot_version}
	rows = _monthly_final_rows(batches)
	if not rows:
		return {"blocked": True, "reason": _("没有可进入下游的员工数据，尚未生成终稿。"), "readiness": readiness}
	signed = _save_monthly_final_file(attendance_month, "员工签字版", FINAL_SIGNED_COLUMNS, rows)
	finance = _save_monthly_final_file(attendance_month, "财务版", FINAL_FINANCE_COLUMNS, rows)
	final_outputs = {
		"locked_version": locked_snapshot_version,
		"locked_snapshot_version": locked_snapshot_version,
		"signed_file_url": signed["file_url"],
		"signed_file_name": signed["file_name"],
		"finance_file_url": finance["file_url"],
		"finance_file_name": finance["file_name"],
		"generated_on": now_datetime().isoformat(),
		"employee_count": len(rows),
	}
	_save_batch_notes(anchor_batch, {"monthly_final_outputs": final_outputs})
	return {"blocked": False, "readiness": readiness, "final_outputs": final_outputs, "snapshot_version": locked_snapshot_version}


@frappe.whitelist()
def get_monthly_final_preview(company: str, attendance_month: str, kind: str = "signed"):
	"""Return the exact current locked-final table for in-system review."""
	_require_processing_manager()
	company, attendance_month = _require_company(company), _require_month(attendance_month)
	if kind not in {"signed", "finance"}:
		frappe.throw(_("终稿预览类型不正确。"))
	state = get_processing_batch(company, attendance_month)
	outputs = state.get("final_outputs") or {}
	if not outputs.get("locked_snapshot_version"):
		return {"available": False, "reason": _("请先锁定并生成月度终稿。")}
	batches = _final_snapshot_batches(company, attendance_month)
	if any(not batch for batch in batches.values()):
		return {"available": False, "reason": _("终稿来源不完整，无法提供预览。")}
	current_version = _monthly_snapshot_version(batches)
	if current_version != outputs.get("locked_snapshot_version"):
		return {"available": False, "stale": True, "reason": _("来源或人工审核已变化，请重新锁定并生成终稿后再查看。")}
	columns = FINAL_SIGNED_COLUMNS if kind == "signed" else FINAL_FINANCE_COLUMNS
	return {
		"available": True,
		"kind": kind,
		"title": _("员工签字版") if kind == "signed" else _("财务版"),
		"locked_snapshot_version": current_version,
		"columns": [{"field": field, "label": label} for field, label in columns],
		"rows": _monthly_final_rows(batches),
	}
