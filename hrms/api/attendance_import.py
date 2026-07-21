import hashlib
import json
import re
from collections import defaultdict
from datetime import date, datetime, time
from io import BytesIO

import frappe
from frappe import _
from frappe.utils import flt, getdate, now_datetime


REQUIRED_ATTENDANCE_SHEETS = ["1.1每日统计", "1.2请假单", "1.3苹果树"]
DINGTALK_EXPORT_V1_SHEETS = ["每日统计", "打卡时间", "原始记录", "月度汇总"]
COMPANY_ATTENDANCE_WORKBOOK_SOURCES = {
	"dingtalk_raw": {
		"sheet_name": "每日统计（钉钉导出）",
		"header_rows": (3, 4),
		"data_start_row": 5,
	},
	"manual_adjustment": {
		"sheet_name": "每日统计（修改后）",
		"header_rows": (1, 2),
		"data_start_row": 3,
	},
}
DINGTALK_EXPORT_V1_SCHEMA = {
	"source_type": "dingtalk_export_v1",
	"daily_header_rows": (3, 4),
	"daily_data_start_row": 5,
	"raw_header_row": 3,
	"raw_data_start_row": 4,
	"monthly_header_rows": (3, 4),
	"monthly_data_start_row": 5,
}
DINGTALK_DAILY_FIELD_MAPPING = {
	"姓名": "employee_name",
	"工号": "employee_code",
	"UserId": "dingtalk_user_id",
	"日期": "attendance_date",
	"workDate": "source_work_date",
	"日期类型": "date_type",
	"考勤组": "attendance_group",
	"部门": "source_department",
	"实际部门": "actual_department",
	"班次": "shift_name",
	"上班时间": "actual_in_time",
	"下班时间": "actual_out_time",
	"上班缺卡": "missing_in",
	"下班缺卡": "missing_out",
	"标准工时": "standard_hours",
	"实际出勤(小时)": "actual_attendance_hours",
	"关联的审批单": "approval_reference",
	"关联审批单": "approval_reference",
	"工作日加班(小时)": "workday_overtime_hours",
	"休息日加班(小时)": "restday_overtime_hours",
	"节假日加班(小时)": "holiday_overtime_hours",
	"请假/事假(小时)": "personal_leave_hours",
	"请假/病假(小时)": "sick_leave_hours",
	"请假/婚假(天)": "marriage_leave_days",
	"请假/特休(小时)": "annual_leave_hours",
	"请假/丧假(小时)": "bereavement_leave_hours",
	"请假/工伤(小时)": "work_injury_leave_hours",
	"请假/公假(天)": "public_leave_days",
	"请假/产假(天)": "maternity_leave_days",
	"请假/团圆假(天)": "reunion_leave_days",
	"请假/排休(小时)": "rest_leave_hours",
	"请假/旷工(小时)": "absent_hours",
	"旷工": "absence_summary",
}
ATTENDANCE_BATCH_DOCTYPE = "HRMS Attendance Import Batch"
DAY_CHECK_DOCTYPE = "HRMS Attendance Day Check"
LEAVE_EVIDENCE_DOCTYPE = "HRMS Attendance Leave Evidence"
EXCEPTION_DOCTYPE = "HRMS Attendance Exception"
APPLE_RECORD_DOCTYPE = "HRMS Apple Reward Record"
MONTHLY_SUMMARY_DOCTYPE = "HRMS Monthly Attendance Summary"
MONTH_LOCK_DOCTYPE = "HRMS Attendance Month Lock"
LOCK_AUDIT_DOCTYPE = "HRMS Attendance Lock Audit"
CUSTOM_RULE_DOCTYPE = "HRMS Attendance Custom Rule"
APPLE_UNIT_AMOUNT = 5
STANDARD_DAY_HOURS = 8
TEST_ATTENDANCE_DEMO_COMPANY = "TEST-HRMS"
TEST_ATTENDANCE_DEMO_MONTH = "2099-02"
TEST_ATTENDANCE_DEMO_CHECKSUM = hashlib.sha256(b"TEST-HRMS attendance demo v1").hexdigest()
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


def _normalise_dingtalk_header(value):
	return _normalise_header(value).replace("（", "(").replace("）", ")").replace("／", "/")


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


def _require_company(company):
	company = (company or "").strip()
	if not company:
		frappe.throw(_("请先选择公司。"))
	if not frappe.db.exists("Company", company):
		frappe.throw(_("公司 {0} 不存在").format(company))
	return company


def _attendance_scope_filters(company, attendance_month, attendance_lock_version):
	company = (company or "").strip()
	attendance_month = (attendance_month or "").strip()
	attendance_lock_version = str(attendance_lock_version or "").strip()
	if not company or not attendance_month or not attendance_lock_version:
		frappe.throw(_("考勤范围必须包含公司、月份和锁定版本。"))
	return {
		"company": company,
		"attendance_month": attendance_month,
		"attendance_lock_version": attendance_lock_version,
	}


def _source_file_checksum(file_url):
	return hashlib.sha256(_get_file_content(file_url)).hexdigest()


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


def _employee_matches_company(employee, company):
	return bool(employee and frappe.db.get_value("Employee", employee, "company") == company)


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


def _is_dingtalk_export_v1(workbook):
	return all(_sheet_by_required_name(workbook, sheet_name) for sheet_name in DINGTALK_EXPORT_V1_SHEETS)


