"""Pure processing rules for uploaded DingTalk missed-punch records.

This module deliberately has no Frappe or workbook dependency.  Upload code can
parse a worksheet into dictionaries, call the processor, then persist the raw
rows and the single standardized processing result in audit-aware records
without overwriting the source data.
"""

from __future__ import annotations

import re
from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any, Iterable, Mapping, Sequence



FIELD_ALIASES = {
	"source_id": ("source_id", "数据id", "数据ID", "数据Id"),
	"approval_no": ("approval_no", "审批编号", "审批单号"),
	"created_at": ("created_at", "创建时间", "申请时间"),
	"punch_time": ("punch_time", "补卡时间", "打卡时间"),
	"employee_code": ("employee_code", "工号", "员工工号", "员工编号"),
	"employee_name": ("employee_name", "创建人", "姓名", "员工姓名"),
	"department": ("department", "创建人部门", "部门", "单位"),
	"punch_type": ("punch_type", "补卡类型"),
	"reason": ("reason", "补卡理由", "理由"),
	"approval_result": ("approval_result", "审批结果"),
	"approval_status": ("approval_status", "审批状态"),
	"source_file": ("source_file",),
	"source_sheet": ("source_sheet",),
	"source_row": ("source_row", "_source_row", "source_row_number"),
	"source_kind": ("source_kind", "来源类型"),
	"manual_reason": ("manual_reason", "人工补录原因", "补录原因"),
	"confirmed_by": ("confirmed_by", "确认人", "人工确认人"),
	"manual_confirmed": ("manual_confirmed", "人工已确认"),
}

REQUIRED_DINGTALK_FIELDS = (
	"source_id",
	"approval_no",
	"punch_time",
	"employee_name",
	"punch_type",
	"approval_result",
	"approval_status",
)

REQUIRED_MONTHLY_SUMMARY_FIELDS = (
	"punch_time",
	"employee_name",
	"punch_type",
)

EXCEPTION_MESSAGES = {
	"INVALID_PUNCH_TIME": "补卡时间无法解析",
	"OUTSIDE_ATTENDANCE_MONTH": "补卡时间不属于当前处理月份",
	"SOURCE_FILE_MISSING": "来源文件缺失",
	"SOURCE_SHEET_MISSING": "来源工作表缺失",
	"SOURCE_ID_MISSING": "钉钉数据ID缺失",
	"APPROVAL_NO_MISSING": "钉钉审批编号缺失",
	"APPROVAL_NOT_APPROVED": "审批结果不是审批通过",
	"APPROVAL_NOT_ENDED": "审批状态不是已结束",
	"DUPLICATE_APPROVAL_NO": "审批编号重复，重复行未自动计入",
	"MULTIPLE_APPROVALS_SAME_PUNCH_TIME": "同一员工同一补卡时间存在多个审批",
	"EMPLOYEE_CODE_MISSING": "无法取得作为主键的员工工号",
	"EMPLOYEE_NOT_FOUND": "无法在员工目录中匹配人员",
	"EMPLOYEE_AMBIGUOUS": "姓名匹配到多个员工，无法确定工号",
	"EMPLOYEE_NAME_CONFLICT": "工号对应姓名与来源姓名不一致",
	"DEPARTMENT_CONFLICT": "来源部门或部门映射与员工目录不一致",
	"FORMER_EMPLOYEE_REQUIRES_CONFIRMATION": "补卡人员为离职员工，需要人工确认口径",
	"OFFLINE_REASON_REQUIRED": "线下补录必须填写补录原因",
	"OFFLINE_CONFIRMER_REQUIRED": "线下补录必须填写确认人",
	"OFFLINE_ENTRY_REQUIRES_CONFIRMATION": "线下补录不能作为钉钉记录自动计入",
}

# These are closed DingTalk outcomes, not records waiting for a reviewer.  The
# original upload remains attached to its import batch, but there is no
# attendance-processing record to review or carry into the monthly result.
AUTO_EXCLUDED_APPROVAL_RESULTS = {"审批未通过", "审批不通过", "未通过", "已拒绝", "拒绝", "驳回", "已驳回"}
AUTO_EXCLUDED_APPROVAL_STATUSES = {"终止", "已终止", "已撤销", "撤销"}

