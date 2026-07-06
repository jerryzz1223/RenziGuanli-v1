import json
import re
from collections import defaultdict
from datetime import date, datetime, time
from io import BytesIO

import frappe
from frappe import _
from frappe.utils import flt, getdate, now_datetime


REQUIRED_ATTENDANCE_SHEETS = ["1.1每日统计", "1.2请假单", "1.3苹果树"]
ATTENDANCE_BATCH_DOCTYPE = "HRMS Attendance Import Batch"
DAY_CHECK_DOCTYPE = "HRMS Attendance Day Check"
LEAVE_EVIDENCE_DOCTYPE = "HRMS Attendance Leave Evidence"
EXCEPTION_DOCTYPE = "HRMS Attendance Exception"
APPLE_RECORD_DOCTYPE = "HRMS Apple Reward Record"
MONTHLY_SUMMARY_DOCTYPE = "HRMS Monthly Attendance Summary"
CUSTOM_RULE_DOCTYPE = "HRMS Attendance Custom Rule"
APPLE_UNIT_AMOUNT = 5
STANDARD_DAY_HOURS = 8
LARGE_NIGHT_SHIFT_ALLOWANCE = 45
SMALL_NIGHT_SHIFT_ALLOWANCE = 24


DEFAULT_ATTENDANCE_CUSTOM_RULES = [
	{
		"rule_code": "ATT-LATE-30",
		"rule_name": "迟到0-30分钟",
		"rule_group": "考勤",
		"rule_type": "异常判定",
		"source_module": "人资考勤",
		"source_document": "5.2人资考勤.xlsx / 人资考勤制度作业规范",
		"trigger_condition": "工作日实际上班时间晚于应上班时间，且迟到时长大于0小于等于30分钟。",
		"formula": "late_minutes > 0 && late_minutes <= 30",
		"action_result": "计0.5H缺勤，扣全勤10元；需补钉钉事假或主管说明。",
		"priority": 10,
	},
	{
		"rule_code": "ATT-MISSING-CARD",
		"rule_name": "忘打卡",
		"rule_group": "考勤",
		"rule_type": "异常判定",
		"source_module": "人资考勤",
		"source_document": "5.2人资考勤.xlsx / 1.10忘打卡",
		"trigger_condition": "上班缺卡或下班缺卡，且无不可抗力或HR主管确认。",
		"formula": "missing_in || missing_out",
		"action_result": "生成异常，月底统计每次2个红苹果；员工需提交钉钉补卡。",
		"priority": 20,
	},
	{
		"rule_code": "ATT-ABSENT-NO-LEAVE",
		"rule_name": "无有效请假旷工",
		"rule_group": "考勤",
		"rule_type": "异常判定",
		"source_module": "人资考勤",
		"source_document": "5.2人资考勤.xlsx / 1.6出勤异常",
		"trigger_condition": "工作日无打卡或有旷工小时，且没有审批通过、已结束的请假证据。",
		"formula": "standard_hours > 0 && !actual_in_time && valid_leave_hours <= 0",
		"action_result": "生成旷工异常，薪资侧按3倍旷工工时扣除。",
		"priority": 30,
	},
	{
		"rule_code": "APPLE-ATTENDANCE",
		"rule_name": "苹果树考勤奖惩",
		"rule_group": "苹果树",
		"rule_type": "奖惩汇总",
		"source_module": "苹果树",
		"source_document": "4.2苹果树.xlsx / 钉钉苹果树导出",
		"trigger_condition": "钉钉苹果树记录审批结果为审批通过且审批状态未终止。",
		"formula": "(green_apples - red_apples) * 5",
		"action_result": "并入月度考勤终稿的苹果树金额，作为薪资前置数据。",
		"priority": 40,
	},
	{
		"rule_code": "KPI-LATE-SUBMIT",
		"rule_name": "KPI资料延迟/错误红苹果",
		"rule_group": "KPI",
		"rule_type": "奖惩来源",
		"source_module": "绩效管理",
		"source_document": "4.4 KPI绩效管理.xlsx / KPI绩效管理办法",
		"trigger_condition": "每月15日前未准时、正确提交月会资料，或资料错误被退回。",
		"formula": "late_submit || data_error",
		"action_result": "罚红苹果1颗/项，作为苹果树来源记录进入月度汇总。",
		"priority": 50,
	},
	{
		"rule_code": "SEVENS-RECTIFY",
		"rule_name": "7S整改闭环",
		"rule_group": "7S",
		"rule_type": "稽核来源",
		"source_module": "绩效管理",
		"source_document": "4.3 7S.xlsx / 7S作业规范",
		"trigger_condition": "每月20日稽核后，部门需在次月5日前提交整改后图片并完成会签。",
		"formula": "audit_issue && !rectified_before_next_month_5",
		"action_result": "作为7S缺失项/未改善项记录，可进入苹果树或绩效扣分流程。",
		"priority": 60,
	},
]


def _get_file_content(file_url):
	name = frappe.db.get_value("File", {"file_url": file_url}, "name")
	if not name:
		frappe.throw(_("未找到上传文件"))
	file_doc = frappe.get_doc("File", name)
	content = file_doc.get_content()
	if isinstance(content, str):
		content = content.encode()
	return content


