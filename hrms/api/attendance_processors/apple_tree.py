"""Pure processor for manually uploaded DingTalk apple-tree rows.

The processor returns one processed dataset. Every source row remains
traceable; uncertain rows enter the shared review contract instead of being
dropped or silently corrected.
"""

from __future__ import annotations

import copy
import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any



REVIEW_NOT_REQUIRED = "无需审核"
REVIEW_PENDING = "待审核"
REVIEW_APPROVED = "已通过"
REVIEW_REJECTED = "已驳回"
REVIEW_STATUSES = (REVIEW_NOT_REQUIRED, REVIEW_PENDING, REVIEW_APPROVED, REVIEW_REJECTED)

ANOMALY_MESSAGES = {
	"AMOUNT_MISSING": "项目对应的苹果数量为空。",
	"AMOUNT_INVALID": "项目对应的苹果数量不是有效的非负数字。",
	"AMOUNT_TEXT_CONFLICT": "苹果数字段与项目文字中的颗数不一致。",
	"APPLE_TYPE_UNRECOGNIZED": "无法从奖惩项目识别绿苹果或红苹果。",
	"APPROVAL_NOT_FINISHED": "审批状态不是已结束。",
	"APPROVAL_NOT_PASSED": "审批结果不是审批通过。",
	"DUPLICATE_APPROVAL_NO": "审批编号重复。",
	"DUPLICATE_SOURCE_ID": "数据ID重复。",
	"EMPLOYEE_MATCH_PENDING": "尚未提供员工主数据，无法完成工号主键匹配。",
	"EMPLOYEE_NAME_AMBIGUOUS": "姓名匹配到多个员工工号。",
	"EMPLOYEE_DEPARTMENT_MISMATCH": "员工主数据部门与来源部门不一致。",
	"EMPLOYEE_NAME_MISMATCH": "工号对应姓名与来源姓名不一致。",
	"EMPLOYEE_NOT_FOUND": "未匹配到员工工号。",
	"FORMER_EMPLOYEE_REQUIRES_CONFIRMATION": "员工不是在职状态，需要人工确认。",
	"INACTIVE_APPLE_VALUE_CONFLICT": "非当前苹果类型列包含非占位值。",
	"MISSING_APPROVAL_NO": "审批编号为空。",
	"MISSING_APPROVAL_RESULT": "审批结果为空。",
	"MISSING_APPROVAL_STATUS": "审批状态为空。",
	"MISSING_AWARD_DATE": "奖惩日期为空。",
	"MISSING_CREATED_AT": "创建时间为空。",
	"MISSING_CREATOR": "创建人为空。",
	"MISSING_DEPARTMENT": "受奖惩人部门为空。",
	"MISSING_EMPLOYEE_NAME": "受奖惩人姓名为空。",
	"MISSING_SOURCE_ID": "数据ID为空。",
	"MONTH_DATE_INVALID": "用于月度归属的日期为空或格式不正确。",
	"MONTH_MISMATCH": "记录不属于目标月份。",
	"MONTH_RULE_PENDING_CONFIRMATION": "月度归属字段尚未确认。",
	"MULTIPLE_APPROVALS_SAME_TIME": "同一员工同一创建时间存在多笔审批。",
	"OFFLINE_ENTRY_REQUIRES_CONFIRMATION": "疑似线下补录，需要人工确认。",
	"PROJECT_AMOUNT_AMBIGUOUS": "项目文字包含多个不同颗数，不能自动校验数量。",
	"PROJECT_MISSING": "奖惩项目为空。",
	"REVIEW_AUDIT_INCOMPLETE": "人工审核缺少审核人、审核时间或审核说明。",
	"REVIEW_VALUE_INVALID": "人工审核值格式不正确或包含不支持的字段。",
	"SOURCE_FILE_MISSING": "来源文件定位为空。",
	"SOURCE_SHEET_MISSING": "来源工作表定位为空。",
	"TARGET_MONTH_REQUIRED": "尚未指定目标月份。",
}

