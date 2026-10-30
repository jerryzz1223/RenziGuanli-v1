"""Chinese, monochrome personnel reports shared by roster and history exports."""
import math
import re
import unicodedata
from datetime import date, datetime


LABELS = {
	"Event Name": "培训名称", "Trainer Name": "讲师姓名", "Course": "课程",
	"Location": "培训地点", "Start Time": "开始时间", "End Time": "结束时间",
	"Employee": "员工", "Employee Name": "姓名", "Company": "公司",
	"Department": "部门", "Hours": "学时", "Grade": "等级", "Comments": "备注",
	"School/University": "毕业院校", "Qualification": "学历", "Level": "级别",
	"Year of Passing": "毕业年份", "Class / Percentage": "成绩",
	"Designation": "岗位", "Branch": "分支机构", "From Date": "开始日期",
	"To Date": "结束日期", "Total Experience": "工作年限", "Salary": "工资",
	"Contact": "联系人", "Address": "地址", "Promotion Date": "晋升日期",
	"Current CTC": "调整前年度薪酬", "Revised CTC": "调整后年度薪酬",
	"Amended From": "修订来源", "Attendance Date": "考勤日期", "Status": "状态",
	"Leave Type": "假别", "Leave Approver": "请假审批人", "Posting Date": "填报日期",
	"Total Leave Days": "请假天数", "Half Day": "是否半天", "Half Day Date": "半天日期",
	"Description": "说明", "Reason": "原因", "Work From Home": "居家办公",
	"Shift": "班次", "Late Entry": "迟到", "Early Exit": "早退",
	"In Time": "上班时间", "Out Time": "下班时间", "Working Hours": "工作时数",
	"File Name": "文件名称", "File URL": "原件链接", "Attached To Field": "材料类别",
	"Creation": "创建时间", "UserId": "用户编号", "Notify users by email": "邮件通知用户",
	"Employee Separation Template": "离职办理模板", "Project": "项目",
}

VALUES = {
	"Active": "在职", "Inactive": "停用", "Suspended": "停职", "Left": "离职",
	"Male": "男", "Female": "女", "Other": "其他", "Draft": "草稿",
	"Submitted": "已提交", "Cancelled": "已取消", "Approved": "已批准",
	"Rejected": "已拒绝", "Open": "待处理", "Closed": "已关闭", "Pending": "待审批",
	"Present": "出勤", "Absent": "缺勤", "On Leave": "请假", "Half Day": "半天",
	"Work From Home": "居家办公", "Completed": "已完成", "Scheduled": "已安排",
	"Full-time": "全职", "Part-time": "兼职", "Intern": "实习", "Contract": "合同制",
	"Retainer": "顾问", "Single": "未婚", "Married": "已婚", "Divorced": "离异",
	"Yes": "是", "No": "否", "Pass": "合格", "Fail": "不合格",
	"HRMS Apple Reward Record": "苹果树奖惩记录",
	"HRMS Apple Tree History Summary": "苹果树历史汇总",
}


def chinese_label(label):
	"""Translate headings explicitly, independently of the exporting user's locale."""
	text = str(label or "内容")
	if text.startswith("单据状态（"):
		return "单据状态"
	if text in LABELS:
		return LABELS[text]
	if re.search(r"[A-Za-z]", text):
		import frappe
		translator = getattr(frappe, "_", None)
		if translator:
			text = translator(text, lang="zh")
		text = text.replace("JSON", "数据").replace("UserId", "用户编号")
	return text