def _flatten_dingtalk_headers(sheet, header_rows=(3, 4)):
	start_row, end_row = header_rows
	rows = list(sheet.iter_rows(min_row=start_row, max_row=end_row, values_only=True))
	if len(rows) != 2:
		return []

	parents, children = rows
	headers = []
	active_parent = ""
	seen = defaultdict(int)
	for parent, child in zip(parents, children):
		parent_text = _normalise_dingtalk_header(parent)
		child_text = _normalise_dingtalk_header(child)
		if parent_text:
			active_parent = parent_text
		header = f"{active_parent}/{child_text}" if child_text and active_parent else (child_text or active_parent)
		seen[header] += 1
		headers.append(f"{header}_{seen[header]}" if header and seen[header] > 1 else header)
	return headers


def _flatten_dingtalk_daily_headers(sheet):
	return _flatten_dingtalk_headers(sheet)


def _daily_rows_from_header_rows(sheet, header_rows=(3, 4), data_start_row=5):
	headers = _flatten_dingtalk_headers(sheet, header_rows)
	items = []
	for row_index, values in enumerate(sheet.iter_rows(min_row=data_start_row, values_only=True), start=data_start_row):
		item = {
			header: _cell_text(values[index]) if index < len(values) else ""
			for index, header in enumerate(headers)
			if header
		}
		if any(item.values()):
			item["_source_row"] = row_index
			items.append(item)
	return items


def _dingtalk_daily_rows(sheet):
	return _daily_rows_from_header_rows(sheet)


def _dingtalk_export_import_source_kind():
	return "钉钉原始导出"


def _count_nonempty_rows(sheet, start_row):
	return sum(1 for row in sheet.iter_rows(min_row=start_row, values_only=True) if any(_cell_text(value) for value in row))


def _dingtalk_sheet_preview(sheet_name, sheet, row_count, headers):
	return {
		"sheet_name": sheet_name,
		"found": bool(sheet),
		"row_count": row_count,
		"headers": headers[:40],
	}


def _preview_dingtalk_export_v1(workbook):
	daily_sheet = _sheet_by_required_name(workbook, "每日统计")
	raw_sheet = _sheet_by_required_name(workbook, "原始记录")
	monthly_sheet = _sheet_by_required_name(workbook, "月度汇总")
	clock_sheet = _sheet_by_required_name(workbook, "打卡时间")
	daily_rows = _dingtalk_daily_rows(daily_sheet)
	daily_headers = _flatten_dingtalk_daily_headers(daily_sheet)

	quality_counts = {
		"missing_employee_code": 0,
		"missing_attendance_group": 0,
		"planned_hours_without_actual": 0,
		"duplicate_userid_workdate": 0,
	}

	seen_user_dates = set()
	for row in daily_rows:
		if not row.get("工号"):
			quality_counts["missing_employee_code"] += 1
		if row.get("考勤组") in ("", "未加入考勤组"):
			quality_counts["missing_attendance_group"] += 1
		if row.get("标准工时") and not row.get("实际出勤(小时)"):
			quality_counts["planned_hours_without_actual"] += 1
		user_date = (row.get("UserId", ""), row.get("workDate") or row.get("日期", ""))
		if all(user_date):
			if user_date in seen_user_dates:
				quality_counts["duplicate_userid_workdate"] += 1
			else:
				seen_user_dates.add(user_date)

	raw_headers = _read_sheet_rows(raw_sheet, max_rows=DINGTALK_EXPORT_V1_SCHEMA["raw_header_row"])[-1]
	monthly_headers = _flatten_dingtalk_daily_headers(monthly_sheet)
	clock_headers = _flatten_dingtalk_daily_headers(clock_sheet)
	sheets = [
		_dingtalk_sheet_preview("每日统计", daily_sheet, len(daily_rows), daily_headers),
		_dingtalk_sheet_preview(
			"打卡时间",
			clock_sheet,
			_count_nonempty_rows(clock_sheet, DINGTALK_EXPORT_V1_SCHEMA["daily_data_start_row"]),
			clock_headers,
		),
		_dingtalk_sheet_preview(
			"原始记录",
			raw_sheet,
			_count_nonempty_rows(raw_sheet, DINGTALK_EXPORT_V1_SCHEMA["raw_data_start_row"]),
			raw_headers,
		),
		_dingtalk_sheet_preview(
			"月度汇总",
			monthly_sheet,
			_count_nonempty_rows(monthly_sheet, DINGTALK_EXPORT_V1_SCHEMA["monthly_data_start_row"]),
			monthly_headers,
		),
	]
	return {
		"source_type": DINGTALK_EXPORT_V1_SCHEMA["source_type"],
		"required_sheets": DINGTALK_EXPORT_V1_SHEETS,
		"sheets": sheets,
		"missing_sheets": [sheet["sheet_name"] for sheet in sheets if not sheet["found"]],
		"record_counts": {
			"daily_statistics": len(daily_rows),
			"raw_records": sheets[2]["row_count"],
			"monthly_people": sheets[3]["row_count"],
		},
		"field_mapping": {
			header: DINGTALK_DAILY_FIELD_MAPPING.get(header, "source_only") for header in daily_headers if header
		},
		"quality_warnings": [
			{"code": "missing_employee_code", "label": "缺工号", "count": quality_counts["missing_employee_code"]},
			{"code": "missing_attendance_group", "label": "未加入考勤组", "count": quality_counts["missing_attendance_group"]},
			{
				"code": "planned_hours_without_actual",
				"label": "标准工时有值但实际出勤为空",
				"count": quality_counts["planned_hours_without_actual"],
			},
			{
				"code": "duplicate_userid_workdate",
				"label": "重复 UserId + workDate",
				"count": quality_counts["duplicate_userid_workdate"],
			},
		],
		"parsing": {
			"daily_header_rows": list(DINGTALK_EXPORT_V1_SCHEMA["daily_header_rows"]),
			"daily_data_start_row": DINGTALK_EXPORT_V1_SCHEMA["daily_data_start_row"],
		},
		"database_writes": 0,
	}