_SOURCE_ALIASES = {
	"source_id": ("数据ID", "数据id", "data_id", "source_id"),
	"approval_no": ("审批编号", "approval_no"),
	"award_date": ("奖惩日期", "奖/惩日期", "award_date"),
	"created_at": ("创建时间", "created_at", "creation"),
	"department": ("部门", "受奖/惩人部门", "department"),
	"employee_name": ("姓名", "受奖/惩人", "employee_name"),
	"employee_code": ("工号", "员工工号", "employee_code"),
	"green": ("绿苹果", "green_apples", "green"),
	"red": ("红苹果", "red_apples", "red"),
	"project": ("项目", "奖惩项目", "奖/惩项目", "project"),
	"remark": ("备注", "remark", "remarks"),
	"creator": ("创建人", "creator"),
	"approval_result": ("审批结果", "approval_result"),
	"approval_status": ("审批状态", "approval_status"),
}

_REQUIRED_SOURCE_FIELDS = {
	"source_id": "数据ID",
	"approval_no": "审批编号",
	"award_date": "奖惩日期",
	"created_at": "创建时间",
	"department": "部门",
	"employee_name": "姓名",
	"green": "绿苹果",
	"red": "红苹果",
	"project": "项目",
	"creator": "创建人",
	"approval_result": "审批结果",
	"approval_status": "审批状态",
}

_EMPLOYEE_ALIASES = {
	"code": ("工号", "员工工号", "employee_code", "name"),
	"name": ("姓名", "员工姓名", "employee_name"),
	"department": ("部门", "department"),
	"status": ("在职状态", "员工状态", "employment_status", "status"),
}

_REVIEW_VALUE_FIELDS = {"工号", "姓名", "部门", "苹果类型", "有效苹果数"}
_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_PROJECT_AMOUNT_RE = re.compile(r"(?<!\d)(\d+(?:\.\d+)?)\s*颗")
_DINGTALK_DEPARTMENT_IDENTIFIER_RE = re.compile(r"\s*[-－—–]\s*\d+\s*$")


def normalize_department_name(value: Any) -> str:
	"""Remove DingTalk's trailing department identifier (for example `` - 11``)."""
	return _DINGTALK_DEPARTMENT_IDENTIFIER_RE.sub("", _text(value)).strip()


def department_match_key(value: Any) -> str:
	key = re.sub(r"\s+", "", normalize_department_name(value)).casefold()
	return key[:-1] if len(key) > 1 and key[-1:] in {"组", "课", "科"} else key


@dataclass(frozen=True)
class AppleTreeRules:
	"""Explicit rules for one apple-tree processing batch."""

	target_month: str | None = None
	month_basis: str = "award_date"
	month_basis_confirmed: bool = True
	placeholder_values: tuple[str, ...] = ("", "15")
	passed_results: tuple[str, ...] = ("审批通过",)
	finished_statuses: tuple[str, ...] = ("已结束",)
	require_source_id: bool = True
	require_approval_no: bool = True

	def __post_init__(self):
		if self.target_month is not None and not _MONTH_RE.fullmatch(self.target_month):
			raise ValueError("target_month must use YYYY-MM format")
		if self.month_basis not in {"award_date", "created_at"}:
			raise ValueError("month_basis must be 'award_date' or 'created_at'")


@dataclass(frozen=True)
class _Employee:
	code: str
	name: str
	department: str
	status: str


class _EmployeeIndex:
	def __init__(self, employees: Iterable[Mapping[str, Any]]):
		self.by_code: dict[str, _Employee] = {}
		self.by_name: dict[str, list[_Employee]] = defaultdict(list)
		for raw in employees:
			code = _text(_first(raw, _EMPLOYEE_ALIASES["code"]))
			name = _text(_first(raw, _EMPLOYEE_ALIASES["name"]))
			department = normalize_department_name(_first(raw, _EMPLOYEE_ALIASES["department"]))
			status = _text(_first(raw, _EMPLOYEE_ALIASES["status"]))
			if not code:
				continue
			employee = _Employee(code, name, department, status)
			self.by_code[code] = employee
			if name:
				self.by_name[_name_key(name)].append(employee)