FORMER_EMPLOYEE_STATUSES = {
	"已离职",
	"离职",
	"left",
	"inactive",
	"terminated",
	"disabled",
}

_DINGTALK_DEPARTMENT_IDENTIFIER_RE = re.compile(r"\s*[-－—–]\s*\d+\s*$")


def normalize_department_name(value: Any) -> str:
	"""Remove DingTalk's trailing department identifier (for example `` - 11``)."""
	return _DINGTALK_DEPARTMENT_IDENTIFIER_RE.sub("", _text(value)).strip()


def department_match_key(value: Any) -> str:
	key = re.sub(r"\s+", "", normalize_department_name(value)).casefold()
	return key[:-1] if len(key) > 1 and key[-1:] in {"组", "课", "科"} else key


@dataclass(frozen=True)
class MissedPunchRules:
	"""Configurable decisions that must not be hidden in upload code."""

	business_punch_types: tuple[str, ...] = ("因公补卡", "因公打卡")
	approved_results: tuple[str, ...] = ("审批通过",)
	ended_statuses: tuple[str, ...] = ("已结束",)
	require_approved: bool = True
	require_ended: bool = True
	deduplicate_approval_no: bool = True
	same_time_multiple_policy: str = "exception"
	former_employee_policy: str = "exception"
	red_apples_per_record: int = 2
	amount_per_record: int = 10

	def __post_init__(self):
		if self.same_time_multiple_policy not in {"exception", "include"}:
			raise ValueError("same_time_multiple_policy must be 'exception' or 'include'")
		if self.former_employee_policy not in {"exception", "include"}:
			raise ValueError("former_employee_policy must be 'exception' or 'include'")
		if self.red_apples_per_record < 0 or self.amount_per_record < 0:
			raise ValueError("missed-punch apple and amount rules cannot be negative")


def precheck_missed_punch_structure(headers: Sequence[Any]) -> dict[str, Any]:
	"""Recognize either a DingTalk approval export or HR's monthly register."""

	available = {_text(header): header for header in headers if _text(header)}
	mapping = {}
	for fieldname, aliases in FIELD_ALIASES.items():
		matched = next((available[_text(alias)] for alias in aliases if _text(alias) in available), None)
		if matched is not None:
			mapping[fieldname] = matched
	is_monthly_summary = (
		all(fieldname in mapping for fieldname in REQUIRED_MONTHLY_SUMMARY_FIELDS)
		and not any(fieldname in mapping for fieldname in ("source_id", "approval_no", "approval_result", "approval_status"))
	)
	required = REQUIRED_MONTHLY_SUMMARY_FIELDS if is_monthly_summary else REQUIRED_DINGTALK_FIELDS
	missing = [fieldname for fieldname in required if fieldname not in mapping]
	recognized_headers = {_text(header) for header in mapping.values()}
	unknown = [header for header in headers if _text(header) and _text(header) not in recognized_headers]
	return {
		"is_valid": not missing,
		"status": "结构通过" if not missing else "结构异常",
		"field_mapping": mapping,
		"missing_required_fields": missing,
		"unknown_fields": unknown,
		"source_kind": "monthly_summary" if is_monthly_summary else "dingtalk",
		"source_kind_label": "人资月度汇总表" if is_monthly_summary else "钉钉审批明细",
		"batch_review_note": "月度汇总表不要求逐行补造钉钉审批编号；以原文件、工作表和行号追溯。" if is_monthly_summary else "",
	}