def _is_company_attendance_workbook(workbook):
	return all(_sheet_by_required_name(workbook, source["sheet_name"]) for source in COMPANY_ATTENDANCE_WORKBOOK_SOURCES.values())


def _preview_company_daily_source(workbook, source_kind, source):
	sheet = _sheet_by_required_name(workbook, source["sheet_name"])
	headers = _flatten_dingtalk_headers(sheet, source["header_rows"])
	rows = _daily_rows_from_header_rows(sheet, source["header_rows"], source["data_start_row"])
	return {
		"source_kind": source_kind,
		"sheet_name": source["sheet_name"],
		"found": bool(sheet),
		"header_rows": list(source["header_rows"]),
		"data_start_row": source["data_start_row"],
		"row_count": len(rows),
		"headers": headers,
		"field_mapping": {header: DINGTALK_DAILY_FIELD_MAPPING.get(header, "source_only") for header in headers if header},
	}


def _preview_company_attendance_workbook(workbook):
	daily_sources = {
		source_kind: _preview_company_daily_source(workbook, source_kind, source)
		for source_kind, source in COMPANY_ATTENDANCE_WORKBOOK_SOURCES.items()
	}
	reference_sheet_names = ["请假单（钉钉导出）", "出勤异常", "苹果树（钉钉导出）", "苹果树（修改后）", "考勤初稿", "考勤终稿（签字版）", "考勤终稿（财务版）"]
	reference_sheets = [
		{
			"sheet_name": sheet_name,
			"found": bool(_sheet_by_required_name(workbook, sheet_name)),
		}
		for sheet_name in reference_sheet_names
	]
	return {
		"source_type": "company_attendance_workbook_v1",
		"daily_sources": daily_sources,
		"reference_sheets": reference_sheets,
		"database_writes": 0,
	}


@frappe.whitelist()
def preview_attendance_workbook(file_url: str):
	workbook = _load_workbook(file_url)
	if _is_company_attendance_workbook(workbook):
		return _preview_company_attendance_workbook(workbook)
	if _is_dingtalk_export_v1(workbook):
		return _preview_dingtalk_export_v1(workbook)
	sheets = [_preview_sheet(workbook, sheet_name) for sheet_name in REQUIRED_ATTENDANCE_SHEETS]
	return {
		"required_sheets": REQUIRED_ATTENDANCE_SHEETS,
		"sheets": sheets,
		"missing_sheets": [sheet["sheet_name"] for sheet in sheets if not sheet["found"]],
	}