def _load_workbook(file_url):
	from openpyxl import load_workbook

	return load_workbook(BytesIO(_get_file_content(file_url)), data_only=True, read_only=True)


def _sheet_by_required_name(workbook, required_name):
	for sheet_name in workbook.sheetnames:
		if sheet_name.strip() == required_name:
			return workbook[sheet_name]
	return None


def _cell_text(value):
	if value is None:
		return ""
	if isinstance(value, datetime):
		return value.strftime("%Y-%m-%d %H:%M:%S")
	if isinstance(value, date):
		return value.isoformat()
	return str(value).strip()


def _normalise_header(value):
	return re.sub(r"\s+", "", _cell_text(value).replace("\n", ""))


def _read_sheet_rows(sheet, max_rows=None):
	rows = []
	for index, row in enumerate(sheet.iter_rows(values_only=True), start=1):
		values = [_cell_text(value) for value in row]
		if any(values):
			rows.append(values)
		if max_rows and index >= max_rows:
			break
	return rows


def _find_header_index(rows, required_headers):
	required = {_normalise_header(header) for header in required_headers}
	best_index = 0
	best_score = -1
	for index, row in enumerate(rows[:20]):
		headers = {_normalise_header(value) for value in row if value}
		score = len(required & headers)
		if score > best_score:
			best_index = index
			best_score = score
	return best_index


def _rows_as_dicts(sheet, required_headers):
	rows = _read_sheet_rows(sheet)
	if not rows:
		return []
	header_index = _find_header_index(rows, required_headers)
	headers = []
	seen = defaultdict(int)
	for value in rows[header_index]:
		header = _normalise_header(value)
		if not header:
			headers.append("")
			continue
		seen[header] += 1
		headers.append(f"{header}_{seen[header]}" if seen[header] > 1 else header)

	items = []
	for row in rows[header_index + 1 :]:
		item = {}
		for index, header in enumerate(headers):
			if header:
				item[header] = row[index] if index < len(row) else ""
		if any(item.values()):
			items.append(item)
	return items


def _first_value(row, *headers):
	for header in headers:
		value = row.get(_normalise_header(header))
		if value not in (None, ""):
			return value
	return ""


def _float_value(row, *headers):
	return flt(_first_value(row, *headers))


def _int_value(row, *headers):
	return int(flt(_first_value(row, *headers)))


def _duration_hours(value):
	text = _cell_text(value)
	if not text:
		return 0
	match = re.search(r"(-?\d+(?:\.\d+)?)\s*(小时|H|h|天|半天)?", text)
	if not match:
		return flt(text)
	number = flt(match.group(1))
	unit = match.group(2) or "小时"
	if unit == "天":
		return number * STANDARD_DAY_HOURS
	if unit == "半天":
		return number * 4
	return number


def _parse_date(value):
	if not value:
		return None
	if isinstance(value, (date, datetime)):
		return getdate(value)
	text = _cell_text(value)
	match = re.search(r"(\d{2,4})[-/年.](\d{1,2})[-/月.](\d{1,2})", text)
	if match:
		year = int(match.group(1))
		if year < 100:
			year += 2000
		return date(year, int(match.group(2)), int(match.group(3)))
	try:
		return getdate(text)
	except Exception:
		return None


def _parse_datetime(value):
	if not value:
		return None
	if isinstance(value, datetime):
		return value
	if isinstance(value, date):
		return datetime.combine(value, time.min)
	text = _cell_text(value)
	for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M"):
		try:
			return datetime.strptime(text, fmt)
		except ValueError:
			continue
	try:
		parsed_date = _parse_date(text)
		return datetime.combine(parsed_date, time.min) if parsed_date else None
	except Exception:
		return None


def _parse_shift_start_time(shift_name):
	text = _cell_text(shift_name)
	match = re.search(r"(\d{1,2}):(\d{2})\s*[-~至]", text)
	if match:
		return f"{int(match.group(1)):02d}:{match.group(2)}"
	match = re.search(r"(\d{1,2}):(\d{2})", text)
	if match:
		return f"{int(match.group(1)):02d}:{match.group(2)}"
	return ""


def _time_text_to_minutes(value):
	text = _cell_text(value)
	match = re.search(r"(\d{1,2}):(\d{2})", text)
	if not match:
		return None
	return int(match.group(1)) * 60 + int(match.group(2))


def _is_valid_approval(row):
	result = _first_value(row, "审批结果")
	status = _first_value(row, "审批状态")
	if not result and not status:
		return 0
	return 1 if result == "审批通过" and status == "已结束" else 0


def _month_bounds(attendance_month):
	month = (attendance_month or "").strip()
	if not re.match(r"^\d{4}-\d{2}$", month):
		frappe.throw(_("考勤月份格式应为 YYYY-MM"))
	start = getdate(f"{month}-01")
	if start.month == 12:
		end = date(start.year + 1, 1, 1)
	else:
		end = date(start.year, start.month + 1, 1)
	return start, end