def process_missed_punch_rows(
	rows: Iterable[Mapping[str, Any]],
	*,
	attendance_month: str,
	source_file: str,
	source_sheet: str,
	employee_directory: Iterable[Mapping[str, Any]] | None = None,
	department_mapping: Mapping[str, str] | None = None,
	rules: MissedPunchRules | None = None,
	source_row_start: int = 2,
) -> dict[str, Any]:
	"""Standardize uploaded rows into one user-facing ``processed_rows`` dataset.

	Explicit business-punch and closed-approval exclusions remain in the upload
	layer's immutable raw rows. Every uncertain row (including ``审批中``) remains
	in ``processed_rows`` with unified review fields until a human approves it.
	"""

	_normalize_attendance_month(attendance_month)
	active_rules = rules or MissedPunchRules()
	input_rows = [dict(row) for row in rows]
	headers = _ordered_headers(input_rows)
	structure = precheck_missed_punch_structure(headers)
	by_code, by_name, has_directory = _employee_indexes(employee_directory)
	department_map = {normalize_department_name(key): normalize_department_name(value) for key, value in (department_mapping or {}).items()}
	seen_approvals: dict[str, int] = {}
	processed_rows = []
	excluded_source_rows = 0

	for index, source in enumerate(input_rows):
		record = _standardize_row(
			source,
			attendance_month=attendance_month,
			default_source_file=source_file,
			default_source_sheet=source_sheet,
			default_source_row=source_row_start + index,
			by_code=by_code,
			by_name=by_name,
			has_directory=has_directory,
			department_mapping=department_map,
			rules=active_rules,
		)
		if record["auto_excluded"]:
			excluded_source_rows += 1
			continue
		approval_no = record["approval_no"]
		if (
			record["source_kind"] == "dingtalk"
			and active_rules.deduplicate_approval_no
			and approval_no
		):
			if approval_no in seen_approvals:
				_append_code(record["exception_codes"], "DUPLICATE_APPROVAL_NO")
				record["duplicate_of_source_row"] = seen_approvals[approval_no]
			else:
				seen_approvals[approval_no] = record["source_row"]
		processed_rows.append(record)

	_flag_same_time_multiple_approvals(processed_rows, active_rules)
	for record in processed_rows:
		_finalize_record(record, active_rules)

	status = (
		"已确认"
		if input_rows and not processed_rows and excluded_source_rows == len(input_rows)
		else "待处理异常"
		if any(record["review_status"] == "待审核" for record in processed_rows) or not structure["is_valid"]
		else "待确认"
	)
	return {
		"status": status,
		"structure_precheck": structure,
		"processed_rows": processed_rows,
		"metrics": {
			"source_rows": len(input_rows),
			"processed_rows": len(processed_rows),
			"excluded_source_rows": excluded_source_rows,
			"included_rows": sum(record["included"] for record in processed_rows),
			"review_rows": sum(record["review_status"] == "待审核" for record in processed_rows),
		},
	}