def _insert_day_check(batch_name, row, company, source_kind="旧模板", source_sheet="", correction_version=1, allow_unmatched=False):
	employee_code = _first_value(row, "工号")
	employee_name = _first_value(row, "姓名")
	attendance_date = _parse_date(_first_value(row, "日期", "workDate"))
	if not employee_name or not attendance_date:
		return None
	employee = _employee_lookup(employee_code, employee_name)
	if not _employee_matches_company(employee, company) and not allow_unmatched:
		return None
	if employee and not _employee_matches_company(employee, company):
		employee = None
	shift_name = _first_value(row, "班次")
	actual_in_time = _first_value(row, "上班时间")
	actual_out_time = _first_value(row, "下班时间")
	missing_in = 1 if _first_value(row, "上班缺卡") or _float_value(row, "上班未打卡次数") else 0
	missing_out = 1 if _first_value(row, "下班缺卡") or _float_value(row, "下班未打卡次数") else 0
	absent_hours = _float_value(row, "请假/旷工(小时)", "旷工(小时)", "旷工")
	standard_hours = _float_value(row, "标准工时")
	actual_attendance_hours = _float_value(row, "实际出勤（小时）", "实际出勤(小时)", "实际出勤")
	personal_leave_hours = _float_value(row, "请假/事假(小时)", "事假(小时)")
	sick_leave_hours = _float_value(row, "请假/病假(小时)", "病假(小时)")
	annual_leave_hours = _float_value(row, "请假/特休(小时)", "特休(小时)")
	work_injury_leave_hours = _float_value(row, "请假/工伤(小时)", "工伤(小时)")
	rest_leave_hours = _float_value(row, "请假/排休(小时)", "排休(小时)")
	bereavement_leave_hours = _float_value(row, "请假/丧假(小时)", "丧假(小时)")
	marriage_leave_hours = _float_value(row, "请假/婚假(小时)", "婚假(小时)") or _float_value(row, "请假/婚假(天)", "婚假(天)") * STANDARD_DAY_HOURS
	public_leave_hours = _float_value(row, "请假/公假(小时)", "公假(小时)") or _float_value(row, "请假/公假(天)", "公假(天)") * STANDARD_DAY_HOURS
	maternity_leave_hours = _float_value(row, "请假/产假(小时)", "产假(小时)") or _float_value(row, "请假/产假(天)", "产假(天)") * STANDARD_DAY_HOURS
	reunion_leave_hours = _float_value(row, "请假/团圆假(小时)", "团圆假(小时)") or _float_value(row, "请假/团圆假(天)", "团圆假(天)") * STANDARD_DAY_HOURS
	leave_hours = sum(
		[
			personal_leave_hours,
			sick_leave_hours,
			annual_leave_hours,
			work_injury_leave_hours,
			rest_leave_hours,
			bereavement_leave_hours,
			marriage_leave_hours,
			public_leave_hours,
			maternity_leave_hours,
			reunion_leave_hours,
		]
	)
	approval_summary = _first_value(row, "关联审批单", "关联的审批单")
	has_overtime = flt(_first_value(row, "工作日加班（小时）", "工作日加班(小时)")) or flt(_first_value(row, "休息日加班（小时）", "休息日加班(小时)")) or flt(_first_value(row, "节假日加班（小时）", "节假日加班(小时)"))
	overtime_without_approval = 1 if has_overtime and "加班" not in approval_summary else 0
	attendance_result = "异常" if missing_in or missing_out or absent_hours or _int_value(row, "迟到次数") or _int_value(row, "早退次数") else "正常"

	doc = frappe.get_doc(
		{
			"doctype": DAY_CHECK_DOCTYPE,
			"import_batch": batch_name,
			"company": company,
			"source_kind": source_kind,
			"source_sheet": source_sheet,
			"source_row_number": row.get("_source_row", 0),
			"correction_version": correction_version,
			"attendance_date": attendance_date,
			"employee": employee,
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
			"public_leave_hours": public_leave_hours,
			"maternity_leave_hours": maternity_leave_hours,
			"reunion_leave_hours": reunion_leave_hours,
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


def _create_attendance_batch(file_url, attendance_month, company, source_type):
	source_checksum = _source_file_checksum(file_url)
	existing = frappe.db.get_value(
		ATTENDANCE_BATCH_DOCTYPE,
		{"company": company, "source_checksum": source_checksum},
		"name",
	)
	if existing:
		return frappe.get_doc(ATTENDANCE_BATCH_DOCTYPE, existing), True

	batch = frappe.get_doc(
		{
			"doctype": ATTENDANCE_BATCH_DOCTYPE,
			"company": company,
			"attendance_month": attendance_month,
			"source_file": file_url,
			"source_type": source_type,
			"source_checksum": source_checksum,
			"status": "已导入",
			"imported_by": frappe.session.user,
			"imported_on": now_datetime(),
		}
	)
	batch.insert(ignore_permissions=True)
	return batch, False


def _import_company_attendance_workbook(workbook, file_url, attendance_month, company):
	correction_version = _correction_version_for_import(company, attendance_month)
	batch, duplicate = _create_attendance_batch(file_url, attendance_month, company, "company_attendance_workbook_v1")
	if duplicate:
		return {"batch": batch.name, "duplicate": 1, "daily_sheet_rows": batch.daily_sheet_rows}

	row_counts = {}
	rejected_rows = 0
	for source_kind, source in COMPANY_ATTENDANCE_WORKBOOK_SOURCES.items():
		rows = _daily_rows_from_header_rows(workbook[source["sheet_name"]], source["header_rows"], source["data_start_row"])
		for row in rows:
			if not _insert_day_check(
				batch.name,
				row,
				company,
				"钉钉原始导出" if source_kind == "dingtalk_raw" else "人工调整",
				source["sheet_name"],
				correction_version,
			):
				rejected_rows += 1
		row_counts[source_kind] = len(rows)

	batch.daily_sheet_rows = sum(row_counts.values())
	batch.notes = json.dumps({"daily_sources": row_counts, "rejected_company_or_employee_rows": rejected_rows}, ensure_ascii=False)
	batch.save(ignore_permissions=True)
	frappe.db.commit()
	return {
		"batch": batch.name,
		"daily_sheet_rows": batch.daily_sheet_rows,
		"daily_sources": row_counts,
		"rejected_company_or_employee_rows": rejected_rows,
	}


def _import_dingtalk_export_v1(workbook, file_url, attendance_month, company):
	correction_version = _correction_version_for_import(company, attendance_month)
	batch, duplicate = _create_attendance_batch(file_url, attendance_month, company, "dingtalk_export_v1")
	if duplicate:
		return {"batch": batch.name, "duplicate": 1, "daily_sheet_rows": batch.daily_sheet_rows}

	daily_rows = _dingtalk_daily_rows(_sheet_by_required_name(workbook, "每日统计"))
	inserted_rows = 0
	rejected_rows = 0
	for row in daily_rows:
		if _insert_day_check(
			batch.name,
			row,
			company,
			_dingtalk_export_import_source_kind(),
			"每日统计",
			correction_version,
		):
			inserted_rows += 1
		else:
			rejected_rows += 1

	preview = _preview_dingtalk_export_v1(workbook)
	batch.daily_sheet_rows = len(daily_rows)
	batch.notes = json.dumps(
		{
			"daily_statistics_imported": inserted_rows,
			"rejected_company_or_employee_rows": rejected_rows,
			"source_only_record_counts": preview["record_counts"],
		},
		ensure_ascii=False,
	)
	batch.save(ignore_permissions=True)
	frappe.db.commit()
	return {
		"batch": batch.name,
		"daily_sheet_rows": len(daily_rows),
		"inserted_day_checks": inserted_rows,
		"rejected_company_or_employee_rows": rejected_rows,
		"source_only_record_counts": preview["record_counts"],
	}


@frappe.whitelist()
def import_attendance_workbook(file_url: str, attendance_month: str = "", company: str = ""):
	company = _require_company(company)
	workbook = _load_workbook(file_url)
	preview = preview_attendance_workbook(file_url)
	if not attendance_month:
		attendance_month = datetime.today().strftime("%Y-%m")

	if preview.get("source_type") == "company_attendance_workbook_v1":
		return _import_company_attendance_workbook(workbook, file_url, attendance_month, company)
	if preview.get("source_type") == "dingtalk_export_v1":
		return _import_dingtalk_export_v1(workbook, file_url, attendance_month, company)
	if preview["missing_sheets"]:
		frappe.throw(_("缺少必要工作表：{0}").format("、".join(preview["missing_sheets"])))

	correction_version = _correction_version_for_import(company, attendance_month)
	batch, duplicate = _create_attendance_batch(file_url, attendance_month, company, "legacy_workbook")
	if duplicate:
		return {"batch": batch.name, "duplicate": 1, "daily_sheet_rows": batch.daily_sheet_rows}

	daily_rows = _rows_as_dicts(_sheet_by_required_name(workbook, "1.1每日统计"), ["姓名", "工号", "日期", "班次"])
	leave_rows = _rows_as_dicts(_sheet_by_required_name(workbook, "1.2请假单"), ["请假类型", "开始时间", "结束时间"])
	apple_rows = _rows_as_dicts(_sheet_by_required_name(workbook, "1.3苹果树"), ["奖/惩日期", "受奖/惩人", "绿苹果", "红苹果"])

	rejected_rows = 0
	for row in daily_rows:
		if not _insert_day_check(batch.name, row, company, "旧模板", "1.1每日统计", correction_version):
			rejected_rows += 1
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
		"rejected_company_or_employee_rows": rejected_rows,
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
	if not day_check.employee:
		candidates.append(
			{
				"exception_type": "员工未匹配",
				"handling_method": "请在人事侧确认钉钉 UserId、工号与员工档案的映射；确认前不得进入月度锁定或薪资。",
				"remarks": "钉钉原始数据已保留，等待人事匹配员工。",
			}
		)
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


def _get_month_records(doctype, date_field, attendance_month, company):
	start, end = _month_bounds(attendance_month)
	return frappe.get_all(
		doctype,
		filters=[["company", "=", company], [date_field, ">=", start], [date_field, "<", end]],
		fields=["*"],
		order_by=f"{date_field} asc",
	)


def _get_or_create_month_lock(company, attendance_month):
	name = frappe.db.get_value(MONTH_LOCK_DOCTYPE, {"company": company, "attendance_month": attendance_month}, "name")
	if name:
		return frappe.get_doc(MONTH_LOCK_DOCTYPE, name)
	lock = frappe.get_doc(
		{
			"doctype": MONTH_LOCK_DOCTYPE,
			"company": company,
			"attendance_month": attendance_month,
			"status": "草稿",
			"active_version": 1,
		}
	)
	lock.insert(ignore_permissions=True)
	return lock


def _append_lock_audit(lock, action, reason=""):
	doc = frappe.get_doc(
		{
			"doctype": LOCK_AUDIT_DOCTYPE,
			"month_lock": lock.name,
			"company": lock.company,
			"attendance_month": lock.attendance_month,
			"action": action,
			"lock_version": lock.active_version,
			"reason": reason,
			"operator": frappe.session.user,
			"occurred_on": now_datetime(),
			"source_checksum": lock.source_checksum,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def _prepare_month_lock_for_generation(company, attendance_month):
	lock = _get_or_create_month_lock(company, attendance_month)
	if lock.status == "已锁定":
		frappe.throw(_("该公司考勤月份已锁定，不能重新生成。"))
	if lock.status == "已重开":
		lock.active_version = int(lock.active_version or 1) + 1
		lock.status = "草稿"
		lock.save(ignore_permissions=True)
		_append_lock_audit(lock, "创建更正版本", _("解锁后的更正版本"))
	return lock


def _correction_version_for_import(company, attendance_month):
	lock = _get_or_create_month_lock(company, attendance_month)
	if lock.status == "已锁定":
		frappe.throw(_("该公司考勤月份已锁定，不能导入更正数据。"))
	return int(lock.active_version or 1) + (1 if lock.status == "已重开" else 0)


def _assert_month_ready_for_lock(company, attendance_month):
	day_checks = _get_month_records(DAY_CHECK_DOCTYPE, "attendance_date", attendance_month, company)
	unmatched = [row for row in day_checks if not getattr(row, "employee", "")]
	batch_ids = sorted({_cell_text(getattr(row, "import_batch", "")) for row in day_checks if getattr(row, "import_batch", "")})
	start, end = _month_bounds(attendance_month)
	pending = frappe.get_all(
		EXCEPTION_DOCTYPE,
		filters=[
			["import_batch", "in", batch_ids or ["__none__"]],
			["attendance_date", ">=", start],
			["attendance_date", "<", end],
			["confirmation_status", "=", "待确认"],
		],
		fields=["name"],
	)
	if unmatched:
		frappe.throw(_("存在 {0} 条未匹配员工的日考勤，不能锁定。").format(len(unmatched)))
	if pending:
		frappe.throw(_("存在 {0} 条待确认考勤异常，不能锁定。").format(len(pending)))


def _daily_identity_key(row):
	return (
		getattr(row, "employee", "") or getattr(row, "employee_code", "") or getattr(row, "employee_name", ""),
		_cell_text(getattr(row, "attendance_date", "")),
	)


def _row_correction_version(row):
	try:
		return int(getattr(row, "correction_version", 1) or 1)
	except (TypeError, ValueError):
		return 1


def _prefer_manual_daily_rows(rows):
	selected = {}
	for row in rows:
		key = _daily_identity_key(row)
		if not key[0]:
			continue
		current = selected.get(key)
		if not current or _row_correction_version(row) > _row_correction_version(current):
			selected[key] = row
		elif _row_correction_version(row) == _row_correction_version(current) and getattr(row, "source_kind", "") == "人工调整":
			selected[key] = row
	return list(selected.values())


def _company_apple_records(attendance_month, company):
	start, end = _month_bounds(attendance_month)
	batches = frappe.get_all(ATTENDANCE_BATCH_DOCTYPE, filters={"company": company}, pluck="name")
	if not batches:
		return []
	return frappe.get_all(
		APPLE_RECORD_DOCTYPE,
		filters={"import_batch": ["in", batches], "reward_date": ["between", [start, end]]},
		fields=["*"],
		order_by="reward_date asc",
	)


def _source_summary_metadata(rows):
	batch_ids = sorted({_cell_text(getattr(row, "import_batch", "")) for row in rows if getattr(row, "import_batch", "")})
	batch_records = frappe.get_all(
		ATTENDANCE_BATCH_DOCTYPE,
		filters={"name": ["in", batch_ids]},
		fields=["name", "source_checksum"],
	)
	checksums = sorted({_cell_text(getattr(batch, "source_checksum", "")) for batch in batch_records if getattr(batch, "source_checksum", "")})
	payload = json.dumps({"batches": batch_ids, "source_checksums": checksums}, ensure_ascii=False, sort_keys=True)
	return ",".join(batch_ids), hashlib.sha256(payload.encode("utf-8")).hexdigest()


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
def generate_monthly_attendance_summary(company: str, attendance_month: str):
	company = _require_company(company)
	_month_bounds(attendance_month)
	lock = _prepare_month_lock_for_generation(company, attendance_month)
	attendance_lock_version = str(lock.active_version)
	daily_rows = _prefer_manual_daily_rows(_get_month_records(DAY_CHECK_DOCTYPE, "attendance_date", attendance_month, company))
	source_batch_ids, source_checksum = _source_summary_metadata(daily_rows)
	summaries = defaultdict(lambda: defaultdict(float))
	identity = {}
	person_aliases = {}
	for row in daily_rows:
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

	for row in _company_apple_records(attendance_month, company):
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

	existing_summaries = frappe.get_all(
		MONTHLY_SUMMARY_DOCTYPE,
		filters=_attendance_scope_filters(company, attendance_month, attendance_lock_version),
		fields=["name", "employee", "employee_code", "employee_name"],
	)
	existing_by_person = {_primary_person_key(row): row.name for row in existing_summaries if _primary_person_key(row)}
	created = []
	for key, values in summaries.items():
		source = identity[key]
		employee = getattr(source, "employee", None)
		date_of_joining = frappe.db.get_value("Employee", employee, "date_of_joining") if employee else None
		calculated = _calculate_monthly_values(values)
		summary_values = {
				"doctype": MONTHLY_SUMMARY_DOCTYPE,
				"company": company,
				"attendance_month": attendance_month,
				"attendance_lock_version": attendance_lock_version,
				"lock_status": "草稿",
				"source_batch_ids": source_batch_ids,
				"source_checksum": source_checksum,
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
		existing_name = existing_by_person.get(key)
		if existing_name:
			doc = frappe.get_doc(MONTHLY_SUMMARY_DOCTYPE, existing_name)
			doc.update(summary_values)
			doc.save(ignore_permissions=True)
		else:
			doc = frappe.get_doc(summary_values)
			doc.insert(ignore_permissions=True)
		created.append(doc.name)

	lock.source_batch_ids = source_batch_ids
	lock.source_checksum = source_checksum
	lock.save(ignore_permissions=True)
	frappe.db.commit()
	return {"created": len(created), "summaries": created, "company": company, "attendance_lock_version": attendance_lock_version}


@frappe.whitelist()
def lock_attendance_month(company: str, attendance_month: str, reason: str = ""):
	company = _require_company(company)
	_month_bounds(attendance_month)
	lock = _get_or_create_month_lock(company, attendance_month)
	if lock.status == "已锁定":
		frappe.throw(_("该公司考勤月份已经锁定。"))
	_assert_month_ready_for_lock(company, attendance_month)
	scope = _attendance_scope_filters(company, attendance_month, str(lock.active_version))
	summaries = frappe.get_all(MONTHLY_SUMMARY_DOCTYPE, filters=scope, fields=["name"])
	if not summaries:
		frappe.throw(_("没有可锁定的月度考勤草稿。"))
	locked_on = now_datetime()
	lock.status = "已锁定"
	lock.locked_by = frappe.session.user
	lock.locked_on = locked_on
	lock.save(ignore_permissions=True)
	for summary in summaries:
		frappe.db.set_value(
			MONTHLY_SUMMARY_DOCTYPE,
			summary.name,
			{"lock_status": "已锁定", "locked_by": frappe.session.user, "locked_on": locked_on},
		)
	audit_name = _append_lock_audit(lock, "锁定", reason)
	frappe.db.commit()
	return {
		"month_lock": lock.name,
		"company": company,
		"attendance_month": attendance_month,
		"attendance_lock_version": str(lock.active_version),
		"audit": audit_name,
	}


@frappe.whitelist()
def unlock_attendance_month(company: str, attendance_month: str, reason: str):
	company = _require_company(company)
	_month_bounds(attendance_month)
	reason = (reason or "").strip()
	if not reason:
		frappe.throw(_("解锁考勤月份必须填写原因。"))
	lock = _get_or_create_month_lock(company, attendance_month)
	if lock.status != "已锁定":
		frappe.throw(_("只有已锁定的考勤月份可以解锁。"))
	lock.status = "已重开"
	lock.reopened_by = frappe.session.user
	lock.reopened_on = now_datetime()
	lock.save(ignore_permissions=True)
	audit_name = _append_lock_audit(lock, "解锁", reason)
	frappe.db.commit()
	return {
		"month_lock": lock.name,
		"company": company,
		"attendance_month": attendance_month,
		"attendance_lock_version": str(lock.active_version),
		"audit": audit_name,
	}


def _attendance_demo_employee(employee_code):
	return frappe.db.get_value(
		"Employee",
		{"employee_number": employee_code, "company": TEST_ATTENDANCE_DEMO_COMPANY},
		["name", "employee_name", "department"],
		as_dict=True,
	)


def _get_or_create_attendance_demo_batch():
	name = frappe.db.get_value(
		ATTENDANCE_BATCH_DOCTYPE,
		{"company": TEST_ATTENDANCE_DEMO_COMPANY, "source_checksum": TEST_ATTENDANCE_DEMO_CHECKSUM},
		"name",
	)
	if name:
		return frappe.get_doc(ATTENDANCE_BATCH_DOCTYPE, name), True
	batch = frappe.get_doc(
		{
			"doctype": ATTENDANCE_BATCH_DOCTYPE,
			"company": TEST_ATTENDANCE_DEMO_COMPANY,
			"attendance_month": TEST_ATTENDANCE_DEMO_MONTH,
			"source_type": "test_attendance_demo",
			"source_checksum": TEST_ATTENDANCE_DEMO_CHECKSUM,
			"status": "已导入",
			"notes": "TEST-HRMS attendance demo: raw DingTalk source plus manual adjustment.",
		}
	)
	batch.insert(ignore_permissions=True)
	return batch, False


def _seed_attendance_demo_day_check(batch, row, source_kind, source_row):
	employee_code = row["工号"]
	if frappe.db.exists(
		DAY_CHECK_DOCTYPE,
		{
			"import_batch": batch.name,
			"employee_code": employee_code,
			"attendance_date": _parse_date(row["日期"]),
			"source_kind": source_kind,
		},
	):
		return False
	return bool(
		_insert_day_check(
			batch.name,
			{**row, "_source_row": source_row},
			TEST_ATTENDANCE_DEMO_COMPANY,
			source_kind,
			"TEST-HRMS attendance demo",
			1,
		)
	)


@frappe.whitelist()
def seed_test_attendance_demo(dry_run: int | str = 0):
	"""Create an idempotent attendance-only closure in TEST-HRMS / 2099-02."""
	dry_run = bool(int(dry_run or 0))
	if not frappe.db.exists("Company", TEST_ATTENDANCE_DEMO_COMPANY):
		frappe.throw(_("请先创建 TEST-HRMS 演示公司及员工种子。"))
	people = {code: _attendance_demo_employee(code) for code in ("TEST-REG-003", "TEST-MOV-007")}
	missing_people = [code for code, employee in people.items() if not employee]
	if missing_people:
		frappe.throw(_("缺少 TEST-HRMS 演示员工：{0}").format("、".join(missing_people)))
	if dry_run:
		return {
			"company": TEST_ATTENDANCE_DEMO_COMPANY,
			"attendance_month": TEST_ATTENDANCE_DEMO_MONTH,
			"dry_run": True,
			"would_create": ["导入批次", "钉钉原始日统计", "人工调整日统计", "考勤异常", "月度终稿", "月度锁定", "锁定审计"],
		}

	lock = _get_or_create_month_lock(TEST_ATTENDANCE_DEMO_COMPANY, TEST_ATTENDANCE_DEMO_MONTH)
	if lock.status == "已锁定":
		return get_test_attendance_demo_status()

	batch, batch_exists = _get_or_create_attendance_demo_batch()
	regular = people["TEST-REG-003"]
	moved = people["TEST-MOV-007"]
	rows = [
		(
			"钉钉原始导出",
			2,
			{
				"姓名": regular.employee_name,
				"工号": "TEST-REG-003",
				"日期": f"{TEST_ATTENDANCE_DEMO_MONTH}-03",
				"班次": "08:00-17:00",
				"上班时间": "08:00",
				"下班时间": "17:00",
				"标准工时": 8,
				"实际出勤(小时)": 8,
				"实际部门": regular.department,
			},
		),
		(
			"人工调整",
			3,
			{
				"姓名": regular.employee_name,
				"工号": "TEST-REG-003",
				"日期": f"{TEST_ATTENDANCE_DEMO_MONTH}-03",
				"班次": "08:00-17:00",
				"上班时间": "08:00",
				"下班时间": "16:30",
				"标准工时": 8,
				"实际出勤(小时)": 7.5,
				"请假/事假(小时)": 0.5,
				"关联审批单": "DEMO-LEAVE-2099-02-03",
				"实际部门": regular.department,
			},
		),
		(
			"钉钉原始导出",
			4,
			{
				"姓名": moved.employee_name,
				"工号": "TEST-MOV-007",
				"日期": f"{TEST_ATTENDANCE_DEMO_MONTH}-04",
				"班次": "08:00-17:00",
				"上班时间": "08:00",
				"下班时间": "",
				"下班缺卡": "是",
				"标准工时": 8,
				"实际出勤(小时)": 8,
				"实际部门": moved.department,
			},
		),
	]
	created_days = sum(1 for source_kind, source_row, row in rows if _seed_attendance_demo_day_check(batch, row, source_kind, source_row))
	batch.daily_sheet_rows = len(rows)
	batch.save(ignore_permissions=True)
	exception_result = generate_attendance_exceptions(batch.name)
	for name in exception_result["exceptions"]:
		frappe.db.set_value(
			EXCEPTION_DOCTYPE,
			name,
			{"confirmation_status": "已确认", "confirmed_by": frappe.session.user, "confirmed_on": now_datetime(), "remarks": "TEST-HRMS 演示：日核对已确认。"},
		)
	monthly_result = generate_monthly_attendance_summary(TEST_ATTENDANCE_DEMO_COMPANY, TEST_ATTENDANCE_DEMO_MONTH)
	lock_result = lock_attendance_month(TEST_ATTENDANCE_DEMO_COMPANY, TEST_ATTENDANCE_DEMO_MONTH, "TEST-HRMS 演示月度确认")
	frappe.db.commit()
	return {
		"company": TEST_ATTENDANCE_DEMO_COMPANY,
		"attendance_month": TEST_ATTENDANCE_DEMO_MONTH,
		"batch": batch.name,
		"batch_existing": batch_exists,
		"created_day_checks": created_days,
		"exceptions": exception_result["created"],
		"monthly": monthly_result,
		"lock": lock_result,
	}


@frappe.whitelist()
def get_test_attendance_demo_status():
	"""Read-only inventory for the TEST-HRMS attendance closure."""
	company = TEST_ATTENDANCE_DEMO_COMPANY
	month = TEST_ATTENDANCE_DEMO_MONTH
	batches = frappe.get_all(ATTENDANCE_BATCH_DOCTYPE, filters={"company": company, "attendance_month": month}, fields=["name", "status", "daily_sheet_rows", "source_checksum"])
	batch_ids = [batch.name for batch in batches]
	return {
		"company": company,
		"attendance_month": month,
		"batches": batches,
		"day_checks": frappe.get_all(DAY_CHECK_DOCTYPE, filters=[["company", "=", company], ["attendance_date", ">=", f"{month}-01"], ["attendance_date", "<", "2099-03-01"]], fields=["name", "employee_code", "attendance_date", "source_kind", "actual_attendance_hours", "leave_hours"]),
		"exceptions": frappe.get_all(EXCEPTION_DOCTYPE, filters={"import_batch": ["in", batch_ids or ["__none__"]]}, fields=["name", "employee_code", "exception_type", "confirmation_status"]),
		"month_lock": frappe.db.get_value(MONTH_LOCK_DOCTYPE, {"company": company, "attendance_month": month}, ["name", "status", "active_version", "source_checksum"], as_dict=True),
		"summaries": frappe.get_all(MONTHLY_SUMMARY_DOCTYPE, filters={"company": company, "attendance_month": month}, fields=["name", "employee_code", "attendance_lock_version", "lock_status", "actual_attendance_hours", "leave_hours"]),
	}


def _list_records(doctype, filters=None, fields=None, page_length=50):
	return frappe.get_all(
		doctype,
		filters=filters or {},
		fields=fields or ["*"],
		order_by="modified desc",
		limit_page_length=int(page_length or 50),
	)


@frappe.whitelist()
def list_attendance_day_checks(
	company: str,
	batch: str = "",
	attendance_month: str = "",
	effective_only: int = 1,
	page_length: int = 50,
):
	company = _require_company(company)
	if attendance_month:
		rows = _get_month_records(DAY_CHECK_DOCTYPE, "attendance_date", attendance_month, company)
		if batch:
			rows = [row for row in rows if row.import_batch == batch]
	else:
		filters = {"company": company}
		if batch:
			filters["import_batch"] = batch
		rows = _list_records(DAY_CHECK_DOCTYPE, filters=filters, page_length=page_length)
	if int(effective_only or 0):
		rows = _prefer_manual_daily_rows(rows)
	return rows[: int(page_length or 50)]


@frappe.whitelist()
def list_attendance_leave_evidence(batch: str = "", page_length: int = 50):
	filters = {"import_batch": batch} if batch else {}
	return _list_records(LEAVE_EVIDENCE_DOCTYPE, filters=filters, page_length=page_length)


@frappe.whitelist()
def list_attendance_exceptions(batch: str = "", page_length: int = 50):
	filters = {"import_batch": batch} if batch else {}
	return _list_records(EXCEPTION_DOCTYPE, filters=filters, page_length=page_length)


@frappe.whitelist()
def list_monthly_attendance_summary(company: str, attendance_month: str = "", page_length: int = 50):
	filters = {"company": _require_company(company)}
	if attendance_month:
		filters["attendance_month"] = attendance_month
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
def upsert_attendance_custom_rule(rule: str | dict):
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