def _employee_lookup(employee_code=None, employee_name=None):
	if employee_code:
		for fieldname in ("custom_employee_code", "employee_number", "name"):
			try:
				name = frappe.db.get_value("Employee", {fieldname: employee_code}, "name")
			except Exception:
				name = None
			if name:
				return name
	if employee_name:
		return frappe.db.get_value("Employee", {"employee_name": employee_name}, "name")
	return None


def _department_lookup(department):
	department = (department or "").strip()
	if not department:
		return None
	if frappe.db.exists("Department", department):
		return department
	return frappe.db.get_value("Department", {"department_name": department}, "name")


def _preview_sheet(workbook, sheet_name):
	sheet = _sheet_by_required_name(workbook, sheet_name)
	if not sheet:
		return {"sheet_name": sheet_name, "found": False, "row_count": 0, "headers": []}
	rows = _read_sheet_rows(sheet, max_rows=12)
	header_index = _find_header_index(rows, ["姓名", "工号", "日期"] if sheet_name != "1.3苹果树" else ["受奖/惩人", "奖/惩日期"])
	return {
		"sheet_name": sheet_name,
		"found": True,
		"row_count": max(sheet.max_row - header_index - 1, 0),
		"headers": rows[header_index][:30] if rows else [],
	}


@frappe.whitelist()
def preview_attendance_workbook(file_url: str):
	workbook = _load_workbook(file_url)
	sheets = [_preview_sheet(workbook, sheet_name) for sheet_name in REQUIRED_ATTENDANCE_SHEETS]
	return {
		"required_sheets": REQUIRED_ATTENDANCE_SHEETS,
		"sheets": sheets,
		"missing_sheets": [sheet["sheet_name"] for sheet in sheets if not sheet["found"]],
	}