def _standardize_row(
	source: Mapping[str, Any],
	*,
	attendance_month: str,
	default_source_file: str,
	default_source_sheet: str,
	default_source_row: int,
	by_code: Mapping[str, list[dict[str, Any]]],
	by_name: Mapping[str, list[dict[str, Any]]],
	has_directory: bool,
	department_mapping: Mapping[str, str],
	rules: MissedPunchRules,
) -> dict[str, Any]:
	exception_codes: list[str] = []
	rule_codes: list[str] = []
	source_kind = _source_kind(_first_value(source, "source_kind"))
	source_id = _text(_first_value(source, "source_id"))
	approval_no = _text(_first_value(source, "approval_no"))
	punch_time_value = _first_value(source, "punch_time")
	parsed_punch_time = _parse_datetime(punch_time_value)
	raw_employee_code = _text(_first_value(source, "employee_code"))
	raw_employee_name = _text(_first_value(source, "employee_name"))
	raw_department = normalize_department_name(_first_value(source, "department"))
	punch_type = _text(_first_value(source, "punch_type"))
	approval_result = _text(_first_value(source, "approval_result"))
	approval_status = _text(_first_value(source, "approval_status"))
	manual_reason = _text(_first_value(source, "manual_reason"))
	confirmed_by = _text(_first_value(source, "confirmed_by"))
	manual_confirmed = _bool_value(_first_value(source, "manual_confirmed"))
	resolved_source_file = _text(_first_value(source, "source_file")) or _text(default_source_file)
	resolved_source_sheet = _text(_first_value(source, "source_sheet")) or _text(default_source_sheet)
	resolved_source_row = _integer_value(_first_value(source, "source_row"), default_source_row)
	if source_kind == "monthly_summary" and not source_id:
		source_id = f"monthly-summary:{resolved_source_sheet}:{resolved_source_row}"
	if not resolved_source_file:
		_append_code(exception_codes, "SOURCE_FILE_MISSING")
	if not resolved_source_sheet:
		_append_code(exception_codes, "SOURCE_SHEET_MISSING")

	if parsed_punch_time is None:
		_append_code(exception_codes, "INVALID_PUNCH_TIME")
	elif parsed_punch_time.strftime("%Y-%m") != attendance_month:
		if source_kind == "monthly_summary":
			_append_code(rule_codes, "OUTSIDE_ATTENDANCE_MONTH_EXCLUDED")
		else:
			_append_code(exception_codes, "OUTSIDE_ATTENDANCE_MONTH")
	if punch_type in rules.business_punch_types:
		_append_code(rule_codes, "BUSINESS_PUNCH_EXCLUDED")
	if _is_auto_excluded_approval(approval_result, approval_status):
		_append_code(rule_codes, "CLOSED_APPROVAL_EXCLUDED")

	if source_kind == "offline":
		if not manual_reason:
			_append_code(exception_codes, "OFFLINE_REASON_REQUIRED")
		if not confirmed_by:
			_append_code(exception_codes, "OFFLINE_CONFIRMER_REQUIRED")
		_append_code(exception_codes, "OFFLINE_ENTRY_REQUIRES_CONFIRMATION")
	elif source_kind == "dingtalk":
		if not source_id:
			_append_code(exception_codes, "SOURCE_ID_MISSING")
		if not approval_no:
			_append_code(exception_codes, "APPROVAL_NO_MISSING")
		if rules.require_approved and approval_result not in rules.approved_results:
			_append_code(exception_codes, "APPROVAL_NOT_APPROVED")
		if rules.require_ended and approval_status not in rules.ended_statuses:
			_append_code(exception_codes, "APPROVAL_NOT_ENDED")

	identity = _resolve_employee(
		raw_employee_code,
		raw_employee_name,
		raw_department,
		parsed_punch_time,
		by_code=by_code,
		by_name=by_name,
		has_directory=has_directory,
		department_mapping=department_mapping,
		rules=rules,
	)
	for code in identity.pop("exception_codes"):
		_append_code(exception_codes, code)
	for code in identity.pop("rule_codes"):
		_append_code(rule_codes, code)

	return {
		"source_file": resolved_source_file,
		"source_sheet": resolved_source_sheet,
		"source_row": resolved_source_row,
		"source_kind": source_kind,
		"source_id": source_id,
		"approval_no": approval_no,
		"created_at": _text(_first_value(source, "created_at")),
		"punch_time": parsed_punch_time.strftime("%Y-%m-%d %H:%M:%S") if parsed_punch_time else _text(punch_time_value),
		"employee_code": identity["employee_code"],
		"employee_name": identity["employee_name"],
		"department": identity["department"],
		"source_employee_name": raw_employee_name,
		"source_department": raw_department,
		"punch_type": punch_type,
		"reason": _text(_first_value(source, "reason")),
		"approval_result": approval_result,
		"approval_status": approval_status,
		"manual_reason": manual_reason,
		"confirmed_by": confirmed_by,
		"manual_confirmed": manual_confirmed,
		"employment_status": identity["employment_status"],
		"included": False,
		"include_decision": "待人工确认",
		"red_apples": 0,
		"amount": 0,
		"processing_status": "待处理异常",
		"rule_codes": rule_codes,
		"rule_code": "|".join(rule_codes),
		"exception_codes": exception_codes,
		"exception_code": "|".join(exception_codes),
		"exception_message": "",
		"review_status": "待审核",
		"proposed_value": None,
		"confirmed_value": None,
		"reviewer": "",
		"reviewed_on": "",
		"review_note": "",
		"review_history": [],
		"eligible_for_downstream": False,
		"auto_excluded": bool(rule_codes),
		"duplicate_of_source_row": None,
		"original_value": deepcopy(dict(source)),
		"_parsed_punch_time": parsed_punch_time,
	}