def display_value(key, value):
	# Translate system enums only; names, original descriptions, IDs and URLs are verbatim.
	if key == "docstatus":
		return {0: "草稿", 1: "已提交", 2: "已取消"}.get(value, value)
	if key == "attached_to_field" and value:
		from hrms.api.employee_field_template import EMPLOYEE_MATERIAL_GROUPS, EMPLOYEE_MATERIAL_FIELD_PREFIX
		materials = {name: label for group in EMPLOYEE_MATERIAL_GROUPS for name, label in group["types"]}
		name = str(value).removeprefix(EMPLOYEE_MATERIAL_FIELD_PREFIX)
		return materials.get(name, "员工照片" if name == "image" else chinese_label(value))
	if isinstance(value, str) and (key in {"status", "gender", "employment_type", "marital_status", "source_type", "batch_status", "assessment_result"} or key.endswith("_status")):
		return VALUES.get(value, value)
	return value


def text_width(value):
	return max((sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in line)
				for line in str(value if value is not None else "").splitlines()), default=0)


def style_personnel_sheet(sheet, header_row=1, title_row=None, widths=None):
	from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
	from openpyxl.utils import get_column_letter
	line = Side(style="thin", color="000000")
	for index in range(1, sheet.max_column + 1):
		letter = get_column_letter(index)
		width = (widths or {}).get(index)
		if width is None:
			width = max(12, min(42, max(text_width(sheet.cell(r, index).value)
				for r in range(header_row, sheet.max_row + 1)) + 3))
		sheet.column_dimensions[letter].width = width
	for row in sheet:
		lines = 1
		for cell in row:
			cell.font = Font(name="宋体", size=11, color="000000", bold=cell.row in {header_row, title_row})
			cell.fill = PatternFill(fill_type=None)
			cell.alignment = Alignment(horizontal="center" if cell.row == header_row else "left", vertical="center", wrap_text=True)
			if cell.row >= header_row:
				cell.border = Border(left=line, right=line, top=line, bottom=line)
			if isinstance(cell.value, str):
				# All source text remains literal, including formula-like descriptions.
				cell.data_type = "s"
				cell.number_format = "@"
			if isinstance(cell.value, datetime):
				cell.number_format = "yyyy-mm-dd hh:mm"
			elif isinstance(cell.value, date):
				cell.number_format = "yyyy-mm-dd"
			width = sheet.column_dimensions[get_column_letter(cell.column)].width
			if cell.coordinate in sheet.merged_cells:
				for area in sheet.merged_cells.ranges:
					if cell.coordinate in area:
						width = sum(sheet.column_dimensions[get_column_letter(i)].width for i in range(area.min_col, area.max_col + 1))
						break
			lines = max(lines, sum(max(1, math.ceil(text_width(part) / max(1, width - 2))) for part in str(cell.value or "").split("\n")))
		sheet.row_dimensions[row[0].row].height = max(26, 16 * lines + 8)
	if title_row:
		cell = sheet.cell(title_row, 1)
		cell.font = Font(name="宋体", size=20, bold=True, color="000000")
		cell.alignment = Alignment(horizontal="center", vertical="center")
		sheet.row_dimensions[title_row].height = 38
	end = sheet.cell(sheet.max_row, sheet.max_column).coordinate
	sheet.freeze_panes = f"A{header_row + 1}"
	sheet.auto_filter.ref = f"A{header_row}:{end}"
	sheet.print_title_rows = f"1:{header_row}"
	sheet.print_options.horizontalCentered = True
	sheet.print_area = f"A1:{end}"
	sheet.sheet_view.showGridLines = False
	sheet.sheet_properties.pageSetUpPr.fitToPage = True
	sheet.page_setup.orientation = "landscape"
	sheet.page_setup.paperSize = sheet.PAPERSIZE_A3 if sheet.max_column > 12 else sheet.PAPERSIZE_A4
	# Very wide source tables continue across pages instead of shrinking to illegibility.
	sheet.page_setup.fitToWidth = 0 if sheet.max_column > 18 else 1
	sheet.page_setup.fitToHeight = 0
	sheet.page_setup.blackAndWhite = True
	sheet.oddFooter.center.text = "第 &P 页，共 &N 页"
	sheet.page_margins.left = sheet.page_margins.right = 0.25