def _insert_day_check(batch_name, row):
	employee_code = _first_value(row, "工号")
	employee_name = _first_value(row, "姓名")
	attendance_date = _parse_date(_first_value(row, "日期", "workDate"))
	if not employee_name or not attendance_date:
		return None
	shift_name = _first_value(row, "班次")
	actual_in_time = _first_value(row, "上班时间")
	actual_out_time = _first_value(row, "下班时间")
	missing_in = 1 if _first_value(row, "上班缺卡") or _float_value(row, "上班未打卡次数") else 0
	missing_out = 1 if _first_value(row, "下班缺卡") or _float_value(row, "下班未打卡次数") else 0
	absent_hours = _float_value(row, "旷工(小时)", "旷工")
	standard_hours = _float_value(row, "标准工时")
	actual_attendance_hours = _float_value(row, "实际出勤（小时）", "实际出勤(小时)", "实际出勤")
	personal_leave_hours = _float_value(row, "事假(小时)")
	sick_leave_hours = _float_value(row, "病假(小时)")
	annual_leave_hours = _float_value(row, "特休(小时)")
	work_injury_leave_hours = _float_value(row, "工伤(小时)")
	rest_leave_hours = _float_value(row, "排休(小时)")
	bereavement_leave_hours = _float_value(row, "丧假(小时)")
	marriage_leave_hours = _float_value(row, "婚假(小时)") or _float_value(row, "婚假(天)") * STANDARD_DAY_HOURS
	leave_hours = sum(
		[
			personal_leave_hours,
			sick_leave_hours,
			annual_leave_hours,
			work_injury_leave_hours,
			rest_leave_hours,
			bereavement_leave_hours,
			marriage_leave_hours,
		]
	)
	approval_summary = _first_value(row, "关联审批单")
	has_overtime = flt(_first_value(row, "工作日加班（小时）", "工作日加班(小时)")) or flt(_first_value(row, "休息日加班（小时）", "休息日加班(小时)")) or flt(_first_value(row, "节假日加班（小时）", "节假日加班(小时)"))
	overtime_without_approval = 1 if has_overtime and "加班" not in approval_summary else 0
	attendance_result = "异常" if missing_in or missing_out or absent_hours or _int_value(row, "迟到次数") or _int_value(row, "早退次数") else "正常"

	doc = frappe.get_doc(
		{
			"doctype": DAY_CHECK_DOCTYPE,
			"import_batch": batch_name,
			"attendance_date": attendance_date,
			"employee": _employee_lookup(employee_code, employee_name),
			"employee_code": employee_code,
			"employee_name": employee_name,
			"attendance_group": _first_value(row, "考勤组"),
			"department": _department_lookup(_first_value(row, "实际部门", "部门")),
			"position": _first_value(row, "职位"),
			"user_id": _first_value(row, "UserId"),
			"date_type": _first_value(row, "日期类型"),
			"shift_name": shift_name,
			"scheduled_in_time": _first_value(row, "应上班时间") or _parse_shift_start_time(shift_name),
			"scheduled_out_time": _first_value(row, "应下班时间"),
			"actual_in_time": actual_in_time,
			"actual_out_time": actual_out_time,
			"missing_in": missing_in,
			"missing_out": missing_out,
			"attendance_result": attendance_result,
			"attendance_duration_hours": actual_attendance_hours,
			"absent_hours": absent_hours,
			"standard_hours": standard_hours,
			"actual_attendance_hours": actual_attendance_hours,
			"workday_overtime_hours": _float_value(row, "工作日加班（小时）", "工作日加班(小时)"),
			"restday_overtime_hours": _float_value(row, "休息日加班（小时）", "休息日加班(小时)"),
			"holiday_overtime_hours": _float_value(row, "节假日加班（小时）", "节假日加班(小时)"),
			"large_night_shift_count": _float_value(row, "大夜班"),
			"small_night_shift_count": _float_value(row, "小夜班"),
			"leave_summary": _first_value(row, "请假") or approval_summary,
			"leave_hours": leave_hours,
			"personal_leave_hours": personal_leave_hours,
			"sick_leave_hours": sick_leave_hours,
			"annual_leave_hours": annual_leave_hours,
			"work_injury_leave_hours": work_injury_leave_hours,
			"rest_leave_hours": rest_leave_hours,
			"bereavement_leave_hours": bereavement_leave_hours,
			"marriage_leave_hours": marriage_leave_hours,
			"valid_leave_hours": 0,
			"invalid_leave_hours": 0,
			"overtime_without_approval": overtime_without_approval,
			"late_count": _int_value(row, "迟到次数"),
			"early_count": _int_value(row, "早退次数"),
			"raw_row_json": json.dumps(row, ensure_ascii=False, default=str),
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _insert_leave_evidence(batch_name, row):
	employee_name = _first_value(row, "创建人", "姓名")
	leave_start = _parse_datetime(_first_value(row, "开始时间"))
	leave_end = _parse_datetime(_first_value(row, "结束时间"))
	if not employee_name or not leave_start:
		return None
	employee_code = _first_value(row, "工号")
	valid = _is_valid_approval(row)
	doc = frappe.get_doc(
		{
			"doctype": LEAVE_EVIDENCE_DOCTYPE,
			"import_batch": batch_name,
			"employee": _employee_lookup(employee_code, employee_name),
			"employee_code": employee_code,
			"employee_name": employee_name,
			"department": _department_lookup(_first_value(row, "创建人部门", "部门")),
			"leave_type": _first_value(row, "请假类型（实际）", "请假类型"),
			"leave_start": leave_start,
			"leave_end": leave_end,
			"leave_hours": _duration_hours(_first_value(row, "时长")),
			"leave_reason": _first_value(row, "请假事由"),
			"approval_no": _first_value(row, "审批编号"),
			"approval_result": _first_value(row, "审批结果"),
			"approval_status": _first_value(row, "审批状态"),
			"is_valid_approval": valid,
			"raw_row_json": json.dumps(row, ensure_ascii=False, default=str),
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _person_keys(row):
	keys = []
	for fieldname in ("employee", "employee_code", "employee_name"):
		value = _cell_text(getattr(row, fieldname, ""))
		if value and value not in keys:
			keys.append(value)
	return keys


def _primary_person_key(row):
	keys = _person_keys(row)
	return keys[0] if keys else ""


def _index_records_by_person(records):
	index = defaultdict(list)
	for record in records:
		for key in _person_keys(record):
			index[key].append(record)
	return index


def _records_for_same_person(index, row):
	records = []
	seen = set()
	for key in _person_keys(row):
		for record in index.get(key, []):
			name = getattr(record, "name", None) or id(record)
			if name in seen:
				continue
			seen.add(name)
			records.append(record)
	return records


def _apply_leave_evidence_to_day_checks(batch_name):
	leaves = frappe.get_all(
		LEAVE_EVIDENCE_DOCTYPE,
		filters={"import_batch": batch_name},
		fields=["employee", "employee_code", "employee_name", "leave_type", "leave_start", "leave_end", "leave_hours", "is_valid_approval", "approval_no"],
	)
	evidence_by_person = _index_records_by_person(leaves)

	day_checks = frappe.get_all(DAY_CHECK_DOCTYPE, filters={"import_batch": batch_name}, fields=["*"])
	for day_check in day_checks:
		matched_valid = []
		matched_invalid = []
		attendance_date = getdate(day_check.attendance_date)
		for leave in _records_for_same_person(evidence_by_person, day_check):
			start = getdate(leave.leave_start)
			end = getdate(leave.leave_end) if leave.leave_end else start
			if start <= attendance_date <= end:
				if leave.is_valid_approval:
					matched_valid.append(leave)
				else:
					matched_invalid.append(leave)
		valid_hours = sum(flt(leave.leave_hours) for leave in matched_valid)
		invalid_hours = sum(flt(leave.leave_hours) for leave in matched_invalid)
		updates = {
			"valid_leave_hours": min(flt(day_check.leave_hours) or valid_hours, valid_hours) if valid_hours else 0,
			"invalid_leave_hours": invalid_hours,
			"valid_leave_summary": "；".join(f"{leave.leave_type}{flt(leave.leave_hours):g}H" for leave in matched_valid[:4]),
		}
		if matched_valid and day_check.attendance_result == "异常" and not (day_check.missing_in or day_check.missing_out or day_check.late_count or day_check.early_count or day_check.absent_hours):
			updates["attendance_result"] = "请假"
		frappe.db.set_value(DAY_CHECK_DOCTYPE, day_check.name, updates)


def _insert_apple_record(batch_name, row):
	employee_name = _first_value(row, "受奖/惩人")
	reward_date = _parse_date(_first_value(row, "奖/惩日期"))
	if not employee_name or not reward_date:
		return None
	green = _float_value(row, "绿苹果")
	red = _float_value(row, "红苹果")
	employee_code = _first_value(row, "工号")
	valid = _is_valid_approval(row)
	doc = frappe.get_doc(
		{
			"doctype": APPLE_RECORD_DOCTYPE,
			"import_batch": batch_name,
			"reward_date": reward_date,
			"employee": _employee_lookup(employee_code, employee_name),
			"employee_code": employee_code,
			"employee_name": employee_name,
			"department": _department_lookup(_first_value(row, "受奖/惩人部门", "部门")),
			"reward_item": _first_value(row, "奖/惩项目"),
			"green_apples": green,
			"red_apples": red,
			"reward_amount": (green - red) * APPLE_UNIT_AMOUNT,
			"approval_no": _first_value(row, "审批编号"),
			"approval_result": _first_value(row, "审批结果"),
			"approval_status": _first_value(row, "审批状态"),
			"is_valid_approval": valid,
			"created_by_name": _first_value(row, "创建人"),
			"raw_row_json": json.dumps(row, ensure_ascii=False, default=str),
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


@frappe.whitelist()
def import_attendance_workbook(file_url: str, attendance_month: str = ""):
	workbook = _load_workbook(file_url)
	preview = preview_attendance_workbook(file_url)
	if preview["missing_sheets"]:
		frappe.throw(_("缺少必要工作表：{0}").format("、".join(preview["missing_sheets"])))

	if not attendance_month:
		attendance_month = datetime.today().strftime("%Y-%m")

	batch = frappe.get_doc(
		{
			"doctype": ATTENDANCE_BATCH_DOCTYPE,
			"attendance_month": attendance_month,
			"source_file": file_url,
			"status": "已导入",
			"imported_by": frappe.session.user,
			"imported_on": now_datetime(),
		}
	)
	batch.insert(ignore_permissions=True)

	daily_rows = _rows_as_dicts(_sheet_by_required_name(workbook, "1.1每日统计"), ["姓名", "工号", "日期", "班次"])
	leave_rows = _rows_as_dicts(_sheet_by_required_name(workbook, "1.2请假单"), ["请假类型", "开始时间", "结束时间"])
	apple_rows = _rows_as_dicts(_sheet_by_required_name(workbook, "1.3苹果树"), ["奖/惩日期", "受奖/惩人", "绿苹果", "红苹果"])

	for row in daily_rows:
		_insert_day_check(batch.name, row)
	for row in leave_rows:
		_insert_leave_evidence(batch.name, row)
	for row in apple_rows:
		_insert_apple_record(batch.name, row)
	_apply_leave_evidence_to_day_checks(batch.name)

	batch.daily_sheet_rows = len(daily_rows)
	batch.leave_sheet_rows = len(leave_rows)
	batch.apple_sheet_rows = len(apple_rows)
	batch.save(ignore_permissions=True)
	frappe.db.commit()
	return {
		"batch": batch.name,
		"daily_sheet_rows": len(daily_rows),
		"leave_sheet_rows": len(leave_rows),
		"apple_sheet_rows": len(apple_rows),
	}


def _make_exception(day_check, exception_type, handling_method="", deduct_absence_hours=0, full_attendance_deduction=0, red_apple_penalty=0, remarks=""):
	doc = frappe.get_doc(
		{
			"doctype": EXCEPTION_DOCTYPE,
			"import_batch": day_check.import_batch,
			"day_check": day_check.name,
			"attendance_date": day_check.attendance_date,
			"employee": day_check.employee,
			"employee_code": day_check.employee_code,
			"employee_name": day_check.employee_name,
			"department": day_check.department,
			"exception_type": exception_type,
			"expected_shift": day_check.shift_name,
			"actual_in_time": day_check.actual_in_time,
			"actual_out_time": day_check.actual_out_time,
			"handling_method": handling_method,
			"deduct_absence_hours": deduct_absence_hours,
			"full_attendance_deduction": full_attendance_deduction,
			"red_apple_penalty": red_apple_penalty,
			"confirmation_status": "待确认",
			"remarks": remarks,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _build_exception_candidates(day_check):
	candidates = []
	if day_check.missing_in or day_check.missing_out:
		candidates.append(
			{
				"exception_type": "忘打卡",
				"handling_method": "钉钉补卡；月底统计2个红苹果/次。不可抗因素需HR主管确认后视为已打卡。",
				"red_apple_penalty": 2,
			}
		)

	shift_start = day_check.scheduled_in_time or _parse_shift_start_time(day_check.shift_name)
	shift_start_minutes = _time_text_to_minutes(shift_start)
	actual_in_minutes = _time_text_to_minutes(day_check.actual_in_time)
	late_minutes = 0
	if shift_start_minutes is not None and actual_in_minutes is not None and actual_in_minutes > shift_start_minutes:
		late_minutes = actual_in_minutes - shift_start_minutes
	if flt(day_check.late_count) or late_minutes:
		deduct_hours = 0.5 if 0 < late_minutes <= 30 else round(late_minutes / 60, 2) if late_minutes else 0
		candidates.append(
			{
				"exception_type": "迟到",
				"handling_method": "需提交钉钉事假单；0-0.5H按0.5H缺勤并扣全勤10元，超过0.5H按实际迟到时长计缺勤。",
				"deduct_absence_hours": deduct_hours,
				"full_attendance_deduction": 10 if 0 < late_minutes <= 30 else 0,
			}
		)
	if flt(day_check.early_count):
		candidates.append(
			{
				"exception_type": "早退",
				"handling_method": "未请假或未提前告知主管离岗，早退缺勤时数按旷工处理。",
				"remarks": "请核对请假或主管说明。",
			}
		)
	if flt(day_check.absent_hours) or (day_check.standard_hours and not day_check.actual_in_time and not day_check.valid_leave_hours):
		candidates.append(
			{
				"exception_type": "旷工",
				"handling_method": "工作日未打卡且无有效请假；薪资按3倍旷工工时扣除。",
				"deduct_absence_hours": flt(day_check.absent_hours) or flt(day_check.standard_hours),
			}
		)
	if flt(day_check.overtime_without_approval):
		candidates.append(
			{
				"exception_type": "未申请加班",
				"handling_method": "请核对钉钉加班审批；无审批时在每日表标黄提醒。",
				"remarks": "工作日/周末出勤存在加班时数但未匹配加班审批。",
			}
		)
	return candidates


@frappe.whitelist()
def generate_attendance_exceptions(batch: str):
	existing = frappe.get_all(EXCEPTION_DOCTYPE, filters={"import_batch": batch}, pluck="name")
	for name in existing:
		frappe.delete_doc(EXCEPTION_DOCTYPE, name, ignore_permissions=True, force=True)

	created = []
	day_checks = frappe.get_all(
		DAY_CHECK_DOCTYPE,
		filters={"import_batch": batch},
		fields=["*"],
		order_by="attendance_date asc, employee_name asc",
	)
	for row in day_checks:
		day_check = frappe._dict(row)
		for candidate in _build_exception_candidates(day_check):
			created.append(_make_exception(day_check, **candidate))

	frappe.db.set_value(ATTENDANCE_BATCH_DOCTYPE, batch, "status", "已生成异常")
	frappe.db.commit()
	return {"created": len(created), "exceptions": created}


def _get_month_records(doctype, date_field, attendance_month):
	start, end = _month_bounds(attendance_month)
	return frappe.get_all(
		doctype,
		filters=[[date_field, ">=", start], [date_field, "<", end]],
		fields=["*"],
		order_by=f"{date_field} asc",
	)


def _calculate_monthly_values(values):
	sick_half_hours = values["sick_leave_hours"] * 0.5
	paid_leave_makeup_hours = (
		sick_half_hours
		+ values["annual_leave_hours"]
		+ values["work_injury_leave_hours"]
		+ values["bereavement_leave_hours"]
		+ values["marriage_leave_hours"]
	)
	actual_clock_attendance_hours = max(
		values["actual_attendance_hours"]
		- sick_half_hours
		- values["annual_leave_hours"]
		- values["work_injury_leave_hours"]
		- values["bereavement_leave_hours"]
		- values["marriage_leave_hours"],
		0,
	)
	leave_deductible_hours = values["personal_leave_hours"] + sick_half_hours
	workday_rest_leave_hours = values["rest_leave_hours"]
	adjusted_1_5_absence_hours = max(workday_rest_leave_hours - values["overtime_1_5_hours"], 0)
	adjusted_2_absence_hours = max(leave_deductible_hours - values["overtime_2_hours"], 0)
	overtime_1_5_settlement_hours = max(values["overtime_1_5_hours"] - workday_rest_leave_hours, 0)
	overtime_2_settlement_hours = max(values["overtime_2_hours"] - leave_deductible_hours, 0)
	adjusted_working_hours = (
		actual_clock_attendance_hours
		+ paid_leave_makeup_hours
		+ workday_rest_leave_hours
		+ leave_deductible_hours
		- adjusted_1_5_absence_hours
		- adjusted_2_absence_hours
	)
	adjusted_absence_hours = max(values["standard_hours"] - adjusted_working_hours, 0)
	full_attendance_basis = max(values["standard_hours"] - values["actual_attendance_hours"] - values["rest_leave_hours"] + sick_half_hours, 0)
	if full_attendance_basis > 48:
		full_attendance_deduction = 200
	elif full_attendance_basis > 32:
		full_attendance_deduction = 150
	elif full_attendance_basis > 16:
		full_attendance_deduction = 100
	elif full_attendance_basis > 0.5:
		full_attendance_deduction = 50
	elif full_attendance_basis > 0:
		full_attendance_deduction = 10
	else:
		full_attendance_deduction = 0
	return {
		"actual_clock_attendance_hours": actual_clock_attendance_hours,
		"paid_leave_makeup_hours": paid_leave_makeup_hours,
		"leave_deductible_hours": leave_deductible_hours,
		"workday_rest_leave_hours": workday_rest_leave_hours,
		"adjusted_1_5_absence_hours": adjusted_1_5_absence_hours,
		"adjusted_2_absence_hours": adjusted_2_absence_hours,
		"adjusted_absence_hours": adjusted_absence_hours,
		"adjusted_working_hours": adjusted_working_hours,
		"overtime_1_5_settlement_hours": overtime_1_5_settlement_hours,
		"overtime_2_settlement_hours": overtime_2_settlement_hours,
		"overtime_3_settlement_hours": values["overtime_3_hours"],
		"night_shift_allowance": values["large_night_shift_count"] * LARGE_NIGHT_SHIFT_ALLOWANCE + values["small_night_shift_count"] * SMALL_NIGHT_SHIFT_ALLOWANCE,
		"full_attendance_deduction": full_attendance_deduction,
		"absence_deduction_hours": values["absent_hours"] * 3,
		"red_apple_penalty": values["red_apples"] * APPLE_UNIT_AMOUNT,
	}


@frappe.whitelist()
def generate_monthly_attendance_summary(attendance_month: str):
	_month_bounds(attendance_month)
	for name in frappe.get_all(MONTHLY_SUMMARY_DOCTYPE, filters={"attendance_month": attendance_month}, pluck="name"):
		frappe.delete_doc(MONTHLY_SUMMARY_DOCTYPE, name, ignore_permissions=True, force=True)

	summaries = defaultdict(lambda: defaultdict(float))
	identity = {}
	person_aliases = {}
	for row in _get_month_records(DAY_CHECK_DOCTYPE, "attendance_date", attendance_month):
		key = _primary_person_key(row)
		if not key:
			continue
		identity[key] = row
		for alias in _person_keys(row):
			person_aliases[alias] = key
		summaries[key]["standard_hours"] += flt(row.standard_hours)
		summaries[key]["actual_attendance_hours"] += flt(row.actual_attendance_hours)
		summaries[key]["overtime_1_5_hours"] += flt(row.workday_overtime_hours)
		summaries[key]["overtime_2_hours"] += flt(row.restday_overtime_hours)
		summaries[key]["overtime_3_hours"] += flt(row.holiday_overtime_hours)
		summaries[key]["leave_hours"] += flt(row.leave_hours)
		summaries[key]["absent_hours"] += flt(row.absent_hours)
		summaries[key]["personal_leave_hours"] += flt(row.personal_leave_hours)
		summaries[key]["sick_leave_hours"] += flt(row.sick_leave_hours)
		summaries[key]["annual_leave_hours"] += flt(row.annual_leave_hours)
		summaries[key]["work_injury_leave_hours"] += flt(row.work_injury_leave_hours)
		summaries[key]["rest_leave_hours"] += flt(row.rest_leave_hours)
		summaries[key]["bereavement_leave_hours"] += flt(row.bereavement_leave_hours)
		summaries[key]["marriage_leave_hours"] += flt(row.marriage_leave_hours)
		summaries[key]["large_night_shift_count"] += flt(row.large_night_shift_count)
		summaries[key]["small_night_shift_count"] += flt(row.small_night_shift_count)

	for row in _get_month_records(APPLE_RECORD_DOCTYPE, "reward_date", attendance_month):
		if not row.is_valid_approval:
			continue
		key = next((person_aliases[alias] for alias in _person_keys(row) if alias in person_aliases), _primary_person_key(row))
		if not key:
			continue
		identity.setdefault(key, row)
		for alias in _person_keys(row):
			person_aliases.setdefault(alias, key)
		summaries[key]["green_apples"] += flt(row.green_apples)
		summaries[key]["red_apples"] += flt(row.red_apples)
		summaries[key]["apple_reward_amount"] += flt(row.reward_amount)

	created = []
	for key, values in summaries.items():
		source = identity[key]
		employee = getattr(source, "employee", None)
		date_of_joining = frappe.db.get_value("Employee", employee, "date_of_joining") if employee else None
		calculated = _calculate_monthly_values(values)
		doc = frappe.get_doc(
			{
				"doctype": MONTHLY_SUMMARY_DOCTYPE,
				"attendance_month": attendance_month,
				"employee": employee,
				"employee_code": getattr(source, "employee_code", ""),
				"employee_name": getattr(source, "employee_name", ""),
				"department": getattr(source, "department", ""),
				"date_of_joining": date_of_joining,
				"standard_hours": values["standard_hours"],
				"actual_attendance_hours": values["actual_attendance_hours"],
				"overtime_1_5_hours": values["overtime_1_5_hours"],
				"overtime_2_hours": values["overtime_2_hours"],
				"overtime_3_hours": values["overtime_3_hours"],
				"leave_hours": values["leave_hours"],
				"absent_hours": values["absent_hours"],
				"personal_leave_hours": values["personal_leave_hours"],
				"sick_leave_hours": values["sick_leave_hours"],
				"annual_leave_hours": values["annual_leave_hours"],
				"work_injury_leave_hours": values["work_injury_leave_hours"],
				"rest_leave_hours": values["rest_leave_hours"],
				"large_night_shift_count": values["large_night_shift_count"],
				"small_night_shift_count": values["small_night_shift_count"],
				"actual_clock_attendance_hours": calculated["actual_clock_attendance_hours"],
				"paid_leave_makeup_hours": calculated["paid_leave_makeup_hours"],
				"leave_deductible_hours": calculated["leave_deductible_hours"],
				"workday_rest_leave_hours": calculated["workday_rest_leave_hours"],
				"adjusted_1_5_absence_hours": calculated["adjusted_1_5_absence_hours"],
				"adjusted_2_absence_hours": calculated["adjusted_2_absence_hours"],
				"adjusted_absence_hours": calculated["adjusted_absence_hours"],
				"adjusted_working_hours": calculated["adjusted_working_hours"],
				"overtime_1_5_settlement_hours": calculated["overtime_1_5_settlement_hours"],
				"overtime_2_settlement_hours": calculated["overtime_2_settlement_hours"],
				"overtime_3_settlement_hours": calculated["overtime_3_settlement_hours"],
				"night_shift_allowance": calculated["night_shift_allowance"],
				"full_attendance_deduction": calculated["full_attendance_deduction"],
				"absence_deduction_hours": calculated["absence_deduction_hours"],
				"green_apples": values["green_apples"],
				"red_apples": values["red_apples"],
				"apple_reward_amount": values["apple_reward_amount"],
				"red_apple_penalty": calculated["red_apple_penalty"],
				"status": "草稿",
			}
		)
		doc.insert(ignore_permissions=True)
		created.append(doc.name)

	frappe.db.commit()
	return {"created": len(created), "summaries": created}


def _list_records(doctype, filters=None, fields=None, page_length=50):
	return frappe.get_all(
		doctype,
		filters=filters or {},
		fields=fields or ["*"],
		order_by="modified desc",
		limit_page_length=int(page_length or 50),
	)


@frappe.whitelist()
def list_attendance_day_checks(batch: str = "", page_length: int = 50):
	filters = {"import_batch": batch} if batch else {}
	return _list_records(DAY_CHECK_DOCTYPE, filters=filters, page_length=page_length)


@frappe.whitelist()
def list_attendance_leave_evidence(batch: str = "", page_length: int = 50):
	filters = {"import_batch": batch} if batch else {}
	return _list_records(LEAVE_EVIDENCE_DOCTYPE, filters=filters, page_length=page_length)


@frappe.whitelist()
def list_attendance_exceptions(batch: str = "", page_length: int = 50):
	filters = {"import_batch": batch} if batch else {}
	return _list_records(EXCEPTION_DOCTYPE, filters=filters, page_length=page_length)


@frappe.whitelist()
def list_monthly_attendance_summary(attendance_month: str = "", page_length: int = 50):
	filters = {"attendance_month": attendance_month} if attendance_month else {}
	return _list_records(MONTHLY_SUMMARY_DOCTYPE, filters=filters, page_length=page_length)


@frappe.whitelist()
def seed_attendance_custom_rules():
	created = []
	for rule in DEFAULT_ATTENDANCE_CUSTOM_RULES:
		existing = frappe.db.get_value(CUSTOM_RULE_DOCTYPE, {"rule_code": rule["rule_code"]}, "name")
		if existing:
			continue
		doc = frappe.get_doc(
			{
				"doctype": CUSTOM_RULE_DOCTYPE,
				"enabled": 1,
				**rule,
			}
		)
		doc.insert(ignore_permissions=True)
		created.append(doc.name)
	frappe.db.commit()
	return {"created": len(created), "rules": created}


@frappe.whitelist()
def list_attendance_custom_rules(rule_group: str = "", enabled_only: int = 0, page_length: int = 100):
	filters = {}
	if rule_group:
		filters["rule_group"] = rule_group
	if int(enabled_only or 0):
		filters["enabled"] = 1
	return _list_records(
		CUSTOM_RULE_DOCTYPE,
		filters=filters,
		fields=[
			"name",
			"rule_code",
			"rule_name",
			"rule_group",
			"rule_type",
			"source_module",
			"source_document",
			"trigger_condition",
			"formula",
			"action_result",
			"priority",
			"enabled",
		],
		page_length=page_length,
	)


@frappe.whitelist()
def upsert_attendance_custom_rule(rule):
	if isinstance(rule, str):
		rule = json.loads(rule)
	rule = frappe._dict(rule or {})
	if not rule.rule_code or not rule.rule_name:
		frappe.throw(_("规则编码和规则名称不能为空"))

	values = {
		"rule_code": rule.rule_code,
		"rule_name": rule.rule_name,
		"rule_group": rule.rule_group or "考勤",
		"rule_type": rule.rule_type or "自定义",
		"source_module": rule.source_module,
		"source_document": rule.source_document,
		"trigger_condition": rule.trigger_condition,
		"formula": rule.formula,
		"action_result": rule.action_result,
		"priority": int(flt(rule.priority)),
		"enabled": 1 if str(rule.enabled) in ("1", "true", "True", "on", "是") else 0,
		"remarks": rule.remarks,
	}
	existing = frappe.db.get_value(CUSTOM_RULE_DOCTYPE, {"rule_code": rule.rule_code}, "name")
	if existing:
		doc = frappe.get_doc(CUSTOM_RULE_DOCTYPE, existing)
		doc.update(values)
	else:
		doc = frappe.get_doc({"doctype": CUSTOM_RULE_DOCTYPE, **values})
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"name": doc.name}