def _resolve_employee(
	raw_code: str,
	raw_name: str,
	raw_department: str,
	event_datetime: datetime | None,
	*,
	by_code: Mapping[str, list[dict[str, Any]]],
	by_name: Mapping[str, list[dict[str, Any]]],
	has_directory: bool,
	department_mapping: Mapping[str, str],
	rules: MissedPunchRules,
) -> dict[str, Any]:
	exception_codes: list[str] = []
	rule_codes: list[str] = []
	mapped_department = department_mapping.get(normalize_department_name(raw_department), normalize_department_name(raw_department))
	matched = None

	if has_directory:
		candidates = by_code.get(raw_code, []) if raw_code else by_name.get(raw_name, [])
		if not raw_code and len(candidates) > 1 and mapped_department:
			department_candidates = [candidate for candidate in candidates if department_match_key(candidate["department"]) == department_match_key(mapped_department)]
			if len(department_candidates) == 1:
				candidates = department_candidates
		if not candidates:
			_append_code(exception_codes, "EMPLOYEE_NOT_FOUND")
		elif len(candidates) > 1:
			_append_code(exception_codes, "EMPLOYEE_AMBIGUOUS")
		else:
			matched = candidates[0]
	else:
		if not raw_code:
			_append_code(exception_codes, "EMPLOYEE_CODE_MISSING")

	if matched:
		employee_code = matched["employee_code"]
		employee_name = matched["employee_name"] or raw_name
		department = matched["department"] or mapped_department
		employment_status = matched["employment_status"]
		if raw_name and employee_name and raw_name != employee_name:
			_append_code(exception_codes, "EMPLOYEE_NAME_CONFLICT")
		if mapped_department and department and department_match_key(mapped_department) != department_match_key(department):
			_append_code(exception_codes, "DEPARTMENT_CONFLICT")
		if _normalized_status(employment_status) in FORMER_EMPLOYEE_STATUSES:
			joining = _parse_datetime(matched.get("date_of_joining"))
			relieving = _parse_datetime(matched.get("relieving_date"))
			outside_employment = bool(
				(event_datetime and joining and event_datetime.date() < joining.date())
				or (event_datetime and relieving and event_datetime.date() > relieving.date())
			)
			former_without_dated_proof = not relieving
			if rules.former_employee_policy == "exception" and (outside_employment or former_without_dated_proof):
				_append_code(exception_codes, "FORMER_EMPLOYEE_REQUIRES_CONFIRMATION")
	else:
		employee_code = raw_code
		employee_name = raw_name
		department = mapped_department
		employment_status = ""
		if not employee_code and "EMPLOYEE_AMBIGUOUS" not in exception_codes:
			_append_code(exception_codes, "EMPLOYEE_CODE_MISSING")

	return {
		"employee_code": employee_code,
		"employee_name": employee_name,
		"department": department,
		"employment_status": employment_status,
		"exception_codes": exception_codes,
		"rule_codes": rule_codes,
	}


def _employee_indexes(employee_directory):
	by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
	by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
	if employee_directory is None:
		return by_code, by_name, False
	for item in employee_directory:
		employee = {
			"employee_code": _directory_value(item, "employee_code", "custom_employee_code", "工号"),
			"employee_name": _directory_value(item, "employee_name", "姓名", "employee_full_name"),
			"department": normalize_department_name(_directory_value(item, "department", "部门")),
			"employment_status": _directory_value(item, "employment_status", "custom_personnel_status", "status", "工作性质"),
			"date_of_joining": _directory_value(item, "date_of_joining", "入职日期"),
			"relieving_date": _directory_value(item, "relieving_date", "离职日期"),
		}
		if employee["employee_code"]:
			by_code[employee["employee_code"]].append(employee)
		if employee["employee_name"]:
			by_name[employee["employee_name"]].append(employee)
	return by_code, by_name, True


def _flag_same_time_multiple_approvals(records, rules):
	if rules.same_time_multiple_policy != "exception":
		return
	groups = defaultdict(list)
	for record in records:
		parsed = record["_parsed_punch_time"]
		identity = record["employee_code"] or record["source_employee_name"]
		if parsed and identity:
			groups[(identity, parsed)].append(record)
	for grouped_records in groups.values():
		approval_keys = {record["approval_no"] or record["source_id"] for record in grouped_records}
		if len(approval_keys) <= 1:
			continue
		for record in grouped_records:
			_append_code(record["exception_codes"], "MULTIPLE_APPROVALS_SAME_PUNCH_TIME")