def preflight_apple_tree_rows(raw_rows: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
	"""Check the uploaded row structure without creating another dataset."""

	rows = [dict(row) for row in raw_rows]
	headers = {str(key).strip() for row in rows for key in row}
	mapping = {}
	missing = []
	for canonical, label in _REQUIRED_SOURCE_FIELDS.items():
		matched = next((alias for alias in _SOURCE_ALIASES[canonical] if alias in headers), "")
		mapping[canonical] = matched
		if not matched:
			missing.append(label)
	return {
		"状态": "通过" if rows and not missing else "不通过",
		"可加工": bool(rows) and not missing,
		"行数": len(rows),
		"缺失字段": missing,
		"字段映射": mapping,
	}


def normalize_apple_tree_rows(
	raw_rows: Iterable[Mapping[str, Any]],
	*,
	rules: AppleTreeRules | None = None,
	employees: Iterable[Mapping[str, Any]] | Mapping[str, Mapping[str, Any]] | None = None,
	source_file: str = "",
	source_sheet: str = "钉钉导出数据",
	start_row: int = 2,
) -> list[dict[str, Any]]:
	"""Normalize every raw row into the single processed-row contract."""

	rules = rules or AppleTreeRules()
	rows = [dict(row) for row in raw_rows]
	employee_index = _build_employee_index(employees)
	ids = Counter(_text(_first(row, _SOURCE_ALIASES["source_id"])) for row in rows)
	approvals = Counter(_text(_first(row, _SOURCE_ALIASES["approval_no"])) for row in rows)
	events = Counter(_event_key(row) for row in rows)
	processed = []
	for offset, raw in enumerate(rows):
		processed.append(
			_normalize_row(
				raw,
				offset,
				rules,
				employee_index,
				employees is not None,
				ids,
				approvals,
				events,
				source_file,
				source_sheet,
				start_row,
			)
		)
	return processed


def _normalize_row(
	raw: dict[str, Any],
	offset: int,
	rules: AppleTreeRules,
	employee_index: _EmployeeIndex | None,
	employees_were_supplied: bool,
	ids: Counter,
	approvals: Counter,
	events: Counter,
	source_file: str,
	source_sheet: str,
	start_row: int,
) -> dict[str, Any]:
	source_id = _text(_first(raw, _SOURCE_ALIASES["source_id"]))
	approval_no = _text(_first(raw, _SOURCE_ALIASES["approval_no"]))
	award_date = _date_text(_first(raw, _SOURCE_ALIASES["award_date"]))
	created_at = _datetime_text(_first(raw, _SOURCE_ALIASES["created_at"]))
	department = normalize_department_name(_first(raw, _SOURCE_ALIASES["department"]))
	employee_name = _text(_first(raw, _SOURCE_ALIASES["employee_name"]))
	raw_employee_code = _text(_first(raw, _SOURCE_ALIASES["employee_code"]))
	project = _text(_first(raw, _SOURCE_ALIASES["project"]))
	green_value = _first(raw, _SOURCE_ALIASES["green"])
	red_value = _first(raw, _SOURCE_ALIASES["red"])
	creator = _text(_first(raw, _SOURCE_ALIASES["creator"]))
	row_source_file = _text(raw.get("_source_file") or raw.get("source_file") or source_file)
	row_source_sheet = _text(raw.get("_source_sheet") or raw.get("source_sheet") or source_sheet)
	codes: list[str] = []

	if rules.require_source_id and not source_id:
		_add_code(codes, "MISSING_SOURCE_ID")
	if rules.require_approval_no and not approval_no:
		_add_code(codes, "MISSING_APPROVAL_NO")
	if source_id and ids[source_id] > 1:
		_add_code(codes, "DUPLICATE_SOURCE_ID")
	if approval_no and approvals[approval_no] > 1:
		_add_code(codes, "DUPLICATE_APPROVAL_NO")
	event_key = _event_key(raw)
	if event_key and events[event_key] > 1:
		_add_code(codes, "MULTIPLE_APPROVALS_SAME_TIME")
	if not row_source_file:
		_add_code(codes, "SOURCE_FILE_MISSING")
	if not row_source_sheet:
		_add_code(codes, "SOURCE_SHEET_MISSING")
	if _text(raw.get("source_kind")).casefold() in {"offline", "线下", "manual", "人工补录"}:
		_add_code(codes, "OFFLINE_ENTRY_REQUIRES_CONFIRMATION")
	if not department:
		_add_code(codes, "MISSING_DEPARTMENT")
	if not employee_name:
		_add_code(codes, "MISSING_EMPLOYEE_NAME")
	if not award_date:
		_add_code(codes, "MISSING_AWARD_DATE")
	if not created_at:
		_add_code(codes, "MISSING_CREATED_AT")
	if not creator:
		_add_code(codes, "MISSING_CREATOR")
	if not project:
		_add_code(codes, "PROJECT_MISSING")

	apple_type = _apple_type(project)
	if apple_type == "绿苹果":
		active_value, inactive_value = green_value, red_value
	elif apple_type == "红苹果":
		active_value, inactive_value = red_value, green_value
	else:
		active_value, inactive_value = None, None
		_add_code(codes, "APPLE_TYPE_UNRECOGNIZED")
	amount = _number(active_value)
	if apple_type:
		if _text(active_value) == "":
			_add_code(codes, "AMOUNT_MISSING")
		elif amount is None or amount < 0:
			_add_code(codes, "AMOUNT_INVALID")
			amount = None
		if _text(inactive_value) not in {_text(value) for value in rules.placeholder_values}:
			_add_code(codes, "INACTIVE_APPLE_VALUE_CONFLICT")
	project_amounts = _project_amounts(project)
	if amount is not None and len(project_amounts) == 1 and amount not in project_amounts:
		_add_code(codes, "AMOUNT_TEXT_CONFLICT")
	elif len(project_amounts) > 1:
		_add_code(codes, "PROJECT_AMOUNT_AMBIGUOUS")

	approval_result = _text(_first(raw, _SOURCE_ALIASES["approval_result"]))
	approval_status = _text(_first(raw, _SOURCE_ALIASES["approval_status"]))
	if not approval_result:
		_add_code(codes, "MISSING_APPROVAL_RESULT")
	if not approval_status:
		_add_code(codes, "MISSING_APPROVAL_STATUS")
	if approval_result not in rules.passed_results:
		_add_code(codes, "APPROVAL_NOT_PASSED")
	if approval_status not in rules.finished_statuses:
		_add_code(codes, "APPROVAL_NOT_FINISHED")
	_validate_month(rules, award_date, created_at, codes)
	employee_code = _resolve_employee(
		raw_employee_code,
		employee_name,
		department,
		employee_index,
		employees_were_supplied,
		codes,
	)
	value = {
		"工号": employee_code,
		"姓名": employee_name,
		"部门": department,
		"苹果类型": apple_type or "待确认",
		"有效苹果数": _display_number(amount),
	}
	# Keep a complete, columnar processing projection.  ``proposed_value`` is
	# deliberately small because it is the set of fields an administrator may
	# adjust; it must not cause the browser/export layer to collapse the rest of
	# this source's processed record into an opaque JSON string.
	processed_value = {
		"数据ID": source_id,
		"审批编号": approval_no,
		"奖惩日期": award_date,
		"创建时间": created_at,
		"部门": department,
		"姓名": employee_name,
		"工号": employee_code,
		"苹果类型": apple_type or "待确认",
		"有效苹果数": _display_number(amount),
		"项目": project,
		"备注": _text(_first(raw, _SOURCE_ALIASES["remark"])),
		"创建人": creator,
		"审批结果": approval_result,
		"审批状态": approval_status,
	}
	review_status = REVIEW_PENDING if codes else REVIEW_NOT_REQUIRED
	return {
		"数据ID": source_id,
		"审批编号": approval_no,
		"奖惩日期": award_date,
		"创建时间": created_at,
		"部门": department,
		"姓名": employee_name,
		"工号": employee_code,
		"苹果类型": apple_type or "待确认",
		"原始绿苹果": _plain_source_value(green_value),
		"原始红苹果": _plain_source_value(red_value),
		"原始有效苹果数": _display_number(amount),
		"有效苹果数": _display_number(amount),
		"项目": project,
		"备注": _text(_first(raw, _SOURCE_ALIASES["remark"])),
		"创建人": creator,
		"审批结果": approval_result,
		"审批状态": approval_status,
		"exception_codes": codes,
		"exception_message": _exception_message(codes),
		"review_status": review_status,
		"processed_value": copy.deepcopy(processed_value),
		"proposed_value": copy.deepcopy(value),
		"confirmed_value": None,
		"reviewer": "",
		"reviewed_on": "",
		"review_note": "",
		"include_in_downstream": review_status == REVIEW_NOT_REQUIRED,
		"review_history": [],
		"source_type": "apple_tree",
		"source_kind": _text(raw.get("source_kind")) or "dingtalk_export",
		"source_file": row_source_file,
		"source_sheet": row_source_sheet,
		"source_row": raw.get("_source_row") or raw.get("source_row") or start_row + offset,
		"source_id": source_id,
		"approval_no": approval_no,
		"original_value": copy.deepcopy(value),
		"original_data": copy.deepcopy(raw),
	}


def apply_reviews(
	processed_rows: Sequence[Mapping[str, Any]], reviews: Iterable[Mapping[str, Any]]
) -> list[dict[str, Any]]:
	"""Apply shared-queue decisions while preserving originals and audit history."""

	rows = copy.deepcopy([dict(row) for row in processed_rows])
	for review_input in reviews:
		review = dict(review_input)
		matches = _review_matches(rows, review)
		if len(matches) != 1:
			raise ValueError("review must match exactly one processed row")
		row = matches[0]
		status = _text(review.get("review_status"))
		reviewer = _text(review.get("reviewer"))
		reviewed_on = _text(review.get("reviewed_on"))
		note = _text(review.get("review_note"))
		if status not in {REVIEW_PENDING, REVIEW_APPROVED, REVIEW_REJECTED}:
			raise ValueError("review_status must be 待审核, 已通过, or 已驳回")
		if not reviewer or not reviewed_on or not note:
			_add_row_exception(row, "REVIEW_AUDIT_INCOMPLETE")
			continue
		valid, proposed = _merge_review_value(
			row.get("proposed_value") or {}, review.get("proposed_value") or {}
		)
		if not valid:
			_add_row_exception(row, "REVIEW_VALUE_INVALID")
			continue
		confirmed = None
		if review.get("confirmed_value") is not None:
			valid, confirmed = _merge_review_value(proposed, review["confirmed_value"])
			if not valid:
				_add_row_exception(row, "REVIEW_VALUE_INVALID")
				continue
		elif status == REVIEW_APPROVED:
			confirmed = copy.deepcopy(proposed)
		history = {
			"previous_review_status": row.get("review_status"),
			"original_value": copy.deepcopy(row.get("original_value")),
			"previous_proposed_value": copy.deepcopy(row.get("proposed_value")),
			"proposed_value": copy.deepcopy(proposed),
			"confirmed_value": copy.deepcopy(confirmed),
			"review_status": status,
			"reviewer": reviewer,
			"reviewed_on": reviewed_on,
			"review_note": note,
		}
		row.update(
			{
				"proposed_value": proposed,
				"confirmed_value": confirmed,
				"review_status": status,
				"reviewer": reviewer,
				"reviewed_on": reviewed_on,
				"review_note": note,
				"include_in_downstream": status == REVIEW_APPROVED,
			}
		)
		_sync_business_fields(row, confirmed if status == REVIEW_APPROVED else proposed)
		row.setdefault("review_history", []).append(history)
	return rows


def process_apple_tree_rows(
	raw_rows: Iterable[Mapping[str, Any]],
	*,
	rules: AppleTreeRules | None = None,
	employees: Iterable[Mapping[str, Any]] | Mapping[str, Mapping[str, Any]] | None = None,
	reviews: Iterable[Mapping[str, Any]] = (),
	source_file: str = "",
	source_sheet: str = "钉钉导出数据",
	start_row: int = 2,
) -> list[dict[str, Any]]:
	"""Return the one processed dataset used by download and downstream merge."""

	rows = normalize_apple_tree_rows(
		raw_rows,
		rules=rules,
		employees=employees,
		source_file=source_file,
		source_sheet=source_sheet,
		start_row=start_row,
	)
	return apply_reviews(rows, reviews)


def build_employee_summary(processed_rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
	"""Optional in-memory statistic; it is not a second business dataset."""

	groups: dict[str, dict[str, Any]] = {}
	for row in processed_rows:
		if not row.get("include_in_downstream"):
			continue
		value = _effective_value(row)
		code = _text(value.get("工号"))
		if not code:
			continue
		group = groups.setdefault(
			code,
			{
				"工号": code,
				"姓名": _text(value.get("姓名")),
				"部门": set(),
				"绿苹果合计": Decimal("0"),
				"红苹果合计": Decimal("0"),
				"计入记录数": 0,
				"source_ids": [],
				"approval_nos": [],
			},
		)
		if value.get("部门"):
			group["部门"].add(_text(value.get("部门")))
		amount = _number(value.get("有效苹果数")) or Decimal("0")
		if value.get("苹果类型") == "绿苹果":
			group["绿苹果合计"] += amount
		elif value.get("苹果类型") == "红苹果":
			group["红苹果合计"] += amount
		group["计入记录数"] += 1
		if row.get("source_id"):
			group["source_ids"].append(row.get("source_id"))
		if row.get("approval_no"):
			group["approval_nos"].append(row.get("approval_no"))
	for group in groups.values():
		group["部门"] = "、".join(sorted(group["部门"]))
		group["绿苹果合计"] = _display_number(group["绿苹果合计"])
		group["红苹果合计"] = _display_number(group["红苹果合计"])
	return sorted(groups.values(), key=lambda row: (row["工号"], row["姓名"]))


def _build_employee_index(employees):
	if employees is None:
		return None
	if isinstance(employees, Mapping):
		prepared = []
		for key, value in employees.items():
			row = dict(value)
			if not _first(row, _EMPLOYEE_ALIASES["code"]):
				row["employee_code"] = key
			prepared.append(row)
		return _EmployeeIndex(prepared)
	return _EmployeeIndex(employees)


def _resolve_employee(raw_code, employee_name, department, index, employees_were_supplied, codes):
	if index is None:
		_add_code(codes, "EMPLOYEE_MATCH_PENDING")
		return raw_code
	if raw_code:
		employee = index.by_code.get(raw_code)
		if employee is None:
			_add_code(codes, "EMPLOYEE_NOT_FOUND")
		else:
			_validate_employee_context(employee, employee_name, department, codes)
		return raw_code
	if not employee_name:
		return ""
	matches = index.by_name.get(_name_key(employee_name), [])
	if len(matches) > 1 and department:
		department_matches = [item for item in matches if department_match_key(item.department) == department_match_key(department)]
		if len(department_matches) == 1:
			matches = department_matches
	if len(matches) == 1:
		_validate_employee_context(matches[0], employee_name, department, codes)
		return matches[0].code
	_add_code(codes, "EMPLOYEE_NAME_AMBIGUOUS" if matches else "EMPLOYEE_NOT_FOUND")
	if not employees_were_supplied and not matches:
		codes[-1] = "EMPLOYEE_MATCH_PENDING"
	return ""


def _validate_employee_context(employee, employee_name, department, codes):
	if employee_name and _name_key(employee.name) != _name_key(employee_name):
		_add_code(codes, "EMPLOYEE_NAME_MISMATCH")
	if department and employee.department and department_match_key(employee.department) != department_match_key(department):
		_add_code(codes, "EMPLOYEE_DEPARTMENT_MISMATCH")
	if employee.status and employee.status.casefold() not in {"在职", "active"}:
		_add_code(codes, "FORMER_EMPLOYEE_REQUIRES_CONFIRMATION")


def _validate_month(rules, award_date, created_at, codes):
	if not rules.target_month:
		_add_code(codes, "TARGET_MONTH_REQUIRED")
		return
	if not rules.month_basis_confirmed:
		_add_code(codes, "MONTH_RULE_PENDING_CONFIRMATION")
		return
	value = award_date if rules.month_basis == "award_date" else created_at[:10]
	if not value or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
		_add_code(codes, "MONTH_DATE_INVALID")
	elif value[:7] != rules.target_month:
		_add_code(codes, "MONTH_MISMATCH")


def _event_key(row):
	code = _text(_first(row, _SOURCE_ALIASES["employee_code"]))
	name = _text(_first(row, _SOURCE_ALIASES["employee_name"]))
	created_at = _datetime_text(_first(row, _SOURCE_ALIASES["created_at"]))
	identity = code or _name_key(name)
	return (identity, created_at) if identity and created_at else None


def _effective_value(row):
	if row.get("review_status") == REVIEW_APPROVED and row.get("confirmed_value") is not None:
		return dict(row["confirmed_value"])
	return dict(row.get("proposed_value") or {})


def _sync_business_fields(row, value):
	for field in _REVIEW_VALUE_FIELDS:
		if field in value:
			row[field] = value[field]
			if isinstance(row.get("processed_value"), Mapping):
				row["processed_value"][field] = value[field]


def _review_matches(rows, review):
	source_id = _text(review.get("source_id") or review.get("数据ID"))
	approval_no = _text(review.get("approval_no") or review.get("审批编号"))
	source_row = review.get("source_row")
	if not source_id and not approval_no and source_row in (None, ""):
		raise ValueError("review requires source_id, approval_no, or source_row")
	return [
		row
		for row in rows
		if (not source_id or _text(row.get("source_id")) == source_id)
		and (not approval_no or _text(row.get("approval_no")) == approval_no)
		and (source_row in (None, "") or _text(row.get("source_row")) == _text(source_row))
	]


def _merge_review_value(current, patch):
	if not isinstance(patch, Mapping) or any(key not in _REVIEW_VALUE_FIELDS for key in patch):
		return False, dict(current)
	merged = copy.deepcopy(dict(current))
	for key, value in patch.items():
		if key == "有效苹果数":
			number = _number(value)
			if number is None or number < 0:
				return False, dict(current)
			merged[key] = _display_number(number)
		else:
			merged[key] = _text(value)
	return True, merged


def _add_row_exception(row, code):
	_add_code(row.setdefault("exception_codes", []), code)
	row["exception_message"] = _exception_message(row["exception_codes"])
	row["review_status"] = REVIEW_PENDING
	row["include_in_downstream"] = False


def _exception_message(codes):
	return "；".join(ANOMALY_MESSAGES[code] for code in codes)


def _apple_type(project):
	has_green, has_red = "绿苹果" in project, "红苹果" in project
	return "" if has_green == has_red else ("绿苹果" if has_green else "红苹果")


def _project_amounts(project):
	return {Decimal(match) for match in _PROJECT_AMOUNT_RE.findall(project)}


def _number(value):
	if value is None or isinstance(value, bool) or _text(value) == "":
		return None
	try:
		number = Decimal(_text(value).replace(",", ""))
	except (InvalidOperation, ValueError):
		return None
	return number if number.is_finite() else None


def _display_number(value):
	if value is None:
		return None
	return int(value) if value == value.to_integral_value() else float(value)


def _first(row, aliases):
	return next((row[alias] for alias in aliases if alias in row), None)


def _text(value):
	return "" if value is None else str(value).strip()


def _name_key(value):
	return re.sub(r"\s+", "", value).casefold()


def _date_text(value):
	if isinstance(value, datetime):
		return value.date().isoformat()
	if isinstance(value, date):
		return value.isoformat()
	text = _text(value)
	match = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", text)
	if not match:
		return text
	try:
		return date(*(int(part) for part in match.groups())).isoformat()
	except ValueError:
		return text


def _datetime_text(value):
	if isinstance(value, datetime):
		return value.isoformat(sep=" ", timespec="seconds")
	if isinstance(value, date):
		return value.isoformat()
	return _text(value)


def _plain_source_value(value):
	return value.isoformat() if isinstance(value, (date, datetime)) else value


def _add_code(codes, code):
	if code not in codes:
		codes.append(code)


__all__ = [
	"ANOMALY_MESSAGES",
	"AppleTreeRules",
	"REVIEW_APPROVED",
	"REVIEW_NOT_REQUIRED",
	"REVIEW_PENDING",
	"REVIEW_REJECTED",
	"REVIEW_STATUSES",
	"apply_reviews",
	"build_employee_summary",
	"normalize_apple_tree_rows",
	"preflight_apple_tree_rows",
	"process_apple_tree_rows",
]