def _finalize_record(record, rules):
	record.pop("_parsed_punch_time", None)
	record["rule_code"] = "|".join(record["rule_codes"])
	record["exception_code"] = "|".join(record["exception_codes"])
	record["exception_message"] = "；".join(EXCEPTION_MESSAGES[code] for code in record["exception_codes"])
	blocking_proposal_codes = {
		"INVALID_PUNCH_TIME",
		"OUTSIDE_ATTENDANCE_MONTH",
		"APPROVAL_NOT_APPROVED",
		"APPROVAL_NOT_ENDED",
		"DUPLICATE_APPROVAL_NO",
	}
	proposed_included = not any(code in blocking_proposal_codes for code in record["exception_codes"])
	record["proposed_value"] = _editable_value(record, proposed_included, rules)
	if record["exception_codes"]:
		record["include_decision"] = "待人工确认"
		record["processing_status"] = "待处理异常"
		record["review_status"] = "待审核"
	else:
		record["included"] = True
		record["include_decision"] = "自动计入"
		record["processing_status"] = "待确认"
		record["review_status"] = "无需审核"
		record["eligible_for_downstream"] = True
		record["red_apples"] = rules.red_apples_per_record
		record["amount"] = rules.amount_per_record


def _is_auto_excluded_approval(approval_result: str, approval_status: str) -> bool:
	"""Return whether DingTalk has already closed this record as unusable.

	``审批中`` is intentionally absent: it stays visible for human review.
	"""
	return approval_result in AUTO_EXCLUDED_APPROVAL_RESULTS or approval_status in AUTO_EXCLUDED_APPROVAL_STATUSES


def summarize_missed_punch_rows(processed_rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
	"""Dynamically aggregate effective rows without creating another dataset."""

	summary = {}
	for record in processed_rows:
		if not record.get("eligible_for_downstream") or not record.get("included"):
			continue
		key = _text(record.get("employee_code"))
		if not key:
			continue
		if key not in summary:
			summary[key] = {
				"employee_code": key,
				"employee_name": _text(record.get("employee_name")),
				"department": _text(record.get("department")),
				"missed_punch_count": 0,
				"red_apples": 0,
				"amount": 0,
				"source_rows": [],
				"approval_nos": [],
			}
		item = summary[key]
		item["missed_punch_count"] += 1
		item["red_apples"] += record.get("red_apples", 0)
		item["amount"] += record.get("amount", 0)
		item["source_rows"].append(record.get("source_row"))
		if record.get("approval_no"):
			item["approval_nos"].append(record["approval_no"])
	return sorted(summary.values(), key=lambda item: (item["department"], item["employee_code"]))


def apply_missed_punch_review(
	processed_row: Mapping[str, Any],
	*,
	decision: str,
	confirmed_value: Mapping[str, Any] | None,
	reviewer: str,
	reviewed_on: str | datetime,
	review_note: str,
) -> dict[str, Any]:
	"""Return a reviewed copy while appending a complete audit event."""

	if decision not in {"已通过", "已驳回"}:
		raise ValueError("decision must be '已通过' or '已驳回'")
	if not _text(reviewer):
		raise ValueError("reviewer is required")
	if not _text(review_note):
		raise ValueError("review_note is required to preserve the change reason")
	reviewed_at = _reviewed_on_value(reviewed_on)
	updated = deepcopy(dict(processed_row))
	old_value = deepcopy(updated.get("confirmed_value"))
	new_value = deepcopy(dict(confirmed_value)) if confirmed_value is not None else None
	if decision == "已通过" and new_value is None:
		new_value = deepcopy(updated.get("proposed_value"))
	updated.setdefault("review_history", []).append(
		{
			"old_review_status": updated.get("review_status"),
			"new_review_status": decision,
			"old_value": old_value,
			"new_value": deepcopy(new_value),
			"reason": _text(review_note),
			"reviewer": _text(reviewer),
			"reviewed_on": reviewed_at,
		}
	)
	updated["review_status"] = decision
	updated["confirmed_value"] = new_value
	updated["reviewer"] = _text(reviewer)
	updated["reviewed_on"] = reviewed_at
	updated["review_note"] = _text(review_note)
	updated["eligible_for_downstream"] = decision == "已通过" and bool((new_value or {}).get("included"))
	updated["included"] = updated["eligible_for_downstream"]
	if decision == "已通过" and new_value:
		for fieldname in ("employee_code", "employee_name", "department", "punch_time"):
			if fieldname in new_value:
				updated[fieldname] = new_value[fieldname]
		updated["red_apples"] = new_value.get("red_apples", 0) if updated["included"] else 0
		updated["amount"] = new_value.get("amount", 0) if updated["included"] else 0
	else:
		updated["red_apples"] = 0
		updated["amount"] = 0
	return updated


def _editable_value(record, included, rules):
	return {
		"employee_code": record["employee_code"],
		"employee_name": record["employee_name"],
		"department": record["department"],
		"created_at": record["created_at"],
		"punch_time": record["punch_time"],
		"punch_type": record["punch_type"],
		"reason": record["reason"],
		"approval_result": record["approval_result"],
		"approval_status": record["approval_status"],
		"included": included,
		"red_apples": rules.red_apples_per_record if included else 0,
		"amount": rules.amount_per_record if included else 0,
	}


def _reviewed_on_value(value):
	if isinstance(value, datetime):
		return value.replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S")
	parsed = _parse_datetime(value)
	if parsed is None:
		raise ValueError("reviewed_on must be a valid datetime")
	return parsed.strftime("%Y-%m-%d %H:%M:%S")


def _ordered_headers(rows):
	seen = set()
	headers = []
	for row in rows:
		for key in row:
			if key not in seen:
				seen.add(key)
				headers.append(key)
	return headers


def _first_value(row, fieldname):
	for alias in FIELD_ALIASES[fieldname]:
		if alias in row and row[alias] is not None:
			return row[alias]
	return None


def _directory_value(row, *fieldnames):
	for fieldname in fieldnames:
		value = _text(row.get(fieldname))
		if value:
			return value
	return ""


def _parse_datetime(value):
	if isinstance(value, datetime):
		return value.replace(tzinfo=None)
	if isinstance(value, date):
		return datetime.combine(value, time.min)
	if isinstance(value, (int, float)) and not isinstance(value, bool):
		return datetime(1899, 12, 30) + timedelta(days=float(value))
	text = _text(value).replace("/", "-").replace("：", ":")
	text = " ".join(text.split())
	if not text:
		return None
	for pattern in (
		"%Y-%m-%d %H:%M:%S",
		"%Y-%m-%d %H:%M",
		"%Y-%m-%d",
		"%Y%m%d %H:%M:%S",
		"%Y%m%d %H:%M",
		"%Y%m%d",
	):
		try:
			return datetime.strptime(text, pattern)
		except ValueError:
			continue
	return None


def _normalize_attendance_month(value):
	try:
		parsed = datetime.strptime(_text(value), "%Y-%m")
	except ValueError as exc:
		raise ValueError("attendance_month must use YYYY-MM") from exc
	return parsed.strftime("%Y-%m")


def _source_kind(value):
	normalized = _text(value).lower()
	if normalized in {"monthly_summary", "monthly-register", "人资月度汇总表", "月度汇总表"}:
		return "monthly_summary"
	if normalized in {"offline", "manual", "线下", "人工", "人工补录"}:
		return "offline"
	return "dingtalk"


def _normalized_status(value):
	text = _text(value)
	return text.lower() if text.lower() in FORMER_EMPLOYEE_STATUSES else text


def _bool_value(value):
	if isinstance(value, bool):
		return value
	if isinstance(value, (int, float)):
		return value != 0
	return _text(value).lower() in {"1", "true", "yes", "y", "是", "已确认"}


def _integer_value(value, default):
	try:
		return int(value)
	except (TypeError, ValueError):
		return default


def _append_code(codes, code):
	if code not in codes:
		codes.append(code)


def _text(value):
	return "" if value is None else str(value).strip()
