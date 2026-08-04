import hashlib
import json
import re
from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime
from io import BytesIO

import frappe
from frappe import _
from frappe.utils import flt, getdate, now_datetime

from hrms.payroll.payroll_formula import (
	FIELD_BY_NAME,
	FIELD_DEFINITIONS,
	FORMULA_TEMPLATES,
	FUNCTIONS,
	FormulaError,
	compile_formula,
	evaluate_formula,
	evaluate_formula_set,
)


PAYROLL_VARIABLE_SHEETS = [
	"奖惩提报单（提交财务）",
	"证书、多能工津贴名单",
	"全勤奖",
	"住房补贴",
	"住房补贴终稿",
	"学历补贴",
	"宿舍费",
	"社保名单",
	"继续服务奖",
	"提案改善表",
	"苹果树",
	"苹果树（修改后）",
	"离职人员薪资结算",
	"每月员工住宿费用明细表",
	"人员住宿登记表",
]
VARIABLE_BATCH_DOCTYPE = "HRMS Payroll Variable Import Batch"
VARIABLE_RECORD_DOCTYPE = "HRMS Payroll Variable Record"
PAYROLL_INPUT_DOCTYPE = "HRMS Payroll Input Record"
PAYROLL_SETTLEMENT_DOCTYPE = "HRMS Payroll Settlement Record"
LOCAL_PAYROLL_TEST_COMPANY = "TEST-HRMS"
SALARY_STRUCTURE_VERSION_DOCTYPE = "HRMS Salary Structure Version"
SALARY_GRADE_DOCTYPE = "HRMS Salary Grade"
EMPLOYEE_SALARY_CHANGE_DOCTYPE = "HRMS Employee Salary Change"
WELFARE_SOURCE_DOCTYPE = "HRMS Payroll Welfare Source Record"
PAYROLL_RULE_DOCTYPE = "HRMS Payroll Rule"
PAYROLL_FIELD_MAPPING_DOCTYPE = "HRMS Payroll Field Mapping"
MONTHLY_ATTENDANCE_DOCTYPE = "HRMS Monthly Attendance Summary"
PAYROLL_STANDARD_HOURS_DIVISOR = 174
WELFARE_SOURCE_SYNC_SHEET = "福利扣款来源中心"
PAYROLL_SETTLEMENT_IMPORT_SHEET = "薪资结算表"
PAYROLL_SETTLEMENT_IMPORT_SOURCE = "完整薪资结算表导入"

PAYROLL_IMPORT_TEMPLATES = [
	{
		"template_key": "employee_salary_change",
		"sheet_name": "员工薪资异动导入",
		"target_doctype": EMPLOYEE_SALARY_CHANGE_DOCTYPE,
		"description": "导入员工底薪、职能津贴、证书津贴、多能工津贴和薪资小计，是薪资结算表 E:H 列的主来源。",
		"required_columns": ["工号", "姓名", "生效日期"],
		"columns": [
			("薪资月份", "payroll_month", "可选；未填时使用页面月份"),
			("工号", "employee_code", "必填；用于匹配员工花名册"),
			("姓名", "employee_name", "必填；工号无法匹配时用姓名辅助匹配"),
			("部门", "department", "可选；未填时取员工花名册部门"),
			("岗位", "designation", "可选；未填时取员工花名册岗位"),
			("生效日期", "effective_date", "必填；格式 yyyy-mm-dd"),
			("异动原因", "change_reason", "如入职定薪、调薪、转正调薪"),
			("薪资档位", "salary_grade", "可选；已维护薪资档位时填写"),
			("底薪", "base_salary", "对应薪资结算表 E 列"),
			("职能津贴", "function_allowance", "对应薪资结算表 F 列"),
			("证书津贴", "certificate_allowance", "证书津贴"),
			("多能工津贴", "multi_skill_allowance", "多能工津贴"),
			("薪资小计", "full_salary", "对应薪资结算表 H 列；未填时自动 E+F+证书+多能工"),
			("社保", "social_insurance_enabled", "1/0 或 是/否"),
			("公积金", "housing_fund_enabled", "1/0 或 是/否"),
			("状态", "status", "默认已批准"),
			("备注", "remarks", "可选"),
		],
	},
	{
		"template_key": "welfare_source",
		"sheet_name": "福利扣款来源导入",
		"target_doctype": WELFARE_SOURCE_DOCTYPE,
		"description": "导入学历补贴、租房补贴、宿舍费、水电费、社保公积金、提案改善奖、继续服务奖、所得税等月度变量。",
		"required_columns": ["来源类型", "姓名", "金额"],
		"columns": [
			("薪资月份", "payroll_month", "可选；未填时使用页面月份"),
			("来源类型", "source_type", "如学历补贴、租房补贴、宿舍住宿费、宿舍水电费、社保个人、公积金个人、社保公司、公积金公司、提案改善奖、继续服务奖、所得税、年终奖所得税、水电费及扣款、已发福利、生产奖"),
			("工号", "employee_code", "建议填写"),
			("姓名", "employee_name", "必填"),
			("部门", "department", "可选"),
			("金额", "amount", "必填"),
			("资格状态", "eligibility_status", "默认符合"),
			("确认状态", "confirmation_status", "默认已确认"),
			("来源单据/说明", "source_reference", "如宿舍明细、社保名单、财务确认表"),
			("备注", "remarks", "可选"),
		],
	},
	{
		"template_key": "monthly_attendance_summary",
		"sheet_name": "月度考勤终稿导入",
		"target_doctype": MONTHLY_ATTENDANCE_DOCTYPE,
		"description": "导入考勤终稿，作为标准工时、基本出勤、加班、旷工、夜班和苹果树金额来源。",
		"required_columns": ["工号", "姓名", "标准工时", "基本出勤工时"],
		"columns": [
			("考勤月份", "attendance_month", "可选；未填时使用页面月份"),
			("工号", "employee_code", "必填；用于匹配员工花名册"),
			("姓名", "employee_name", "必填；工号无法匹配时用姓名辅助匹配"),
			("部门", "department", "可选"),
			("入职日期", "date_of_joining", "可选"),
			("标准工时", "standard_hours", "对应薪资结算表 I 列"),
			("基本出勤工时", "actual_attendance_hours", "对应薪资结算表 J 列"),
			("调整后工时", "adjusted_working_hours", "考勤终稿调整后工时"),
			("1.5倍加班", "overtime_1_5_hours", "对应平日加班时数"),
			("2倍加班", "overtime_2_hours", "对应调整前周末加班"),
			("3倍加班", "overtime_3_hours", "对应节假日加班"),
			("请假工时", "leave_hours", "月度请假合计"),
			("旷工工时", "absent_hours", "对应薪资结算表 AE 列"),
			("大夜班次数", "large_night_shift_count", "对应薪资结算表 V 列"),
			("小夜班次数", "small_night_shift_count", "对应薪资结算表 W 列"),
			("红绿苹果金额", "apple_reward_amount", "对应薪资结算表 AA 列"),
			("全勤扣款", "full_attendance_deduction", "全勤奖扣款来源"),
			("状态", "status", "默认已确认"),
		],
	},
]

SHEET_VARIABLE_TYPES = {
	"奖惩提报单（提交财务）": "其他奖金",
	"证书、多能工津贴名单": "证书及多能工津贴",
	"全勤奖": "全勤奖",
	"住房补贴": "住房补贴",
	"住房补贴终稿": "住房补贴",
	"学历补贴": "学历补贴",
	"宿舍费": "宿舍扣款",
	"社保名单": "社保个人",
	"继续服务奖": "继续服务奖",
	"提案改善表": "提案改善奖",
	"苹果树": "苹果树",
	"苹果树（修改后）": "苹果树",
	"离职人员薪资结算": "其他扣款",
	"每月员工住宿费用明细表": "宿舍扣款",
	"人员住宿登记表": "宿舍扣款",
}

VARIABLE_FIELD_MAP = {
	"全勤奖": "full_attendance_bonus",
	"住房补贴": "housing_subsidy",
	"学历补贴": "education_subsidy",
	"宿舍扣款": "dormitory_deduction",
	"社保个人": "social_security_personal",
	"公积金个人": "housing_fund_personal",
	"其他奖金": "other_bonus",
	"其他扣款": "other_deduction",
	"底薪": "base_salary",
	"职能津贴": "function_allowance",
	"职务津贴": "function_allowance",
	"证书津贴": "certificate_skill_allowance",
	"多能工津贴": "certificate_skill_allowance",
	"证书及多能工津贴": "certificate_skill_allowance",
	"全薪": "salary_subtotal",
	"薪资小计": "salary_subtotal",
	"生产奖": "production_bonus",
	"提案改善奖": "proposal_improvement_bonus",
	"继续服务奖": "continuing_service_bonus",
	"所得税": "income_tax",
	"年终奖所得税": "year_end_bonus_tax",
	"水电费及扣款": "utilities_deduction",
	"社保公司": "social_security_company",
	"公积金公司": "housing_fund_company",
	"已发福利": "paid_proposal_birthday_welfare",
	"夜班津贴": "night_shift_allowance",
	"迟到金额+全勤奖扣款": "late_full_attendance_deduction",
	"苹果树": "apple_reward_amount",
	"奖惩提报": "other_bonus",
	"离职薪资结算": "other_deduction",
}

WELFARE_SOURCE_VARIABLE_TYPE_MAP = {
	"薪资构成": "薪资小计",
	"学历补贴": "学历补贴",
	"租房补贴": "住房补贴",
	"宿舍住宿费": "宿舍扣款",
	"宿舍水电费": "水电费及扣款",
	"社保个人": "社保个人",
	"社保公司": "社保公司",
	"公积金个人": "公积金个人",
	"公积金公司": "公积金公司",
	"提案改善奖": "提案改善奖",
	"继续服务奖": "继续服务奖",
	"所得税": "所得税",
	"年终奖所得税": "年终奖所得税",
	"水电费及扣款": "水电费及扣款",
	"已发福利": "已发福利",
	"生产奖": "生产奖",
	"奖惩提报": "其他奖金",
	"证书多能工津贴": "证书及多能工津贴",
	"苹果树": "其他奖金",
	"离职薪资结算": "其他扣款",
	"高温补贴": "其他奖金",
	"手机话费补贴": "其他奖金",
	"油费补贴": "其他奖金",
	"其他奖金": "其他奖金",
	"其他扣款": "其他扣款",
}

WELFARE_SOURCE_RULES = [
	{
		"source_type": "薪资构成",
		"title": "薪资构成异动来源",
		"direction": "参考",
		"variable_type": "薪资小计",
		"rule": "异动前后岗位、职级、底薪、职能/职务津贴、证书津贴、多能工津贴、全薪只作为薪资主数据来源；结算以同公司已批准且生效的员工薪资异动为准。",
	},
	{
		"source_type": "证书多能工津贴",
		"title": "证书多能工津贴确认",
		"direction": "应发",
		"variable_type": "证书及多能工津贴",
		"rule": "证书津贴、多能工津贴需保留来源单据与确认状态；进入薪资主数据或同版本变量后参与试算。",
	},
	{
		"source_type": "奖惩提报",
		"title": "奖惩提报",
		"direction": "应发/应扣",
		"variable_type": "其他奖金",
		"rule": "奖惩提报按已确认金额导入；奖励映射其他奖金，扣款可在来源记录中选择其他扣款。",
	},
	{
		"source_type": "苹果树",
		"title": "绩效与苹果树变量",
		"direction": "应发",
		"variable_type": "苹果树",
		"rule": "只读取绩效与试用报表线程输出的已确认苹果树变量，必须与薪资公司、月份、考勤锁定版本一致。",
	},
	{
		"source_type": "离职薪资结算",
		"title": "离职薪资结算",
		"direction": "应发/应扣",
		"variable_type": "其他扣款",
		"rule": "离职薪资结算只能读取同公司、同月、同锁定版本的考勤终稿和变量，不能跨公司；补发或扣款需作为来源记录确认。",
	},
	{
		"source_type": "学历补贴",
		"title": "学历补贴资格与月报",
		"direction": "应发",
		"variable_type": "学历补贴",
		"rule": "非全日制大专100元；全日制大专、非全日制本科200元；全日制本科及以上300元；入职当月开始提交月报，共24个月。",
	},
	{
		"source_type": "租房补贴",
		"title": "租房补贴申请/登记/月度明细",
		"direction": "应发",
		"variable_type": "住房补贴",
		"rule": "外地户籍在苏州租房人员享受；苏州户籍或苏州买房不享受；入职10号前200元，11-20号100元，21号及以后0元；离职当月满勤200元，未做满0元。",
	},
	{
		"source_type": "宿舍住宿费",
		"title": "宿舍入住/退宿/住宿费",
		"direction": "应扣",
		"variable_type": "宿舍扣款",
		"rule": "干部宿舍300元/月，阁楼干部宿舍200元/月，线长单身宿舍400元/月，集体宿舍400元/月；每月10号前确认给财务。",
	},
	{
		"source_type": "宿舍水电费",
		"title": "宿舍入住/退宿/水电住宿费",
		"direction": "应扣",
		"variable_type": "水电费及扣款",
		"rule": "宿舍水费4.25元/吨，电费0.9元/度；按每月员工住宿费用明细表确认后进入薪资扣款。",
	},
	{
		"source_type": "社保个人",
		"title": "社保公积金个人/公司承担",
		"direction": "应扣",
		"variable_type": "社保个人",
		"rule": "五险对象为转正后员工；个人承担额来自社保名单或财务确认表。",
	},
	{
		"source_type": "公积金个人",
		"title": "社保公积金个人/公司承担",
		"direction": "应扣",
		"variable_type": "公积金个人",
		"rule": "住房公积金对象为转正后员工；个人承担额来自公积金名单或财务确认表。",
	},
	{
		"source_type": "社保公司",
		"title": "社保公积金个人/公司承担",
		"direction": "公司承担",
		"variable_type": "社保公司",
		"rule": "公司承担额可手工确认；未提供时薪资结算按薪资结算表区间公式由个人社保反推。",
	},
	{
		"source_type": "公积金公司",
		"title": "社保公积金个人/公司承担",
		"direction": "公司承担",
		"variable_type": "公积金公司",
		"rule": "公司公积金承担额可手工确认；未提供时薪资结算默认等于个人公积金。",
	},
	{
		"source_type": "提案改善奖",
		"title": "提案改善奖、继续服务奖、所得税、水电扣款等月度变量",
		"direction": "应发",
		"variable_type": "提案改善奖",
		"rule": "按月度确认金额录入，进入奖金小计。",
	},
	{
		"source_type": "继续服务奖",
		"title": "提案改善奖、继续服务奖、所得税、水电扣款等月度变量",
		"direction": "应发",
		"variable_type": "继续服务奖",
		"rule": "按年度公告和缺勤区间确认金额；进入实发工资与公司实际负担。",
	},
	{
		"source_type": "所得税",
		"title": "提案改善奖、继续服务奖、所得税、水电扣款等月度变量",
		"direction": "应扣",
		"variable_type": "所得税",
		"rule": "按国家法令代扣代缴；可由财务确认后按月导入。",
	},
	{
		"source_type": "水电费及扣款",
		"title": "提案改善奖、继续服务奖、所得税、水电扣款等月度变量",
		"direction": "应扣",
		"variable_type": "水电费及扣款",
		"rule": "除宿舍水电外的月度水电及其他已确认扣款。",
	},
]

DEFAULT_PAYROLL_RULES = [
	{
		"rule_code": "SALARY_STRUCTURE_SUBTOTAL",
		"rule_name": "薪资小计",
		"rule_category": "薪资架构",
		"rule_scope": "所有员工",
		"formula_expression": "薪资小计 = 底薪 + 职能津贴 + 证书及多能工津贴",
		"parameters_json": {"base_salary": "底薪", "function_allowance": "职能津贴", "certificate_skill_allowance": "证书及多能工津贴"},
		"rule_text": "员工薪资以《人事组薪资异动表》为准，薪资架构提供底薪、职能津贴、证书津贴、多能工津贴和薪资小计来源。",
		"source_file": "5.1薪资福利.xlsx",
		"source_sheet": "薪资架构 / 人事组薪资异动表",
	},
	{
		"rule_code": "ATTENDANCE_FULL_ATTENDANCE_BONUS",
		"rule_name": "全勤奖",
		"rule_category": "考勤",
		"rule_scope": "月度考勤终稿",
		"formula_expression": "缺勤=标准工时-钉钉导出实际出勤-排休+病假/2；0=200，0~0.5=190，0.5~16=150，16~32=100，32~48=50，>48=0",
		"parameters_json": {"base_bonus": 200, "late_deduction": 10, "thresholds": [[0, 200], [0.5, 190], [16, 150], [32, 100], [48, 50]]},
		"rule_text": "特休、公休、公司原因调整上班时间不扣全勤；其他假别计入请假工时。新进与离职员工当月未上班时间计入缺勤。",
		"source_file": "5.1薪资福利.xlsx / 5.2人资考勤.xlsx",
		"source_sheet": "薪资福利作业规范 / 1.12考勤终稿",
		"source_cell": "薪资福利作业规范 rows 33-43；1.12考勤终稿 BF列",
	},
	{
		"rule_code": "ATTENDANCE_OVERTIME_HOURS",
		"rule_name": "考勤终稿工时换算",
		"rule_category": "考勤",
		"rule_scope": "月度考勤终稿",
		"formula_expression": "1倍结算工时、1.5倍结算工时、2倍结算工时、3倍节假日加班工时按1.12考勤终稿 AH:AV 列公式生成",
		"parameters_json": {"workday_multiplier": 1.5, "weekend_multiplier": 2, "holiday_multiplier": 3},
		"rule_text": "请假、病假补/扣工时、特休、工伤、丧假、婚假、排休等先在考勤终稿中换算，再进入薪资结算表。",
		"source_file": "5.2人资考勤.xlsx",
		"source_sheet": "1.12考勤终稿",
		"source_cell": "AH:AV",
	},
	{
		"rule_code": "PERFORMANCE_APPLE_REWARD",
		"rule_name": "苹果树奖惩金额",
		"rule_category": "奖金福利",
		"rule_scope": "审批通过并纳入考勤锁定版本的苹果树记录",
		"formula_expression": "苹果树金额 = (绿苹果颗数 - 红苹果颗数) * 5",
		"parameters_json": {"amount_per_apple": 5, "locked_attendance_required": True},
		"rule_text": "部门主管审批通过后，月初随考勤给员工签字确认；薪资不读取草稿或未锁定的苹果树记录。",
		"source_file": "4.2苹果树.xlsx / 5.2人资考勤.xlsx",
		"source_sheet": "苹果树管理办法 / 1.12考勤终稿",
		"source_cell": "苹果树管理办法 row 6；考勤终稿苹果树金额列",
	},
	{
		"rule_code": "PAYROLL_SETTLEMENT_ABSENCE_DEDUCTION",
		"rule_name": "缺勤扣除金额",
		"rule_category": "薪资结算",
		"rule_scope": "薪资结算表",
		"formula_expression": "缺勤扣除金额 = ROUND(薪资小计 / 174 * 调整后缺勤工时, 2)",
		"parameters_json": {"standard_hours_divisor": 174},
		"rule_text": "调整后缺勤工时 = IF(缺勤工时 - 调整前周末加班 > 0, 缺勤工时 - 调整前周末加班, 0)。",
		"source_file": "5.2人资考勤.xlsx",
		"source_sheet": "薪资结算表",
		"source_cell": "M:N",
	},
	{
		"rule_code": "PAYROLL_SETTLEMENT_OVERTIME_PAY",
		"rule_name": "加班费",
		"rule_category": "薪资结算",
		"rule_scope": "薪资结算表",
		"formula_expression": "平日=ROUND(底薪/174*平日加班*1.5,2)；周末=ROUND(底薪/174*调整后周末加班*2,2)；节假日=ROUND(底薪/174*节假日加班*3,2)",
		"parameters_json": {"standard_hours_divisor": 174, "weekday": 1.5, "weekend": 2, "holiday": 3},
		"rule_text": "加班费小计为平日、周末、节假日加班费合计。",
		"source_file": "5.2人资考勤.xlsx",
		"source_sheet": "薪资结算表",
		"source_cell": "R:U",
	},
	{
		"rule_code": "PAYROLL_SETTLEMENT_NIGHT_SHIFT",
		"rule_name": "夜班津贴",
		"rule_category": "薪资结算",
		"rule_scope": "薪资结算表",
		"formula_expression": "夜班津贴 = 大夜班次数 * 45 + 小夜班次数 * 24",
		"parameters_json": {"large_night_shift": 45, "small_night_shift": 24},
		"rule_text": "大夜班和小夜班次数来自考勤终稿。",
		"source_file": "5.2人资考勤.xlsx",
		"source_sheet": "薪资结算表",
		"source_cell": "V:X",
	},
	{
		"rule_code": "PAYROLL_SETTLEMENT_GROSS_PAY",
		"rule_name": "应付工资",
		"rule_category": "薪资结算",
		"rule_scope": "薪资结算表",
		"formula_expression": "应付工资 = 薪资小计 - 缺勤扣除金额 + 加班费小计 + 夜班津贴 + 奖金小计 - 惩处小计",
		"parameters_json": {"bonus_total": "提案改善奖+红绿苹果+全勤奖住房学历补贴+生产奖", "punishment_total": "旷工扣款+迟到金额+全勤奖扣款"},
		"rule_text": "奖金小计和惩处小计必须保留来源记录。",
		"source_file": "5.2人资考勤.xlsx",
		"source_sheet": "薪资结算表",
		"source_cell": "AD:AI",
	},
	{
		"rule_code": "PAYROLL_SETTLEMENT_NET_PAY",
		"rule_name": "实发工资",
		"rule_category": "薪资结算",
		"rule_scope": "薪资结算表",
		"formula_expression": "计税工资 = 应付工资 - 社保个人 - 公积金个人 + 已发福利；实发工资 = 计税工资 - 所得税 - 年终奖所得税 - 水电费及扣款 + 继续服务奖 - 已发福利",
		"parameters_json": {"paid_welfare": "提案改善奖&生日福利金（已发）"},
		"rule_text": "所得税和年终奖所得税由财务/个税规则确认后进入变量。",
		"source_file": "5.2人资考勤.xlsx",
		"source_sheet": "薪资结算表",
		"source_cell": "AM:AS",
	},
	{
		"rule_code": "WELFARE_EDUCATION_SUBSIDY",
		"rule_name": "学历补贴",
		"rule_category": "福利补贴",
		"rule_scope": "符合学历补贴人员",
		"formula_expression": "非全日制大专=100；全日制大专/非全日制本科=200；全日制本科及以上=300；最多24个月",
		"parameters_json": {"non_full_time_college": 100, "full_time_college_or_non_full_time_bachelor": 200, "full_time_bachelor_or_above": 300, "months": 24},
		"rule_text": "入职当月即可享受并提交月报；离职当月享受但离职前需提交报告。",
		"source_file": "5.1薪资福利.xlsx",
		"source_sheet": "学历补贴工作月报管理办法",
	},
	{
		"rule_code": "WELFARE_RENTAL_SUBSIDY",
		"rule_name": "租房补贴",
		"rule_category": "福利补贴",
		"rule_scope": "外地户籍在苏州租房人员",
		"formula_expression": "入职当月10号前=200；11-20号=100；21号及以后=0；离职当月满勤=200，未做满=0",
		"parameters_json": {"before_or_on_day_10": 200, "day_11_to_20": 100, "after_or_on_day_21": 0, "resignation_full_attendance": 200},
		"rule_text": "苏州户籍以及在苏州买房者不享受；住公司宿舍人员按宿舍规则处理。",
		"source_file": "5.5租房补贴.xlsx",
		"source_sheet": "租房补贴作业规范",
		"source_cell": "rows 17-31",
	},
	{
		"rule_code": "WELFARE_DORMITORY_FEE",
		"rule_name": "宿舍住宿费",
		"rule_category": "宿舍",
		"rule_scope": "住宿员工",
		"formula_expression": "干部宿舍=300/月；阁楼干部宿舍=200/月；线长单身宿舍=400/月；集体宿舍=400/月；水费=4.25/吨；电费=0.9/度",
		"parameters_json": {"manager_dorm": 300, "attic_manager_dorm": 200, "line_leader_single_dorm": 400, "group_dorm": 400, "water_per_ton": 4.25, "electricity_per_kwh": 0.9},
		"rule_text": "每月10号前住宿员工签字确认后给财务结算薪资用。",
		"source_file": "5.6员工宿舍.xlsx",
		"source_sheet": "员工宿舍作业规范",
		"source_cell": "rows 90-100",
	},
	{
		"rule_code": "WELFARE_SOCIAL_SECURITY_COMPANY",
		"rule_name": "公司社保承担",
		"rule_category": "社保公积金",
		"rule_scope": "转正后员工",
		"formula_expression": "若社保公司未手工确认，则按薪资结算表区间由社保个人反推：<524.96=0；=524.96=1256.82；520~531=1269；531~636=1522.8；>636=1649.7",
		"parameters_json": {"manual_override": True, "ranges": [[0, 524.96, 0], [524.96, 524.96, 1256.82], [520, 531, 1269], [531, 636, 1522.8], [636, None, 1649.7]]},
		"rule_text": "五险对象为转正后员工；增减员、基数、比例、上下限仍需以社保名单或财务确认表为准。",
		"source_file": "5.1薪资福利.xlsx / 5.2人资考勤.xlsx",
		"source_sheet": "薪资福利作业规范 / 薪资结算表",
		"missing_rule_note": "社保个人基数、比例、增减员当月规则未在当前表中完整结构化。",
	},
	{
		"rule_code": "WELFARE_HOUSING_FUND_COMPANY",
		"rule_name": "公司公积金承担",
		"rule_category": "社保公积金",
		"rule_scope": "转正后员工",
		"formula_expression": "公司公积金 = 公积金个人，除非福利扣款来源中心手工确认公司承担额",
		"parameters_json": {"default_company_equals_personal": True, "manual_override": True},
		"rule_text": "住房公积金对象为转正后员工。",
		"source_file": "5.1薪资福利.xlsx / 5.2人资考勤.xlsx",
		"source_sheet": "薪资福利作业规范 / 薪资结算表",
		"missing_rule_note": "公积金基数、比例、增减员当月规则未在当前表中完整结构化。",
	},
	{
		"rule_code": "TAX_INCOME_TAX",
		"rule_name": "所得税代扣",
		"rule_category": "税费扣款",
		"rule_scope": "所有应税员工",
		"formula_expression": "所得税、年终奖所得税目前作为财务确认月度变量导入",
		"parameters_json": {"manual_import": True},
		"rule_text": "凡薪资、奖金核发，一律依照国家法令代扣缴个人所得税。",
		"source_file": "5.1薪资福利.xlsx",
		"source_sheet": "薪资福利作业规范",
		"source_cell": "row 27",
		"missing_rule_note": "专项扣除、累计预扣、年终奖税等完整个税计算参数未在公司资料中结构化提供。",
	},
	{
		"rule_code": "WELFARE_CONTINUING_SERVICE_BONUS",
		"rule_name": "继续服务奖",
		"rule_category": "奖金福利",
		"rule_scope": "符合年度公告且仍在职的员工",
		"formula_expression": "已确认继续服务奖金额作为月度变量进入实发工资和公司实际负担",
		"parameters_json": {"confirmed_source_required": True},
		"rule_text": "缺勤区间和年度公告决定是否享受；系统只读取同公司、同月份、同考勤锁定版本的已确认来源记录。",
		"source_file": "5.1薪资福利.xlsx",
		"source_sheet": "薪资福利作业规范",
		"missing_rule_note": "各年度基准金额、发放月份及特殊假别是否计入缺勤尚未形成稳定参数表，暂不自动计算。",
	},
	{
		"rule_code": "WELFARE_HIGH_TEMPERATURE_SUBSIDY",
		"rule_name": "高温补贴",
		"rule_category": "福利补贴",
		"rule_scope": "符合当年公告和出勤条件的员工",
		"formula_expression": "当月高温补贴 = 当年有效公告单价或金额 × 已确认资格/天数",
		"parameters_json": {"confirmed_source_required": True},
		"rule_text": "离职人员不享受；实际发放月份、岗位范围和标准以当年公司公告及确认明细为准。",
		"source_file": "5.1薪资福利.xlsx",
		"source_sheet": "薪资福利作业规范",
		"missing_rule_note": "当前资料未提供长期有效的年度单价、月份和岗位资格参数，必须按年度来源记录导入。",
	},
	{
		"rule_code": "PAYROLL_PART_MONTH_PRORATION",
		"rule_name": "入离职及未满月工资折算",
		"rule_category": "薪资结算",
		"rule_scope": "当月入职、离职、转正或调薪员工",
		"formula_expression": "按薪资异动生效日期、锁定考勤工时和经确认的未满月口径计算",
		"parameters_json": {"confirmed_policy_required": True},
		"rule_text": "薪资异动按生效日期取值；入离职未上班时间会影响全勤和缺勤，但固定薪资是否按工时、天数或分段薪资折算需单独确认。",
		"source_file": "5.1薪资福利.xlsx / 5.2人资考勤.xlsx",
		"source_sheet": "人事组薪资异动表 / 薪资结算表",
		"missing_rule_note": "未满月固定薪资折算、月中调薪分段、离职结算截止日尚未形成唯一可执行规则，当前系统阻止将说明文本当作公式执行。",
	},
	{
		"rule_code": "PAYROLL_TERMINATION_SETTLEMENT",
		"rule_name": "离职薪资结算",
		"rule_category": "薪资结算",
		"rule_scope": "当月离职、异常离职或开除员工",
		"formula_expression": "试用期未满7天按符合8小时的工作日100元/天，工作1天离职无薪；其他扣款按已批准离职申请单确认",
		"parameters_json": {"trial_under_seven_days_daily_amount": 100, "one_day_departure_amount": 0, "approved_source_required": True},
		"rule_text": "试用期未提前3个工作日申请、正式员工未提前30日申请、旷工或开除涉及特殊扣款，必须由离职申请单和考勤终稿共同确认。",
		"source_file": "6.9离职.xlsx",
		"source_sheet": "离职作业规范 / 人事组员工辞职申请单",
		"source_cell": "离职作业规范 rows 29-31；辞职申请单 rows 9-16",
		"missing_rule_note": "此规则涉及劳动关系和审批结论，当前仅作为离职薪资结算来源记录，不自动从员工状态推导扣款。",
	},
	{
		"rule_code": "PAYROLL_MINIMUM_WAGE_CHECK",
		"rule_name": "最低工资差异检查",
		"rule_category": "薪资结算",
		"rule_scope": "按员工工作地和规则生效区间",
		"formula_expression": "将适用口径工资与员工工作地、生效期间的已确认最低工资标准比较",
		"parameters_json": {"confirmed_legal_source_required": True, "enforcement": "warning"},
		"rule_text": "成熟系统页面提供最低工资配置入口；本项目只把它作为差异检查，不用未经确认的金额自动改写工资。",
		"source_file": "成熟系统参考截图",
		"source_sheet": "薪酬设置 / 最低工资",
		"missing_rule_note": "公司资料未提供工作地、标准金额、生效区间和比较口径，需人事/法务按现行政策确认后才能启用阻断。",
	},
]

# Formula text is deliberately not evaluated as Python/JavaScript.  Payroll is
# a high-risk financial domain: only registered calculation drivers may run.
# The editable JSON below is the executable part of a rule and is validated
# before a payroll month can be generated.
EXECUTABLE_PAYROLL_RULES = {
	"SALARY_STRUCTURE_SUBTOTAL": {"parameters": ()},
	"ATTENDANCE_FULL_ATTENDANCE_BONUS": {"parameters": ("thresholds",)},
	"PAYROLL_SETTLEMENT_ABSENCE_DEDUCTION": {"parameters": ("standard_hours_divisor",)},
	"PAYROLL_SETTLEMENT_OVERTIME_PAY": {"parameters": ("standard_hours_divisor", "weekday", "weekend", "holiday")},
	"PAYROLL_SETTLEMENT_NIGHT_SHIFT": {"parameters": ("large_night_shift", "small_night_shift")},
	"WELFARE_SOCIAL_SECURITY_COMPANY": {"parameters": ("ranges",)},
	"WELFARE_HOUSING_FUND_COMPANY": {"parameters": ("default_company_equals_personal",)},
}

# These formulas are calculated by the settlement pipeline itself.  They are
# intentionally visible in the rule centre for audit, but their expression is
# not editable JSON: changing their structure requires a reviewed code change,
# rather than evaluating arbitrary text in a payroll run.
FIXED_PAYROLL_CALCULATION_RULES = {
	"ATTENDANCE_OVERTIME_HOURS",
	"PAYROLL_SETTLEMENT_GROSS_PAY",
	"PAYROLL_SETTLEMENT_NET_PAY",
}

PAYROLL_SETTLEMENT_FIELD_MAPPINGS = [
	{"mapping_code": "EXCEL_B_DEPARTMENT", "display_order": 2, "excel_column": "B", "excel_label": "部门", "system_field": "department", "source_module": "员工档案", "source_detail": "Employee.department 或考勤/变量来源部门"},
	{"mapping_code": "EXCEL_C_EMPLOYEE_CODE", "display_order": 3, "excel_column": "C", "excel_label": "工号", "system_field": "employee_code", "source_module": "员工档案", "source_detail": "Employee 工号"},
	{"mapping_code": "EXCEL_D_EMPLOYEE_NAME", "display_order": 4, "excel_column": "D", "excel_label": "姓名", "system_field": "employee_name", "source_module": "员工档案", "source_detail": "Employee.employee_name"},
	{"mapping_code": "EXCEL_E_BASE_SALARY", "display_order": 5, "excel_column": "E", "excel_label": "底薪", "system_field": "base_salary", "source_module": "薪资主数据", "source_detail": "员工薪资异动优先，其次薪资变量", "rule_code": "SALARY_STRUCTURE_SUBTOTAL"},
	{"mapping_code": "EXCEL_F_FUNCTION_ALLOWANCE", "display_order": 6, "excel_column": "F", "excel_label": "职能津贴", "system_field": "function_allowance", "source_module": "薪资主数据", "source_detail": "员工薪资异动优先，其次薪资变量", "rule_code": "SALARY_STRUCTURE_SUBTOTAL"},
	{"mapping_code": "EXCEL_G_CERTIFICATE_SKILL_ALLOWANCE", "display_order": 7, "excel_column": "G", "excel_label": "证书及多能工津贴", "system_field": "certificate_skill_allowance", "source_module": "薪资主数据", "source_detail": "证书津贴 + 多能工津贴", "rule_code": "SALARY_STRUCTURE_SUBTOTAL"},
	{"mapping_code": "EXCEL_H_SALARY_SUBTOTAL", "display_order": 8, "excel_column": "H", "excel_label": "薪资小计", "system_field": "salary_subtotal", "source_module": "公式计算", "formula_expression": "SUM(E:G)", "rule_code": "SALARY_STRUCTURE_SUBTOTAL"},
	{"mapping_code": "EXCEL_I_STANDARD_HOURS", "display_order": 9, "excel_column": "I", "excel_label": "标准工时", "system_field": "standard_hours", "source_module": "考勤终稿", "source_detail": "HRMS Monthly Attendance Summary.standard_hours"},
	{"mapping_code": "EXCEL_J_BASIC_ATTENDANCE_HOURS", "display_order": 10, "excel_column": "J", "excel_label": "调整前/基本出勤工时", "system_field": "basic_attendance_hours", "source_module": "考勤终稿", "source_detail": "实际出勤/基本出勤工时"},
	{"mapping_code": "EXCEL_K_ABSENCE_HOURS", "display_order": 11, "excel_column": "K", "excel_label": "缺勤工时", "system_field": "missing_hours", "source_module": "公式计算", "formula_expression": "I-J", "rule_code": "PAYROLL_SETTLEMENT_ABSENCE_DEDUCTION"},
	{"mapping_code": "EXCEL_L_RAW_WEEKEND_OVERTIME", "display_order": 12, "excel_column": "L", "excel_label": "调整前周末加班", "system_field": "raw_weekend_overtime_hours", "source_module": "考勤终稿", "source_detail": "考勤终稿2倍加班工时"},
	{"mapping_code": "EXCEL_M_ADJUSTED_ABSENCE_HOURS", "display_order": 13, "excel_column": "M", "excel_label": "调整后缺勤工时", "system_field": "adjusted_absence_hours", "source_module": "公式计算", "formula_expression": "IF(K-L>0,K-L,0)", "rule_code": "PAYROLL_SETTLEMENT_ABSENCE_DEDUCTION"},
	{"mapping_code": "EXCEL_N_ABSENCE_DEDUCTION", "display_order": 14, "excel_column": "N", "excel_label": "缺勤工时对应的扣除金额", "system_field": "absence_deduction_amount", "source_module": "公式计算", "formula_expression": "ROUND(H/174*M,2)", "rule_code": "PAYROLL_SETTLEMENT_ABSENCE_DEDUCTION"},
	{"mapping_code": "EXCEL_O_ADJUSTED_WEEKEND_OVERTIME", "display_order": 15, "excel_column": "O", "excel_label": "调整后周末加班", "system_field": "weekend_overtime_hours", "source_module": "公式计算", "formula_expression": "L-K+M", "rule_code": "ATTENDANCE_OVERTIME_HOURS"},
	{"mapping_code": "EXCEL_P_WEEKDAY_OVERTIME_HOURS", "display_order": 16, "excel_column": "P", "excel_label": "平日加班时数", "system_field": "weekday_overtime_hours", "source_module": "考勤终稿", "rule_code": "ATTENDANCE_OVERTIME_HOURS"},
	{"mapping_code": "EXCEL_Q_HOLIDAY_OVERTIME_HOURS", "display_order": 17, "excel_column": "Q", "excel_label": "节假日加班时数", "system_field": "holiday_overtime_hours", "source_module": "考勤终稿", "rule_code": "ATTENDANCE_OVERTIME_HOURS"},
	{"mapping_code": "EXCEL_R_WEEKDAY_OVERTIME_PAY", "display_order": 18, "excel_column": "R", "excel_label": "加班费/平日", "system_field": "weekday_overtime_pay", "source_module": "公式计算", "formula_expression": "ROUND(E/174*P*1.5,2)", "rule_code": "PAYROLL_SETTLEMENT_OVERTIME_PAY"},
	{"mapping_code": "EXCEL_S_WEEKEND_OVERTIME_PAY", "display_order": 19, "excel_column": "S", "excel_label": "加班费/周末", "system_field": "weekend_overtime_pay", "source_module": "公式计算", "formula_expression": "ROUND(E/174*2*O,2)", "rule_code": "PAYROLL_SETTLEMENT_OVERTIME_PAY"},
	{"mapping_code": "EXCEL_T_HOLIDAY_OVERTIME_PAY", "display_order": 20, "excel_column": "T", "excel_label": "加班费/节假日", "system_field": "holiday_overtime_pay", "source_module": "公式计算", "formula_expression": "ROUND(E/174*3*Q,2)", "rule_code": "PAYROLL_SETTLEMENT_OVERTIME_PAY"},
	{"mapping_code": "EXCEL_U_OVERTIME_PAY_TOTAL", "display_order": 21, "excel_column": "U", "excel_label": "加班费小计", "system_field": "overtime_pay_total", "source_module": "公式计算", "formula_expression": "SUM(R:T)", "rule_code": "PAYROLL_SETTLEMENT_OVERTIME_PAY"},
	{"mapping_code": "EXCEL_V_LARGE_NIGHT_SHIFT_COUNT", "display_order": 22, "excel_column": "V", "excel_label": "大夜班次数", "system_field": "large_night_shift_count", "source_module": "考勤终稿"},
	{"mapping_code": "EXCEL_W_SMALL_NIGHT_SHIFT_COUNT", "display_order": 23, "excel_column": "W", "excel_label": "小夜班次数", "system_field": "small_night_shift_count", "source_module": "考勤终稿"},
	{"mapping_code": "EXCEL_X_NIGHT_SHIFT_ALLOWANCE", "display_order": 24, "excel_column": "X", "excel_label": "夜班津贴", "system_field": "night_shift_allowance", "source_module": "公式计算", "formula_expression": "V*45+W*24", "rule_code": "PAYROLL_SETTLEMENT_NIGHT_SHIFT"},
	{"mapping_code": "EXCEL_Y_ATTENDANCE_WAGE", "display_order": 25, "excel_column": "Y", "excel_label": "出勤工资", "system_field": "attendance_wage", "source_module": "公式计算", "formula_expression": "H-N+U+X-AH", "rule_code": "PAYROLL_SETTLEMENT_GROSS_PAY"},
	{"mapping_code": "EXCEL_Z_PROPOSAL_IMPROVEMENT_BONUS", "display_order": 26, "excel_column": "Z", "excel_label": "提案改善奖", "system_field": "proposal_improvement_bonus", "source_module": "福利扣款", "source_detail": "福利扣款来源中心/薪资变量"},
	{"mapping_code": "EXCEL_AA_APPLE_REWARD_AMOUNT", "display_order": 27, "excel_column": "AA", "excel_label": "红绿苹果", "system_field": "apple_reward_amount", "source_module": "考勤终稿", "source_detail": "苹果树奖惩"},
	{"mapping_code": "EXCEL_AB_SUBSIDY_BONUS_TOTAL", "display_order": 28, "excel_column": "AB", "excel_label": "全勤奖,住房学历补贴", "system_field": "subsidy_bonus_total", "source_module": "福利扣款", "formula_expression": "全勤奖+住房补贴+学历补贴", "rule_code": "ATTENDANCE_FULL_ATTENDANCE_BONUS"},
	{"mapping_code": "EXCEL_AC_PRODUCTION_BONUS", "display_order": 29, "excel_column": "AC", "excel_label": "生产奖", "system_field": "production_bonus", "source_module": "福利扣款"},
	{"mapping_code": "EXCEL_AD_BONUS_TOTAL", "display_order": 30, "excel_column": "AD", "excel_label": "奖金小计", "system_field": "bonus_total", "source_module": "公式计算", "formula_expression": "SUM(Z:AC)", "rule_code": "PAYROLL_SETTLEMENT_GROSS_PAY"},
	{"mapping_code": "EXCEL_AE_ABSENTEEISM_HOURS", "display_order": 31, "excel_column": "AE", "excel_label": "旷工工时", "system_field": "absenteeism_hours", "source_module": "考勤终稿"},
	{"mapping_code": "EXCEL_AF_ABSENTEEISM_DEDUCTION", "display_order": 32, "excel_column": "AF", "excel_label": "旷工扣款", "system_field": "absenteeism_deduction", "source_module": "公式计算", "formula_expression": "ROUND(H/174*AE*3,2)", "rule_code": "PAYROLL_SETTLEMENT_GROSS_PAY"},
	{"mapping_code": "EXCEL_AG_LATE_FULL_ATTENDANCE_DEDUCTION", "display_order": 33, "excel_column": "AG", "excel_label": "迟到金额+全勤奖扣款", "system_field": "late_full_attendance_deduction", "source_module": "薪资变量", "rule_code": "ATTENDANCE_FULL_ATTENDANCE_BONUS"},
	{"mapping_code": "EXCEL_AH_PUNISHMENT_TOTAL", "display_order": 34, "excel_column": "AH", "excel_label": "惩处小计", "system_field": "punishment_total", "source_module": "公式计算", "formula_expression": "SUM(AF:AG)", "rule_code": "PAYROLL_SETTLEMENT_GROSS_PAY"},
	{"mapping_code": "EXCEL_AI_GROSS_PAY", "display_order": 35, "excel_column": "AI", "excel_label": "应付工资", "system_field": "gross_pay", "source_module": "公式计算", "formula_expression": "H-N+U+X+AD-AH", "rule_code": "PAYROLL_SETTLEMENT_GROSS_PAY"},
	{"mapping_code": "EXCEL_AJ_SOCIAL_SECURITY_PERSONAL", "display_order": 36, "excel_column": "AJ", "excel_label": "保险基金员工负担额", "system_field": "social_security_personal", "source_module": "福利扣款", "source_detail": "社保个人"},
	{"mapping_code": "EXCEL_AK_HOUSING_FUND_PERSONAL", "display_order": 37, "excel_column": "AK", "excel_label": "住房公积金", "system_field": "housing_fund_personal", "source_module": "福利扣款", "source_detail": "公积金个人"},
	{"mapping_code": "EXCEL_AL_PAID_WELFARE", "display_order": 38, "excel_column": "AL", "excel_label": "提案改善奖&生日福利金（已发）", "system_field": "paid_proposal_birthday_welfare", "source_module": "福利扣款", "source_detail": "已发福利"},
	{"mapping_code": "EXCEL_AM_TAXABLE_SALARY", "display_order": 39, "excel_column": "AM", "excel_label": "计税工资", "system_field": "taxable_salary", "source_module": "公式计算", "formula_expression": "AI-AJ-AK+AL", "rule_code": "PAYROLL_SETTLEMENT_NET_PAY"},
	{"mapping_code": "EXCEL_AN_CONTINUING_SERVICE_BONUS", "display_order": 40, "excel_column": "AN", "excel_label": "继续服务奖", "system_field": "continuing_service_bonus", "source_module": "福利扣款"},
	{"mapping_code": "EXCEL_AP_INCOME_TAX", "display_order": 42, "excel_column": "AP", "excel_label": "所得税代扣款", "system_field": "income_tax", "source_module": "福利扣款", "rule_code": "TAX_INCOME_TAX"},
	{"mapping_code": "EXCEL_AQ_YEAR_END_BONUS_TAX", "display_order": 43, "excel_column": "AQ", "excel_label": "年终奖所得税", "system_field": "year_end_bonus_tax", "source_module": "福利扣款", "rule_code": "TAX_INCOME_TAX"},
	{"mapping_code": "EXCEL_AR_UTILITIES_DEDUCTION", "display_order": 44, "excel_column": "AR", "excel_label": "水电费及扣款", "system_field": "utilities_deduction", "source_module": "福利扣款"},
	{"mapping_code": "EXCEL_AS_NET_PAY", "display_order": 45, "excel_column": "AS", "excel_label": "实发工资", "system_field": "net_pay", "source_module": "公式计算", "formula_expression": "AM-AP-AQ-AR+AN-AL", "rule_code": "PAYROLL_SETTLEMENT_NET_PAY"},
	{"mapping_code": "EXCEL_AT_SOCIAL_SECURITY_COMPANY", "display_order": 46, "excel_column": "AT", "excel_label": "保险基金公司负担额", "system_field": "social_security_company", "source_module": "公式计算", "formula_expression": "社保公司手工确认优先；否则按AJ区间反推", "rule_code": "WELFARE_SOCIAL_SECURITY_COMPANY"},
	{"mapping_code": "EXCEL_AU_HOUSING_FUND_COMPANY", "display_order": 47, "excel_column": "AU", "excel_label": "住房公积金公司负担", "system_field": "housing_fund_company", "source_module": "公式计算", "formula_expression": "AK", "rule_code": "WELFARE_HOUSING_FUND_COMPANY"},
	{"mapping_code": "EXCEL_AV_COMPANY_COST_TOTAL", "display_order": 48, "excel_column": "AV", "excel_label": "公司实际负担总计", "system_field": "company_cost_total", "source_module": "公式计算", "formula_expression": "AI+AT+AU+AN+AL", "rule_code": "PAYROLL_SETTLEMENT_NET_PAY"},
	{"mapping_code": "EXCEL_AW_EXPORT_OVERTIME_PAY", "display_order": 49, "excel_column": "AW", "excel_label": "加班工资", "system_field": "overtime_pay_total", "source_module": "导出辅助", "formula_expression": "U"},
	{"mapping_code": "EXCEL_AX_EXPORT_NIGHT_SHIFT", "display_order": 50, "excel_column": "AX", "excel_label": "夜班津贴", "system_field": "night_shift_allowance", "source_module": "导出辅助", "formula_expression": "X"},
	{"mapping_code": "EXCEL_AY_EXPORT_GROSS_PAY", "display_order": 51, "excel_column": "AY", "excel_label": "应付工资", "system_field": "gross_pay", "source_module": "导出辅助", "formula_expression": "AI"},
	{"mapping_code": "EXCEL_AZ_EXPORT_PAID_WELFARE", "display_order": 52, "excel_column": "AZ", "excel_label": "各类奖金及福利", "system_field": "paid_proposal_birthday_welfare", "source_module": "导出辅助", "formula_expression": "AL"},
	{"mapping_code": "EXCEL_BA_EXPORT_CONTINUING_SERVICE", "display_order": 53, "excel_column": "BA", "excel_label": "继续服务奖", "system_field": "continuing_service_bonus", "source_module": "导出辅助", "formula_expression": "AN"},
	{"mapping_code": "EXCEL_BB_EXPORT_SOCIAL_SECURITY_COMPANY", "display_order": 54, "excel_column": "BB", "excel_label": "公司承担社保", "system_field": "social_security_company", "source_module": "导出辅助", "formula_expression": "AT"},
	{"mapping_code": "EXCEL_BC_EXPORT_HOUSING_FUND_COMPANY", "display_order": 55, "excel_column": "BC", "excel_label": "公司承担公积金", "system_field": "housing_fund_company", "source_module": "导出辅助", "formula_expression": "AU"},
	{"mapping_code": "EXCEL_BD_EXPORT_NET_PAY", "display_order": 56, "excel_column": "BD", "excel_label": "实发工资", "system_field": "net_pay", "source_module": "导出辅助", "formula_expression": "AS"},
	{"mapping_code": "EXCEL_BE_EXPORT_TAX_ADJUSTED_NET", "display_order": 57, "excel_column": "BE", "excel_label": "导出校验工资", "system_field": "export_tax_adjusted_net_pay", "source_module": "导出辅助", "formula_expression": "AM+AN-AR-AP-AL-AQ", "remarks": "Excel 原表 BE 列无表头，保留为导出校验口径。"},
]

# Atomic options that are combined into one historical Excel column.  They stay
# separate in the configuration centre and are aggregated only when the legacy
# settlement layout is produced.
PAYROLL_ATOMIC_CONFIGURATION_ITEMS = [
	{"item_code": "SALARY_DUTY_ALLOWANCE", "item_name": "职务津贴", "category": "固定薪资", "data_type": "金额", "direction": "应发", "source_module": "薪资主数据", "result_field": "function_allowance", "aggregate_target": "职能津贴"},
	{"item_code": "SALARY_CERTIFICATE_ALLOWANCE", "item_name": "证书津贴", "category": "固定薪资", "data_type": "金额", "direction": "应发", "source_module": "薪资主数据", "result_field": "certificate_skill_allowance", "aggregate_target": "证书及多能工津贴"},
	{"item_code": "SALARY_MULTI_SKILL_ALLOWANCE", "item_name": "多能工津贴", "category": "固定薪资", "data_type": "金额", "direction": "应发", "source_module": "薪资主数据", "result_field": "certificate_skill_allowance", "aggregate_target": "证书及多能工津贴"},
	{"item_code": "BONUS_FULL_ATTENDANCE", "item_name": "全勤奖", "category": "奖金补贴", "data_type": "金额", "direction": "应发", "source_module": "考勤终稿/福利扣款", "result_field": "subsidy_bonus_total", "aggregate_target": "全勤奖、住房及学历补贴", "rule_code": "ATTENDANCE_FULL_ATTENDANCE_BONUS"},
	{"item_code": "BONUS_HOUSING_SUBSIDY", "item_name": "住房补贴", "category": "奖金补贴", "data_type": "金额", "direction": "应发", "source_module": "福利扣款", "result_field": "subsidy_bonus_total", "aggregate_target": "全勤奖、住房及学历补贴", "rule_code": "WELFARE_RENTAL_SUBSIDY"},
	{"item_code": "BONUS_EDUCATION_SUBSIDY", "item_name": "学历补贴", "category": "奖金补贴", "data_type": "金额", "direction": "应发", "source_module": "福利扣款", "result_field": "subsidy_bonus_total", "aggregate_target": "全勤奖、住房及学历补贴", "rule_code": "WELFARE_EDUCATION_SUBSIDY"},
	{"item_code": "BONUS_HIGH_TEMPERATURE", "item_name": "高温补贴", "category": "奖金补贴", "data_type": "金额", "direction": "应发", "source_module": "福利扣款", "result_field": "subsidy_bonus_total", "aggregate_target": "其他奖金"},
	{"item_code": "BONUS_PHONE", "item_name": "手机话费补贴", "category": "奖金补贴", "data_type": "金额", "direction": "应发", "source_module": "福利扣款", "result_field": "subsidy_bonus_total", "aggregate_target": "其他奖金"},
	{"item_code": "BONUS_FUEL", "item_name": "油费补贴", "category": "奖金补贴", "data_type": "金额", "direction": "应发", "source_module": "福利扣款", "result_field": "subsidy_bonus_total", "aggregate_target": "其他奖金"},
	{"item_code": "DEDUCTION_LATE", "item_name": "迟到扣款", "category": "扣款税费", "data_type": "金额", "direction": "应扣", "source_module": "考勤终稿/薪资变量", "result_field": "late_full_attendance_deduction", "aggregate_target": "迟到金额及全勤奖扣款"},
	{"item_code": "DEDUCTION_FULL_ATTENDANCE", "item_name": "全勤奖扣款", "category": "扣款税费", "data_type": "金额", "direction": "应扣", "source_module": "考勤终稿", "result_field": "late_full_attendance_deduction", "aggregate_target": "迟到金额及全勤奖扣款", "rule_code": "ATTENDANCE_FULL_ATTENDANCE_BONUS"},
	{"item_code": "DEDUCTION_DORMITORY", "item_name": "宿舍住宿费", "category": "扣款税费", "data_type": "金额", "direction": "应扣", "source_module": "福利扣款", "result_field": "utilities_deduction", "aggregate_target": "水电费及扣款", "rule_code": "WELFARE_DORMITORY_FEE"},
	{"item_code": "DEDUCTION_DORM_WATER", "item_name": "宿舍水费", "category": "扣款税费", "data_type": "金额", "direction": "应扣", "source_module": "福利扣款", "result_field": "utilities_deduction", "aggregate_target": "水电费及扣款", "rule_code": "WELFARE_DORMITORY_FEE"},
	{"item_code": "DEDUCTION_DORM_ELECTRICITY", "item_name": "宿舍电费", "category": "扣款税费", "data_type": "金额", "direction": "应扣", "source_module": "福利扣款", "result_field": "utilities_deduction", "aggregate_target": "水电费及扣款", "rule_code": "WELFARE_DORMITORY_FEE"},
	{"item_code": "BONUS_OTHER", "item_name": "其他奖金", "category": "奖金补贴", "data_type": "金额", "direction": "应发", "source_module": "已确认月度变量", "result_field": "subsidy_bonus_total", "aggregate_target": "奖金小计"},
	{"item_code": "DEDUCTION_OTHER", "item_name": "其他扣款", "category": "扣款税费", "data_type": "金额", "direction": "应扣", "source_module": "已确认月度变量", "result_field": "punishment_total", "aggregate_target": "惩处小计"},
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


def _text(value):
	if value is None:
		return ""
	if isinstance(value, datetime):
		return value.strftime("%Y-%m-%d %H:%M:%S")
	if isinstance(value, date):
		return value.isoformat()
	return str(value).strip()


def _normalise(value):
	return re.sub(r"\s+", "", _text(value).replace("\n", ""))


def _doctype_exists(doctype):
	return frappe.db.exists("DocType", doctype)


def _doctype_has_field(doctype, fieldname):
	if fieldname == "name":
		return True
	if not _doctype_exists(doctype):
		return False
	return frappe.get_meta(doctype).has_field(fieldname)


def _safe_fields(doctype, fields):
	return [field for field in fields if _doctype_has_field(doctype, field)]


def _safe_count(doctype, filters=None):
	if not _doctype_exists(doctype):
		return 0
	try:
		return frappe.db.count(doctype, filters or {})
	except Exception:
		return 0


def _safe_get_all(doctype, fields=None, filters=None, order_by=None, limit_page_length=50):
	if not _doctype_exists(doctype):
		return []
	fields = _safe_fields(doctype, fields or ["name"])
	return frappe.get_all(
		doctype,
		fields=fields,
		filters=filters or {},
		order_by=order_by,
		limit_page_length=int(limit_page_length or 50),
	)


def _employee_code(row):
	return row.get("employee_number") or row.get("custom_employee_code") or row.get("name") or ""


def _read_rows(sheet, max_rows=None):
	rows = []
	for index, row in enumerate(sheet.iter_rows(values_only=True), start=1):
		values = [_text(value) for value in row]
		if any(values):
			rows.append(values)
		if max_rows and index >= max_rows:
			break
	return rows


def _find_header_index(rows):
	keywords = {"工号", "姓名", "部门", "全勤奖", "住房补贴", "学历补贴", "个人承担", "当月扣款", "金额"}
	best_index = 0
	best_score = -1
	for index, row in enumerate(rows[:20]):
		headers = {_normalise(value) for value in row if value}
		score = len(keywords & headers)
		if score > best_score:
			best_index = index
			best_score = score
	return best_index


def _rows_as_dicts(sheet):
	rows = _read_rows(sheet)
	if not rows:
		return []
	header_index = _find_header_index(rows)
	seen = defaultdict(int)
	headers = []
	for value in rows[header_index]:
		header = _normalise(value)
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


def _first(row, *headers):
	for header in headers:
		value = row.get(_normalise(header))
		if value not in (None, ""):
			return value
	return ""


def _date_or_none(value):
	if not value:
		return None
	if isinstance(value, datetime):
		return value.date().isoformat()
	if isinstance(value, date):
		return value.isoformat()
	text = _text(value)
	if not text:
		return None
	try:
		return getdate(text).isoformat()
	except Exception:
		return None


def _bool_value(value):
	text = _text(value).lower()
	if text in ("1", "true", "yes", "y", "是", "启用", "已启用"):
		return 1
	if text in ("0", "false", "no", "n", "否", "停用", "未启用"):
		return 0
	return 0


def _template_by_sheet(sheet_name):
	for template in PAYROLL_IMPORT_TEMPLATES:
		if template["sheet_name"] == sheet_name:
			return template
	return None


def _find_template_header_index(rows, template):
	required = {_normalise(column) for column in template.get("required_columns", [])}
	best_index = 0
	best_score = -1
	for index, row in enumerate(rows[:20]):
		headers = {_normalise(value) for value in row if value}
		score = len(required & headers)
		if score > best_score:
			best_index = index
			best_score = score
	return best_index


def _template_rows_as_dicts(sheet, template):
	rows = _read_rows(sheet)
	if not rows:
		return []
	header_index = _find_template_header_index(rows, template)
	seen = defaultdict(int)
	headers = []
	for value in rows[header_index]:
		header = _normalise(value)
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


def _amount_for_type(row, variable_type):
	if variable_type == "全勤奖":
		return flt(_first(row, "全勤奖", "金额"))
	if variable_type == "住房补贴":
		return flt(_first(row, "住房补贴", "金额"))
	if variable_type == "学历补贴":
		return flt(_first(row, "学历补贴", "金额"))
	if variable_type == "宿舍扣款":
		return flt(_first(row, "当月扣款", "扣款", "金额"))
	if variable_type == "证书及多能工津贴":
		return flt(_first(row, "证书及多能工津贴", "证书津贴", "多能工津贴", "金额"))
	if variable_type == "继续服务奖":
		return flt(_first(row, "继续服务奖", "金额"))
	if variable_type == "提案改善奖":
		return flt(_first(row, "提案改善奖", "金额"))
	if variable_type == "苹果树":
		return flt(_first(row, "苹果树", "绿苹果", "红苹果", "金额"))
	if variable_type == "其他奖金":
		return flt(_first(row, "金额（元）", "金额", "奖惩金额"))
	if variable_type == "其他扣款":
		return flt(_first(row, "扣款", "金额", "水电费及扣款"))
	if variable_type == "社保个人":
		pension = flt(_first(row, "企业养老8%", "个人养老", "养老个人"))
		unemployment = flt(_first(row, "失业保险约0.5%", "个人失业", "失业个人"))
		medical = flt(_first(row, "基本医疗2%", "个人医疗", "医疗个人"))
		total = flt(_first(row, "个人承担", "个人合计", "金额"))
		return total or pension + unemployment + medical
	return flt(_first(row, "金额"))


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


def _department_lookup(department, company=None):
	"""Resolve a Department link without leaking legacy company suffixes.

	The HR workspace now keeps the business department name as its document ID.
	Older imported records can still contain values such as ``行政科 - 1D``.
	Accept that historical representation only when it resolves inside the same
	company; never fall through to a department belonging to another company.
	"""
	department = (department or "").strip()
	if not department:
		return None
	filters = {"name": department}
	if company:
		filters["company"] = company
	if frappe.db.get_value("Department", filters, "name"):
		return department
	filters = {"department_name": department}
	if company:
		filters["company"] = company
	resolved = frappe.db.get_value("Department", filters, "name")
	if resolved:
		return resolved
	# Pre-normalisation identifiers were stored as “显示名 - 公司缩写”.  Do
	# not remove arbitrary punctuation: only retry the final suffix pattern.
	legacy_display_name = re.sub(r"\s+-\s+[^-]+$", "", department).strip()
	if legacy_display_name and legacy_display_name != department:
		filters = {"department_name": legacy_display_name}
		if company:
			filters["company"] = company
		return frappe.db.get_value("Department", filters, "name")
	return None


def _default_company():
	return frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company") or frappe.db.get_value("Company", {}, "name")


def _ensure_department(department):
	department = (department or "").strip()
	if not department:
		return None
	existing = _department_lookup(department)
	if existing:
		return existing
	company = _default_company()
	if not company:
		return department
	doc = frappe.get_doc({
		"doctype": "Department",
		"department_name": department,
		"company": company,
		"is_group": 0,
	})
	doc.insert(ignore_permissions=True)
	return doc.name


def _matching_sheet(workbook, expected_name):
	expected = (expected_name or "").strip()
	for sheet_name in workbook.sheetnames:
		actual = sheet_name.strip()
		if actual == expected or (expected and expected in actual):
			return workbook[sheet_name]
	return None


def _can_manage_payroll_rules():
	roles = set(frappe.get_roles(frappe.session.user))
	return bool({"System Manager", "HR Manager"} & roles)


def _require_payroll_master_manager():
	if not _can_manage_payroll_rules():
		frappe.throw(_("仅系统管理员或人事管理员可以维护薪资架构和员工定薪。"))


def _default_rule(rule_code):
	return next((rule for rule in DEFAULT_PAYROLL_RULES if rule["rule_code"] == rule_code), {})


def _rule_parameters(value):
	if isinstance(value, dict):
		return dict(value)
	if not value:
		return {}
	try:
		decoded = json.loads(value)
	except (TypeError, ValueError) as exc:
		frappe.throw(_("薪资规则参数 JSON 格式错误：{0}").format(exc))
	if not isinstance(decoded, dict):
		frappe.throw(_("薪资规则参数必须是 JSON 对象。"))
	return decoded


def _rule_parameter_errors(rule_code, parameters):
	if rule_code not in EXECUTABLE_PAYROLL_RULES:
		return []
	errors = []
	for key in EXECUTABLE_PAYROLL_RULES[rule_code]["parameters"]:
		if key not in parameters:
			errors.append(f"缺少参数 {key}")
	for key in ("standard_hours_divisor", "weekday", "weekend", "holiday", "large_night_shift", "small_night_shift"):
		if key in parameters and flt(parameters[key]) <= 0:
			errors.append(f"参数 {key} 必须大于 0")
	if "thresholds" in parameters:
		thresholds = parameters["thresholds"]
		if not isinstance(thresholds, list) or not thresholds:
			errors.append("参数 thresholds 必须是非空数组")
		else:
			for item in thresholds:
				if not isinstance(item, (list, tuple)) or len(item) != 2:
					errors.append("thresholds 每项必须为 [缺勤上限, 全勤奖金额]")
					break
	if "ranges" in parameters and not isinstance(parameters["ranges"], list):
		errors.append("参数 ranges 必须是数组")
	return errors


def _rule_is_effective(rule, payroll_month):
	if not payroll_month:
		return True
	month_end = getdate(_month_end(payroll_month))
	if rule.effective_from and getdate(rule.effective_from) > month_end:
		return False
	if rule.effective_to and getdate(rule.effective_to) < month_end:
		return False
	return True


def _effective_rule_config(rule_code, payroll_month="", company=""):
	"""Return one validated executable rule and its immutable calculation snapshot."""
	company = _require_company(company)
	default = _default_rule(rule_code)
	if not default:
		frappe.throw(_("未注册的薪资执行规则：{0}").format(rule_code))
	default_parameters = _rule_parameters(default.get("parameters_json"))
	rule_name = frappe.db.get_value(PAYROLL_RULE_DOCTYPE, {"company": company, "rule_code": rule_code}, "name")
	if not rule_name:
		# Temporary compatibility for rules created before company isolation. New
		# writes are always company-scoped and never update this legacy fallback.
		rule_name = frappe.db.get_value(PAYROLL_RULE_DOCTYPE, {"company": ["is", "not set"], "rule_code": rule_code}, "name")
	if not rule_name:
		return {
			"rule_code": rule_code,
			"rule_name": default.get("rule_name"),
			"formula_expression": default.get("formula_expression"),
			"parameters": default_parameters,
			"source": f"{company} / 内置默认规则",
		}
	rule = frappe.get_doc(PAYROLL_RULE_DOCTYPE, rule_name)
	if rule.status != "已启用":
		frappe.throw(_("执行规则 {0} 当前不是已启用状态，不能生成薪资结算。").format(rule_code))
	if not _rule_is_effective(rule, payroll_month):
		frappe.throw(_("执行规则 {0} 不在薪资月份 {1} 的生效区间内。").format(rule_code, payroll_month))
	parameters = {**default_parameters, **_rule_parameters(rule.parameters_json)}
	errors = _rule_parameter_errors(rule_code, parameters)
	if errors:
		frappe.throw(_("执行规则 {0} 参数无效：{1}").format(rule_code, "；".join(errors)))
	return {
		"name": rule.name,
		"rule_code": rule_code,
		"rule_name": rule.rule_name,
		"formula_expression": rule.formula_expression or default.get("formula_expression"),
		"parameters": parameters,
		"company": company,
		"source": f"{company} / 规则中心" if rule.company else "历史全局规则（待迁移）",
	}


def _payroll_calculation_rules(company, payroll_month):
	return {
		rule_code: _effective_rule_config(rule_code, payroll_month, company)
		for rule_code in EXECUTABLE_PAYROLL_RULES
	}


def _formula_rule_code(output_field):
	return f"FORMULA_{str(output_field or '').upper()}"


def _effective_payroll_formulas(company, payroll_month=""):
	"""Return the ordered built-in formula set with company overrides applied."""
	company = _require_company(company)
	rows = frappe.get_all(
		PAYROLL_RULE_DOCTYPE,
		filters={"company": company, "rule_code": ["like", "FORMULA_%"], "status": "已启用"},
		fields=["name", "rule_code", "output_field", "formula_expression", "formula_version", "effective_from", "effective_to", "modified"],
		order_by="modified desc",
		limit_page_length=500,
	)
	overrides = {}
	for row in rows:
		if not row.output_field or row.output_field in overrides or not _rule_is_effective(row, payroll_month):
			continue
		overrides[row.output_field] = row
	formulas = []
	for index, template in enumerate(FORMULA_TEMPLATES, start=1):
		formula = dict(template)
		formula["order"] = index
		formula["version"] = 1
		formula["source"] = f"{company} / 内置公式模板"
		override = overrides.get(template["output_field"])
		if override:
			formula.update(
				{
					"expression": override.formula_expression,
					"version": int(override.formula_version or 1),
					"source": f"{company} / {override.name}",
					"rule_name": override.name,
				}
			)
		compile_formula(formula["expression"])
		formulas.append(formula)
	return formulas


def _formula_catalog_row(formula, company, order):
	field = FIELD_BY_NAME[formula["output_field"]]
	_, dependencies = compile_formula(formula["expression"])
	return {
		**formula,
		"company": company,
		"order": order,
		"rule_code": _formula_rule_code(formula["output_field"]),
		"output_label": field["label"],
		"dependencies": [FIELD_BY_NAME[name]["label"] for name in dependencies],
		"status": "已启用",
	}


@frappe.whitelist()
def get_payroll_formula_catalog(company: str, payroll_month: str = ""):
	company = _require_company(company)
	formulas = _effective_payroll_formulas(company, payroll_month)
	return {
		"company": company,
		"payroll_month": payroll_month,
		"fields": FIELD_DEFINITIONS,
		"functions": FUNCTIONS,
		"formulas": [_formula_catalog_row(formula, company, index) for index, formula in enumerate(formulas, start=1)],
		"groups": ["薪资字段", "考勤字段", "月度变量", "计算结果"],
	}


@frappe.whitelist()
def validate_payroll_formula(company: str, output_field: str, expression: str, sample_values: str = ""):
	company = _require_company(company)
	if output_field not in FIELD_BY_NAME or FIELD_BY_NAME[output_field]["group"] != "计算结果":
		frappe.throw(_("请选择系统允许的计算结果项目"))
	try:
		_, dependencies = compile_formula(expression)
		if output_field in dependencies:
			raise FormulaError("结果项目不能引用自身")
		if isinstance(sample_values, str):
			sample_values = json.loads(sample_values or "{}")
		value, _ = evaluate_formula(expression, sample_values or {})
	except (FormulaError, ValueError, TypeError) as exc:
		return {"valid": 0, "message": str(exc), "result": None, "dependencies": []}
	return {
		"valid": 1,
		"message": "公式校验通过，可参与薪资试算",
		"result": _money(value),
		"dependencies": [{"fieldname": name, "label": FIELD_BY_NAME[name]["label"]} for name in dependencies],
	}


@frappe.whitelist()
def upsert_payroll_formula(**kwargs: object):
	if not _can_manage_payroll_rules():
		frappe.throw(_("您没有维护薪资公式的权限"))
	data = dict(kwargs)
	company = _require_company(data.get("company"))
	output_field = data.get("output_field")
	expression = data.get("formula_expression") or data.get("expression")
	validation = validate_payroll_formula(company, output_field, expression)
	if not validation.get("valid"):
		frappe.throw(_("公式无效：{0}").format(validation.get("message")))
	field = FIELD_BY_NAME[output_field]
	rule_code = _formula_rule_code(output_field)
	name = frappe.db.get_value(PAYROLL_RULE_DOCTYPE, {"company": company, "rule_code": rule_code}, "name")
	current_version = int(frappe.db.get_value(PAYROLL_RULE_DOCTYPE, name, "formula_version") or 0) if name else 0
	values = {
		"company": company,
		"rule_code": rule_code,
		"rule_name": field["label"],
		"rule_category": data.get("rule_category") or "薪资结算",
		"rule_scope": data.get("rule_scope") or "薪资结算表",
		"status": data.get("status") or "已启用",
		"editable": 1,
		"effective_from": data.get("effective_from"),
		"effective_to": data.get("effective_to"),
		"calculation_mode": "公式",
		"output_field": output_field,
		"formula_expression": expression,
		"formula_version": current_version + 1,
		"parameters_json": "{}",
		"rule_text": data.get("rule_text") or data.get("description"),
		"source_file": data.get("source_file") or "公司薪资公式模板",
		"source_sheet": data.get("source_sheet"),
		"source_cell": data.get("source_cell"),
		"last_reviewed_by": frappe.session.user,
		"last_reviewed_on": now_datetime(),
	}
	if name:
		doc = frappe.get_doc(PAYROLL_RULE_DOCTYPE, name)
		if doc.company != company:
			frappe.throw(_("不能跨公司修改薪资公式"))
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": PAYROLL_RULE_DOCTYPE, **values})
		doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return {"name": doc.name, "formula_version": doc.formula_version, "validation": validation}


@frappe.whitelist()
def ensure_default_payroll_formulas(company: str, force: int = 0):
	if not _can_manage_payroll_rules():
		frappe.throw(_("您没有维护薪资公式的权限"))
	company = _require_company(company)
	created, updated = 0, 0
	for template in FORMULA_TEMPLATES:
		name = frappe.db.get_value(PAYROLL_RULE_DOCTYPE, {"company": company, "rule_code": _formula_rule_code(template["output_field"])}, "name")
		if name and not flt(force):
			continue
		upsert_payroll_formula(
			company=company,
			output_field=template["output_field"],
			formula_expression=template["expression"],
			rule_category="薪资结算",
			description=template["description"],
			source_file="5.2人资考勤.xlsx",
			source_sheet="薪资结算表",
		)
		updated += 1 if name else 0
		created += 0 if name else 1
	return {"company": company, "created": created, "updated": updated}


@frappe.whitelist()
def create_payroll_formula_template_file(company: str):
	from openpyxl import Workbook
	from openpyxl.styles import Alignment, Font, PatternFill
	from frappe.utils.file_manager import save_file

	company = _require_company(company)
	workbook = Workbook()
	sheet = workbook.active
	sheet.title = "计薪公式"
	headers = ["结果项目", "计算公式", "规则说明", "适用范围", "生效开始", "生效结束", "状态"]
	sheet.append(headers)
	for formula in _effective_payroll_formulas(company):
		sheet.append([FIELD_BY_NAME[formula["output_field"]]["label"], formula["expression"], formula.get("description"), "薪资结算表", "", "", "已启用"])
	fill = PatternFill("solid", fgColor="D9EAF7")
	for cell in sheet[1]:
		cell.fill = fill
		cell.font = Font(bold=True)
		cell.alignment = Alignment(horizontal="center")
	for index, width in enumerate([24, 92, 56, 22, 16, 16, 12], start=1):
		sheet.column_dimensions[sheet.cell(1, index).column_letter].width = width
	fields = workbook.create_sheet("可用字段")
	fields.append(["分组", "显示名称", "系统字段", "唯一来源", "公式写法"])
	for item in FIELD_DEFINITIONS:
		fields.append([item["group"], item["label"], item["fieldname"], item["source"], f'[{item["label"]}]'])
	for cell in fields[1]:
		cell.fill = fill
		cell.font = Font(bold=True)
	functions = workbook.create_sheet("可用函数")
	functions.append(["函数", "用途", "写法"])
	for item in FUNCTIONS:
		functions.append([item["name"], item["label"], item["signature"]])
	for cell in functions[1]:
		cell.fill = fill
		cell.font = Font(bold=True)
	output = BytesIO()
	workbook.save(output)
	file_doc = save_file(f"{company}-计薪公式导入模板-{datetime.today().strftime('%Y%m%d%H%M%S')}.xlsx", output.getvalue(), None, None, is_private=1)
	return {"file_url": file_doc.file_url, "file_name": file_doc.file_name}


def _formula_workbook_rows(file_url):
	workbook = _load_workbook(file_url)
	sheet = _matching_sheet(workbook, "计薪公式")
	if not sheet:
		frappe.throw(_("未找到“计薪公式”工作表"))
	rows = list(sheet.iter_rows(values_only=True))
	if not rows:
		return []
	headers = [_text(value) for value in rows[0]]
	result = []
	for values in rows[1:]:
		row = {headers[index]: _text(value) for index, value in enumerate(values) if index < len(headers) and headers[index]}
		if row.get("结果项目") or row.get("计算公式"):
			result.append(row)
	return result


@frappe.whitelist()
def preview_payroll_formula_workbook(file_url: str, company: str):
	company = _require_company(company)
	rows = []
	for row in _formula_workbook_rows(file_url):
		field = next((item for item in FIELD_DEFINITIONS if item["label"] == row.get("结果项目") and item["group"] == "计算结果"), None)
		validation = validate_payroll_formula(company, field["fieldname"] if field else "", row.get("计算公式"))
		rows.append({**row, "output_field": field["fieldname"] if field else "", **validation})
	return {"company": company, "row_count": len(rows), "valid_count": sum(1 for row in rows if row.get("valid")), "rows": rows}


@frappe.whitelist()
def import_payroll_formula_workbook(file_url: str, company: str):
	if not _can_manage_payroll_rules():
		frappe.throw(_("您没有导入薪资公式的权限"))
	preview = preview_payroll_formula_workbook(file_url, company)
	invalid = [row for row in preview["rows"] if not row.get("valid")]
	if invalid:
		frappe.throw(_("公式导入存在 {0} 行错误，请先修正预览结果。首个错误：{1}").format(len(invalid), invalid[0].get("message")))
	for row in preview["rows"]:
		upsert_payroll_formula(
			company=company,
			output_field=row["output_field"],
			formula_expression=row.get("计算公式"),
			description=row.get("规则说明"),
			rule_scope=row.get("适用范围"),
			effective_from=row.get("生效开始"),
			effective_to=row.get("生效结束"),
			status=row.get("状态") or "已启用",
			source_file=file_url,
			source_sheet="计薪公式",
		)
	return {"imported": len(preview["rows"]), "company": company}


def _rule_number(rule, key, fallback=0):
	return flt((rule or {}).get("parameters", {}).get(key, fallback)) or flt(fallback)


def _full_attendance_bonus(attendance, rule):
	"""Apply the confirmed threshold table unless a monthly variable overrides it."""
	parameters = rule.get("parameters", {})
	absence_basis = max(
		flt(getattr(attendance, "standard_hours", 0))
		- flt(getattr(attendance, "actual_attendance_hours", 0))
		- flt(getattr(attendance, "rest_leave_hours", 0))
		+ flt(getattr(attendance, "sick_leave_hours", 0)) * 0.5,
		0,
	)
	thresholds = sorted(parameters.get("thresholds") or [], key=lambda item: flt(item[0]))
	for maximum, amount in thresholds:
		if absence_basis <= flt(maximum):
			return flt(amount), absence_basis
	return 0, absence_basis


def _company_social_security_from_rule(personal_amount, rule):
	amount = flt(personal_amount)
	if amount <= 0:
		return 0
	ranges = list((rule or {}).get("parameters", {}).get("ranges") or [])
	# Existing data uses [minimum, maximum, company_amount]. Resolve exact and
	# narrow ranges before broad historical fallback ranges.
	def width(item):
		if not isinstance(item, (list, tuple)) or len(item) < 3:
			return float("inf")
		lower, upper = item[0], item[1]
		if upper in (None, ""):
			return float("inf")
		return max(flt(upper) - flt(lower), 0)
	for item in sorted(ranges, key=width):
		if not isinstance(item, (list, tuple)) or len(item) < 3:
			continue
		lower, upper, company_amount = item[0], item[1], item[2]
		if amount >= flt(lower) and (upper in (None, "") or amount <= flt(upper)):
			return flt(company_amount)
	return 0


def _rule_doc_values(rule, company):
	values = dict(rule)
	values["company"] = _require_company(company)
	values["parameters_json"] = json.dumps(values.get("parameters_json") or {}, ensure_ascii=False, default=str)
	values.setdefault("status", "已启用")
	values.setdefault("editable", 1)
	values.setdefault("last_reviewed_by", frappe.session.user)
	values.setdefault("last_reviewed_on", now_datetime())
	return values


@frappe.whitelist()
def can_edit_payroll_rules():
	return _can_manage_payroll_rules()


@frappe.whitelist()
def ensure_default_payroll_rules(company: str, force: int = 0):
	if not _can_manage_payroll_rules():
		frappe.throw(_("您没有维护薪资规则的权限"))
	company = _require_company(company)
	created = []
	updated = []
	for rule in DEFAULT_PAYROLL_RULES:
		existing = frappe.db.get_value(PAYROLL_RULE_DOCTYPE, {"company": company, "rule_code": rule["rule_code"]}, "name")
		values = _rule_doc_values(rule, company)
		if existing:
			if not flt(force):
				continue
			doc = frappe.get_doc(PAYROLL_RULE_DOCTYPE, existing)
			doc.update(values)
			doc.save(ignore_permissions=True)
			updated.append(doc.name)
			continue
		doc = frappe.get_doc({"doctype": PAYROLL_RULE_DOCTYPE, **values})
		doc.insert(ignore_permissions=True)
		created.append(doc.name)
	frappe.db.commit()
	return {"company": company, "created": len(created), "updated": len(updated)}


@frappe.whitelist()
def list_payroll_rules(company: str, rule_category: str = "", status: str = "", page_length: int = 200):
	company = _require_company(company)
	filters = {"company": company}
	if rule_category:
		filters["rule_category"] = rule_category
	if status:
		filters["status"] = status
	rows = frappe.get_all(
		PAYROLL_RULE_DOCTYPE,
		filters=filters,
		fields=["*"],
		order_by="rule_category asc, rule_code asc",
		limit_page_length=int(page_length or 200),
	)
	persisted_codes = {row.rule_code for row in rows}
	for default in DEFAULT_PAYROLL_RULES:
		if default["rule_code"] in persisted_codes:
			continue
		rows.append(frappe._dict({**_rule_doc_values(default, company), "rule_origin": "内置默认（未保存）"}))
	for row in rows:
		row["rule_origin"] = row.get("rule_origin") or "公司规则"
		try:
			parameters = _rule_parameters(row.parameters_json)
			errors = _rule_parameter_errors(row.rule_code, parameters)
		except Exception as exc:
			parameters, errors = {}, [str(exc)]
		if row.rule_code in EXECUTABLE_PAYROLL_RULES:
			row["execution_mode"] = "参数化公式"
			row["execution_status"] = "参数有效，可参与结算" if row.status == "已启用" and not errors else ("参数无效：" + "；".join(errors) if errors else "不参与结算")
		elif row.rule_code in FIXED_PAYROLL_CALCULATION_RULES:
			row["execution_mode"] = "固定计算器公式"
			row["execution_status"] = "由结算计算器执行，结构变更需受控发布"
		else:
			row["execution_mode"] = "来源/说明规则"
			row["execution_status"] = "作为导入、确认或审计依据，不直接计算"
		row["parameters"] = parameters
	return sorted(rows, key=lambda row: (row.get("rule_category") or "", row.get("rule_code") or ""))


@frappe.whitelist()
def validate_payroll_rule_execution(company: str, payroll_month: str = ""):
	"""Expose which formula drivers will be used by a monthly calculation."""
	company = _require_company(company)
	results = []
	for rule_code in EXECUTABLE_PAYROLL_RULES:
		try:
			config = _effective_rule_config(rule_code, payroll_month, company)
			results.append({**config, "valid": 1, "message": "参数有效，可参与结算"})
		except Exception as exc:
			results.append({"rule_code": rule_code, "valid": 0, "message": str(exc)})
	return {"company": company, "payroll_month": payroll_month, "rules": results, "valid": all(row["valid"] for row in results)}


@frappe.whitelist()
def upsert_payroll_rule(**kwargs):
	if not _can_manage_payroll_rules():
		frappe.throw(_("您没有维护薪资规则的权限"))
	data = dict(kwargs)
	company = _require_company(data.get("company"))
	if not data.get("rule_code"):
		frappe.throw(_("请填写规则编码"))
	if not data.get("rule_name"):
		frappe.throw(_("请填写规则名称"))
	parameters = _rule_parameters(data.get("parameters_json") or "{}")
	errors = _rule_parameter_errors(data["rule_code"], parameters)
	if errors:
		frappe.throw(_("规则参数无效：{0}").format("；".join(errors)))
	values = {
		"doctype": PAYROLL_RULE_DOCTYPE,
		"company": company,
		"rule_code": data.get("rule_code"),
		"rule_name": data.get("rule_name"),
		"rule_category": data.get("rule_category") or "其他",
		"rule_scope": data.get("rule_scope"),
		"status": data.get("status") or "已启用",
		"editable": flt(data.get("editable", 1)),
		"effective_from": data.get("effective_from"),
		"effective_to": data.get("effective_to"),
		"formula_expression": data.get("formula_expression"),
		"parameters_json": json.dumps(parameters, ensure_ascii=False, sort_keys=True),
		"rule_text": data.get("rule_text"),
		"source_file": data.get("source_file"),
		"source_sheet": data.get("source_sheet"),
		"source_cell": data.get("source_cell"),
		"missing_rule_note": data.get("missing_rule_note"),
		"last_reviewed_by": frappe.session.user,
		"last_reviewed_on": now_datetime(),
	}
	name = data.get("name") or frappe.db.get_value(PAYROLL_RULE_DOCTYPE, {"company": company, "rule_code": values["rule_code"]}, "name")
	if name:
		doc = frappe.get_doc(PAYROLL_RULE_DOCTYPE, name)
		if doc.company and doc.company != company:
			frappe.throw(_("不能跨公司修改薪资规则"))
		if not flt(doc.editable):
			frappe.throw(_("该薪资规则不允许修改"))
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc(values)
		doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return doc.name


def _field_mapping_values(mapping):
	values = {
		"doctype": PAYROLL_FIELD_MAPPING_DOCTYPE,
		"display_order": mapping.get("display_order"),
		"mapping_code": mapping.get("mapping_code"),
		"excel_column": mapping.get("excel_column"),
		"excel_label": mapping.get("excel_label"),
		"system_doctype": mapping.get("system_doctype") or PAYROLL_SETTLEMENT_DOCTYPE,
		"system_field": mapping.get("system_field"),
		"source_module": mapping.get("source_module"),
		"source_detail": mapping.get("source_detail"),
		"formula_expression": mapping.get("formula_expression"),
		"rule_code": mapping.get("rule_code"),
		"required_for_settlement": flt(mapping.get("required_for_settlement", 1)),
		"status": mapping.get("status") or "已启用",
		"remarks": mapping.get("remarks"),
	}
	return values


@frappe.whitelist()
def ensure_default_payroll_field_mappings(force: int = 0):
	if not _can_manage_payroll_rules():
		frappe.throw(_("您没有维护薪资字段映射的权限"))
	created = []
	updated = []
	for mapping in PAYROLL_SETTLEMENT_FIELD_MAPPINGS:
		existing = frappe.db.get_value(PAYROLL_FIELD_MAPPING_DOCTYPE, {"mapping_code": mapping["mapping_code"]}, "name")
		values = _field_mapping_values(mapping)
		if existing:
			if not flt(force):
				continue
			doc = frappe.get_doc(PAYROLL_FIELD_MAPPING_DOCTYPE, existing)
			doc.update(values)
			doc.save(ignore_permissions=True)
			updated.append(doc.name)
			continue
		doc = frappe.get_doc(values)
		doc.insert(ignore_permissions=True)
		created.append(doc.name)
	frappe.db.commit()
	return {"created": len(created), "updated": len(updated)}


@frappe.whitelist()
def list_payroll_field_mappings(status: str = "", page_length: int = 200):
	filters = {}
	if status:
		filters["status"] = status
	return frappe.get_all(
		PAYROLL_FIELD_MAPPING_DOCTYPE,
		filters=filters,
		fields=["*"],
		order_by="display_order asc, excel_column asc",
		limit_page_length=int(page_length or 200),
	)


def _payroll_configuration_category(mapping):
	order = int(mapping.get("display_order") or 0)
	if order <= 4:
		return "员工资料"
	if order <= 8:
		return "固定薪资"
	if order <= 25:
		return "考勤结算"
	if order <= 30:
		return "奖金补贴"
	if order <= 34:
		return "扣款税费"
	if order <= 45:
		return "应付与实发"
	if order <= 48:
		return "公司成本"
	return "导出辅助"


def _payroll_configuration_data_type(fieldname, label):
	value = f"{fieldname or ''} {label or ''}".lower()
	if "hours" in value or "工时" in value or "时数" in value:
		return "工时"
	if "count" in value or "次数" in value:
		return "次数"
	if fieldname in ("department", "employee_code", "employee_name"):
		return "文本"
	return "金额"


@frappe.whitelist()
def list_payroll_configuration_items(company: str):
	"""Return the configurable salary-item catalogue used by the setup guide.

	The catalogue exposes every effective settlement field plus atomic options
	that are combined in the legacy Excel layout.  It does not create a second
	calculation engine: each option points to an existing controlled rule,
	monthly source type or settlement mapping.
	"""
	company = _require_company(company)
	persisted_mappings = {
		row.mapping_code: row
		for row in frappe.get_all(PAYROLL_FIELD_MAPPING_DOCTYPE, fields=["*"], limit_page_length=500)
	}
	persisted_rules = {
		row.rule_code: row
		for row in frappe.get_all(
			PAYROLL_RULE_DOCTYPE,
			filters={"company": company},
			fields=["name", "rule_code", "rule_name", "status", "editable"],
			limit_page_length=500,
		)
	}
	items = []
	for default_mapping in PAYROLL_SETTLEMENT_FIELD_MAPPINGS:
		if default_mapping.get("source_module") == "导出辅助":
			continue
		mapping = dict(default_mapping)
		if default_mapping["mapping_code"] in persisted_mappings:
			mapping.update(dict(persisted_mappings[default_mapping["mapping_code"]]))
		rule_code = mapping.get("rule_code") or ""
		rule = persisted_rules.get(rule_code)
		if rule_code in EXECUTABLE_PAYROLL_RULES:
			calculation_mode = "参数化规则"
		elif mapping.get("formula_expression"):
			calculation_mode = "固定计算器"
		else:
			calculation_mode = "来源字段"
		items.append(
			{
				"item_code": mapping.get("mapping_code"),
				"item_name": mapping.get("excel_label"),
				"category": _payroll_configuration_category(mapping),
				"data_type": _payroll_configuration_data_type(mapping.get("system_field"), mapping.get("excel_label")),
				"direction": "参考" if int(mapping.get("display_order") or 0) <= 4 else ("公司承担" if int(mapping.get("display_order") or 0) >= 46 else "参与结算"),
				"source_module": mapping.get("source_module") or "未设置",
				"result_field": mapping.get("system_field") or "",
				"aggregate_target": "",
				"mapping_code": mapping.get("mapping_code"),
				"rule_code": rule_code,
				"calculation_mode": calculation_mode,
				"configuration_status": "已映射" if mapping.get("system_field") else "待映射",
				"rule_status": rule.status if rule else ("使用内置规则" if rule_code else "无需规则"),
			}
		)
	for atomic in PAYROLL_ATOMIC_CONFIGURATION_ITEMS:
		item = dict(atomic)
		rule_code = item.get("rule_code") or ""
		rule = persisted_rules.get(rule_code)
		item.update(
			{
				"mapping_code": "",
				"calculation_mode": "参数化规则" if rule_code in EXECUTABLE_PAYROLL_RULES else "月度来源汇总",
				"configuration_status": "已连接汇总字段" if item.get("result_field") else "待映射",
				"rule_status": rule.status if rule else ("使用内置规则" if rule_code else "来源确认后参与"),
			}
		)
		items.append(item)
	category_order = ["员工资料", "固定薪资", "考勤结算", "奖金补贴", "扣款税费", "应付与实发", "公司成本"]
	items.sort(key=lambda row: (category_order.index(row["category"]) if row["category"] in category_order else 99, row["item_name"] or ""))
	return {
		"company": company,
		"categories": category_order,
		"items": items,
		"summary": {
			"item_count": len(items),
			"mapped_count": sum(1 for row in items if row["configuration_status"] != "待映射"),
			"rule_count": len({row.get("rule_code") for row in items if row.get("rule_code")}),
		},
	}


@frappe.whitelist()
def upsert_payroll_field_mapping(**kwargs):
	if not _can_manage_payroll_rules():
		frappe.throw(_("您没有维护薪资字段映射的权限"))
	data = dict(kwargs)
	if not data.get("mapping_code"):
		frappe.throw(_("请填写映射编码"))
	if not data.get("excel_column") or not data.get("excel_label"):
		frappe.throw(_("请填写 Excel 列和字段名"))
	values = _field_mapping_values(data)
	name = data.get("name") or frappe.db.get_value(PAYROLL_FIELD_MAPPING_DOCTYPE, {"mapping_code": values["mapping_code"]}, "name")
	if name:
		doc = frappe.get_doc(PAYROLL_FIELD_MAPPING_DOCTYPE, name)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc(values)
		doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return doc.name


def _month_end(payroll_month):
	match = re.match(r"^(\d{4})-(\d{2})$", payroll_month or "")
	if not match:
		return None
	year, month = [int(value) for value in match.groups()]
	return f"{year:04d}-{month:02d}-{monthrange(year, month)[1]:02d}"


def _require_company(company):
	company = (company or "").strip()
	if not company:
		frappe.throw(_("薪资试算必须传入公司，不允许按月份全局读取或删除。"))
	if not frappe.db.exists("Company", company):
		frappe.throw(_("公司 {0} 不存在").format(company))
	return company


def _require_payroll_scope(company, payroll_month, attendance_lock_version=""):
	company = _require_company(company)
	payroll_month = (payroll_month or "").strip()
	if not re.match(r"^\d{4}-\d{2}$", payroll_month):
		frappe.throw(_("薪资月份必须为 YYYY-MM"))
	attendance_lock_version = (attendance_lock_version or "").strip()
	if not attendance_lock_version:
		frappe.throw(_("薪资试算必须传入考勤锁定版本。"))
	return company, payroll_month, attendance_lock_version


@frappe.whitelist()
def list_available_payroll_attendance_locks(company: str, payroll_month: str):
	"""List only immutable attendance versions that payroll may consume.

	A reopened attendance month creates a new version.  Older locked summaries
	remain available for audit/reconciliation, while the current version is
	marked for the UI to select by default.  Draft and cross-company summaries
	are deliberately excluded.
	"""
	company = _require_company(company)
	payroll_month = (payroll_month or "").strip()
	if not re.match(r"^\d{4}-\d{2}$", payroll_month):
		frappe.throw(_("薪资月份必须为 YYYY-MM"))

	rows = frappe.get_all(
		MONTHLY_ATTENDANCE_DOCTYPE,
		filters={"company": company, "attendance_month": payroll_month, "lock_status": "已锁定"},
		fields=["attendance_lock_version", "locked_on"],
		limit_page_length=100000,
	)
	by_version = {}
	for row in rows:
		version = str(row.get("attendance_lock_version") or "").strip()
		if not version:
			continue
		item = by_version.setdefault(version, {"attendance_lock_version": version, "summary_count": 0, "locked_on": None})
		item["summary_count"] += 1
		if row.get("locked_on") and (not item["locked_on"] or row.get("locked_on") > item["locked_on"]):
			item["locked_on"] = row.get("locked_on")

	month_lock = frappe.db.get_value(
		"HRMS Attendance Month Lock",
		{"company": company, "attendance_month": payroll_month, "status": "已锁定"},
		["name", "active_version", "locked_on"],
		as_dict=True,
	)
	active_version = str((month_lock or {}).get("active_version") or "")

	def version_sort_key(item):
		value = item["attendance_lock_version"]
		return (0, int(value)) if value.isdigit() else (1, value)

	locks = []
	for item in sorted(by_version.values(), key=version_sort_key, reverse=True):
		item["is_current"] = bool(month_lock and item["attendance_lock_version"] == active_version)
		item["month_lock"] = (month_lock or {}).get("name") or ""
		item["status"] = "当前已锁定版本" if item["is_current"] else "历史已锁定版本"
		locks.append(item)
	return {"company": company, "payroll_month": payroll_month, "locks": locks}


def _payroll_scope_filters(company, payroll_month, attendance_lock_version=""):
	filters = {"company": _require_company(company), "payroll_month": payroll_month}
	if attendance_lock_version:
		filters["attendance_lock_version"] = attendance_lock_version
	return filters


def _attendance_scope_filters(company, attendance_month, attendance_lock_version):
	return {
		"company": _require_company(company),
		"attendance_month": attendance_month,
		"attendance_lock_version": attendance_lock_version,
		"lock_status": "已锁定",
	}


def _employee_identity_key(row):
	return getattr(row, "employee", None) or getattr(row, "employee_code", None) or getattr(row, "employee_name", None)


def _assert_row_company(row, company, source_label):
	row_company = getattr(row, "company", None)
	if row_company and row_company != company:
		frappe.throw(_("{0} 存在跨公司数据：{1} 不属于 {2}").format(source_label, row_company, company))


def _source_trace_hash(trace):
	payload = json.dumps(trace, ensure_ascii=False, sort_keys=True, default=str)
	return payload, hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _salary_structure_sheet(workbook):
	return _matching_sheet(workbook, "薪资架构")


def _row_value(row, index):
	return row[index] if index < len(row) else ""


def _parse_salary_grade_rows(sheet):
	rows = _read_rows(sheet)
	grades = []
	current_section = ""
	current_job_family = ""
	header_start = None
	post_headers = []
	for raw in rows:
		normalised = [_normalise(value) for value in raw]
		joined = "".join(normalised)
		if any(marker in joined for marker in ("生产类直接人员", "生产类间接人员", "间接人员", "专业技术类", "管理类", "职员类")):
			current_section = next((_text(value) for value in raw if _text(value)), joined)
			current_job_family = ""
			continue
		if "岗性" in normalised and "岗级" in normalised:
			header_start = normalised.index("岗性")
			post_headers = [_text(value) for value in raw[header_start + 7 : header_start + 14] if _text(value)]
			continue
		if header_start is None:
			continue
		family = _text(_row_value(raw, header_start))
		if family:
			current_job_family = family
		grade_number = _text(_row_value(raw, header_start + 1))
		if not grade_number:
			continue
		if not current_job_family and not any(flt(_row_value(raw, index)) for index in range(header_start + 2, min(len(raw), header_start + 7))):
			continue
		base_salary = flt(_row_value(raw, header_start + 2))
		function_allowance = flt(_row_value(raw, header_start + 3))
		full_salary = flt(_row_value(raw, header_start + 4)) or base_salary + function_allowance
		job_grade = f"{current_job_family}-{grade_number}" if current_job_family else grade_number
		education_allowance = max([flt(value) for value in raw[header_start + 15 : header_start + 19]] or [0])
		grades.append(
			{
				"job_nature": current_section,
				"job_grade": job_grade,
				"post_category": "、".join(post_headers),
				"base_salary": base_salary,
				"function_allowance": function_allowance,
				"full_salary": full_salary,
				"grade_difference": flt(_row_value(raw, header_start + 5)),
				"grade_difference_ratio": flt(_row_value(raw, header_start + 6)),
				"education_allowance": education_allowance,
				"multi_skill_allowance": flt(_row_value(raw, header_start + 19)),
				"full_attendance_bonus_standard": flt(_row_value(raw, header_start + 20)),
				"rental_subsidy_standard": flt(_row_value(raw, header_start + 21)),
				"large_night_shift_allowance": flt(_row_value(raw, header_start + 22)) or 45,
				"small_night_shift_allowance": 24,
				"certificate_allowance": flt(_row_value(raw, header_start + 23)),
				"raw_row_json": json.dumps(raw, ensure_ascii=False, default=str),
			}
		)
	return grades


@frappe.whitelist()
def preview_salary_structure_workbook(file_url: str):
	workbook = _load_workbook(file_url)
	sheet = _salary_structure_sheet(workbook)
	if not sheet:
		return {"found": False, "sheet_name": "薪资架构", "row_count": 0, "grade_rows": 0, "sample_grades": []}
	grades = _parse_salary_grade_rows(sheet)
	return {
		"found": True,
		"sheet_name": sheet.title,
		"row_count": len(_read_rows(sheet)),
		"grade_rows": len(grades),
		"sample_grades": grades[:10],
	}


@frappe.whitelist()
def import_salary_structure_workbook(file_url: str, structure_version: str, effective_from: str, effective_to: str = ""):
	_require_payroll_master_manager()
	if not structure_version:
		frappe.throw(_("请填写薪资架构版本"))
	if not effective_from:
		frappe.throw(_("请填写生效开始日期"))
	workbook = _load_workbook(file_url)
	sheet = _salary_structure_sheet(workbook)
	if not sheet:
		frappe.throw(_("未找到薪资架构工作表"))
	grades = _parse_salary_grade_rows(sheet)
	if not grades:
		frappe.throw(_("薪资架构工作表未识别到薪资档位"))

	version_name = frappe.db.get_value(SALARY_STRUCTURE_VERSION_DOCTYPE, {"structure_version": structure_version}, "name")
	if version_name:
		version = frappe.get_doc(SALARY_STRUCTURE_VERSION_DOCTYPE, version_name)
		version.effective_from = effective_from
		version.effective_to = effective_to
		version.source_file = file_url
		version.status = "已启用"
		version.save(ignore_permissions=True)
	else:
		version = frappe.get_doc(
			{
				"doctype": SALARY_STRUCTURE_VERSION_DOCTYPE,
				"structure_version": structure_version,
				"effective_from": effective_from,
				"effective_to": effective_to,
				"source_file": file_url,
				"status": "已启用",
			}
		)
		version.insert(ignore_permissions=True)

	for name in frappe.get_all(SALARY_GRADE_DOCTYPE, filters={"salary_structure_version": version.name}, pluck="name"):
		frappe.delete_doc(SALARY_GRADE_DOCTYPE, name, ignore_permissions=True, force=True)
	for grade in grades:
		doc = frappe.get_doc({"doctype": SALARY_GRADE_DOCTYPE, "salary_structure_version": version.name, **grade})
		doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return {"version": version.name, "grade_rows": len(grades)}


@frappe.whitelist()
def list_salary_structure_versions(page_length: int = 50):
	return frappe.get_all(
		SALARY_STRUCTURE_VERSION_DOCTYPE,
		fields=["name", "structure_version", "status", "effective_from", "effective_to", "source_file", "modified"],
		order_by="effective_from desc, modified desc",
		limit_page_length=int(page_length or 50),
	)


@frappe.whitelist()
def list_salary_grades(structure_version: str = "", page_length: int = 50):
	filters = {"salary_structure_version": structure_version} if structure_version else {}
	return frappe.get_all(
		SALARY_GRADE_DOCTYPE,
		filters=filters,
		fields=[
			"name",
			"salary_structure_version",
			"job_nature",
			"job_grade",
			"base_salary",
			"function_allowance",
			"certificate_allowance",
			"multi_skill_allowance",
			"full_salary",
			"full_attendance_bonus_standard",
			"rental_subsidy_standard",
		],
		order_by="salary_structure_version desc, job_grade asc",
		limit_page_length=int(page_length or 50),
	)


def _employee_context(employee):
	if not employee:
		return {}
	row = frappe.db.get_value("Employee", employee, ["employee_name", "department", "designation", "date_of_joining", "company"], as_dict=True)
	return row or {}


def _grade_context(salary_grade):
	if not salary_grade:
		return {}
	return frappe.db.get_value(
		SALARY_GRADE_DOCTYPE,
		salary_grade,
		["base_salary", "function_allowance", "certificate_allowance", "multi_skill_allowance", "full_salary"],
		as_dict=True,
	) or {}


@frappe.whitelist()
def create_employee_salary_change(**kwargs):
	_require_payroll_master_manager()
	data = dict(kwargs)
	company = _require_company(data.get("company"))
	status = data.get("status") or "草稿"
	if status not in {"草稿", "待审核"}:
		frappe.throw(_("新增员工定薪只能保存为草稿或待审核；请在人事审核通过后再生效。"))
	employee = data.get("employee")
	if not employee:
		frappe.throw(_("请先选择员工。"))
	if not data.get("effective_date"):
		frappe.throw(_("请填写生效日期。"))
	if not data.get("change_reason"):
		frappe.throw(_("请填写薪资异动原因。"))
	employee_context = _employee_context(employee)
	if employee_context.get("company") and employee_context.get("company") != company:
		frappe.throw(_("员工 {0} 不属于公司 {1}").format(employee, company))
	grade_context = _grade_context(data.get("salary_grade"))
	base_salary = flt(data.get("base_salary")) or flt(grade_context.get("base_salary"))
	function_allowance = flt(data.get("function_allowance")) or flt(grade_context.get("function_allowance"))
	certificate_allowance = flt(data.get("certificate_allowance")) or flt(grade_context.get("certificate_allowance"))
	multi_skill_allowance = flt(data.get("multi_skill_allowance")) or flt(grade_context.get("multi_skill_allowance"))
	full_salary = (
		flt(data.get("full_salary"))
		or flt(grade_context.get("full_salary"))
		or base_salary + function_allowance + certificate_allowance + multi_skill_allowance
	)
	doc = frappe.get_doc(
		{
			"doctype": EMPLOYEE_SALARY_CHANGE_DOCTYPE,
			"company": company,
			"employee": employee,
			"employee_code": data.get("employee_code") or employee,
			"employee_name": data.get("employee_name") or employee_context.get("employee_name"),
			"department": data.get("department") or employee_context.get("department"),
			"designation": data.get("designation") or employee_context.get("designation"),
			"education_level_text": data.get("education_level_text"),
			"date_of_joining": data.get("date_of_joining") or employee_context.get("date_of_joining"),
			"effective_date": data.get("effective_date"),
			"change_reason": data.get("change_reason"),
			"salary_grade": data.get("salary_grade"),
			"base_salary": base_salary,
			"function_allowance": function_allowance,
			"certificate_allowance": certificate_allowance,
			"multi_skill_allowance": multi_skill_allowance,
			"full_salary": full_salary,
			"housing_fund_enabled": flt(data.get("housing_fund_enabled")),
			"social_insurance_enabled": flt(data.get("social_insurance_enabled")),
			"company_cost_total": flt(data.get("company_cost_total")),
			"prepared_by": data.get("prepared_by"),
			"reviewed_by": data.get("reviewed_by"),
			"approved_by": data.get("approved_by"),
			"status": status,
			"source_file": data.get("source_file"),
			"remarks": data.get("remarks"),
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return doc.name


@frappe.whitelist()
def list_employee_salary_changes(company: str, employee: str = "", payroll_month: str = "", page_length: int = 50):
	company = _require_company(company)
	filters = {"company": company}
	if employee:
		filters["employee"] = employee
	month_end = _month_end(payroll_month)
	if month_end:
		filters["effective_date"] = ["<=", month_end]
	return frappe.get_all(
		EMPLOYEE_SALARY_CHANGE_DOCTYPE,
		filters=filters,
		fields=["*"],
		order_by="effective_date desc, modified desc",
		limit_page_length=int(page_length or 50),
	)


@frappe.whitelist()
def get_active_salary_change_for_employee(employee: str | None = None, employee_code: str = "", payroll_month: str = "", company: str = ""):
	company = _require_company(company)
	filters = {"status": "已批准", "company": company}
	if employee:
		filters["employee"] = employee
	elif employee_code:
		filters["employee_code"] = employee_code
	month_end = _month_end(payroll_month)
	if month_end:
		filters["effective_date"] = ["<=", month_end]
	rows = frappe.get_all(
		EMPLOYEE_SALARY_CHANGE_DOCTYPE,
		filters=filters,
		fields=["*"],
		order_by="effective_date desc, modified desc",
		limit_page_length=1,
	)
	return rows[0] if rows else None


def _welfare_rule(source_type):
	for rule in WELFARE_SOURCE_RULES:
		if rule["source_type"] == source_type:
			return rule
	return {}


def _source_category(source_type):
	if source_type in ("学历补贴", "租房补贴", "高温补贴", "手机话费补贴", "油费补贴"):
		return "补贴"
	if source_type in ("薪资构成", "证书多能工津贴"):
		return "薪资主数据"
	if source_type in ("宿舍住宿费", "宿舍水电费"):
		return "宿舍"
	if source_type in ("社保个人", "社保公司", "公积金个人", "公积金公司"):
		return "社保公积金"
	if source_type in ("提案改善奖", "继续服务奖", "已发福利", "生产奖", "其他奖金", "奖惩提报", "苹果树"):
		return "奖金福利"
	if source_type in ("所得税", "年终奖所得税", "水电费及扣款", "其他扣款", "离职薪资结算"):
		return "个税扣款"
	return "其他"


@frappe.whitelist()
def list_payroll_welfare_source_rules():
	return WELFARE_SOURCE_RULES


@frappe.whitelist()
def upsert_payroll_welfare_source_record(**kwargs):
	data = dict(kwargs)
	company, payroll_month, attendance_lock_version = _require_payroll_scope(
		data.get("company"),
		data.get("payroll_month"),
		data.get("attendance_lock_version"),
	)
	source_type = data.get("source_type")
	if not source_type:
		frappe.throw(_("请选择来源类型"))
	employee_code = data.get("employee_code")
	employee_name = data.get("employee_name")
	employee = data.get("employee") or _employee_lookup(employee_code, employee_name)
	employee_context = _employee_context(employee)
	if employee_context.get("company") and employee_context.get("company") != company:
		frappe.throw(_("福利扣款来源员工 {0} 不属于公司 {1}").format(employee_code or employee_name or employee, company))
	rule = _welfare_rule(source_type)
	variable_type = data.get("variable_type") or WELFARE_SOURCE_VARIABLE_TYPE_MAP.get(source_type)
	direction = data.get("direction") or rule.get("direction")
	department = _department_lookup(
		data.get("department") or employee_context.get("department"), company
	) or data.get("department") or employee_context.get("department")
	trace_payload, trace_hash = _source_trace_hash(
		{
			"company": company,
			"payroll_month": payroll_month,
			"attendance_lock_version": attendance_lock_version,
			"source_type": source_type,
			"source_reference": data.get("source_reference"),
			"source_file": data.get("source_file"),
			"employee": employee or employee_code or employee_name,
		}
	)
	values = {
		"doctype": WELFARE_SOURCE_DOCTYPE,
		"company": company,
		"payroll_month": payroll_month,
		"attendance_lock_version": attendance_lock_version,
		"source_category": data.get("source_category") or _source_category(source_type),
		"source_type": source_type,
		"variable_type": variable_type,
		"direction": direction,
		"employee": employee,
		"employee_code": employee_code,
		"employee_name": employee_name or employee_context.get("employee_name"),
		"department": department,
		"amount": flt(data.get("amount")),
		"eligibility_status": data.get("eligibility_status") or "符合",
		"confirmation_status": data.get("confirmation_status") or "待确认",
		"source_reference": data.get("source_reference"),
		"source_file": data.get("source_file"),
		"rule_snapshot": data.get("rule_snapshot") or rule.get("rule"),
		"remarks": data.get("remarks"),
		"raw_row_json": json.dumps(data, ensure_ascii=False, default=str),
		"source_trace_json": trace_payload,
		"source_hash": trace_hash,
	}
	if values["confirmation_status"] == "已确认":
		values["confirmed_by"] = frappe.session.user
		values["confirmed_on"] = now_datetime()
	record_name = data.get("name")
	if record_name and frappe.db.exists(WELFARE_SOURCE_DOCTYPE, record_name):
		doc = frappe.get_doc(WELFARE_SOURCE_DOCTYPE, record_name)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc(values)
		doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return doc.name


@frappe.whitelist()
def list_payroll_welfare_source_records(company: str, payroll_month: str = "", source_type: str = "", attendance_lock_version: str = "", page_length: int = 100):
	company = _require_company(company)
	filters = {"company": company}
	if payroll_month:
		filters["payroll_month"] = payroll_month
	if attendance_lock_version:
		filters["attendance_lock_version"] = attendance_lock_version
	if source_type:
		filters["source_type"] = source_type
	return frappe.get_all(
		WELFARE_SOURCE_DOCTYPE,
		filters=filters,
		fields=["*"],
		order_by="modified desc",
		limit_page_length=int(page_length or 100),
	)


@frappe.whitelist()
def sync_welfare_sources_to_payroll_variables(company: str, payroll_month: str, attendance_lock_version: str):
	company, payroll_month, attendance_lock_version = _require_payroll_scope(company, payroll_month, attendance_lock_version)
	filters = _payroll_scope_filters(company, payroll_month, attendance_lock_version)
	for name in frappe.get_all(
		VARIABLE_RECORD_DOCTYPE,
		filters={**filters, "source_sheet": WELFARE_SOURCE_SYNC_SHEET},
		pluck="name",
	):
		frappe.delete_doc(VARIABLE_RECORD_DOCTYPE, name, ignore_permissions=True, force=True)

	created = []
	source_rows = frappe.get_all(
		WELFARE_SOURCE_DOCTYPE,
		filters={**filters, "confirmation_status": "已确认", "eligibility_status": "符合"},
		fields=["*"],
		order_by="modified asc",
	)
	for row in source_rows:
		_assert_row_company(row, company, _("福利扣款来源"))
		variable_type = row.variable_type or WELFARE_SOURCE_VARIABLE_TYPE_MAP.get(row.source_type)
		if not variable_type:
			continue
		trace_payload, trace_hash = _source_trace_hash(
			{
				"company": company,
				"payroll_month": payroll_month,
				"attendance_lock_version": attendance_lock_version,
				"welfare_source_record": row.name,
				"source_type": row.source_type,
				"employee": row.employee or row.employee_code or row.employee_name,
			}
		)
		doc = frappe.get_doc(
			{
				"doctype": VARIABLE_RECORD_DOCTYPE,
				"company": company,
				"payroll_month": payroll_month,
				"attendance_lock_version": attendance_lock_version,
				"employee": row.employee,
				"employee_code": row.employee_code,
				"employee_name": row.employee_name,
				"department": _department_lookup(row.department, company) or row.department,
				"variable_type": variable_type,
				"amount": flt(row.amount),
				"source_sheet": WELFARE_SOURCE_SYNC_SHEET,
				"remarks": f"{row.source_type}：{row.source_reference or row.name}",
				"raw_row_json": json.dumps(row, ensure_ascii=False, default=str),
				"source_trace_json": trace_payload,
				"source_hash": trace_hash,
			}
		)
		doc.insert(ignore_permissions=True)
		created.append(doc.name)
	frappe.db.commit()
	return {"created": len(created), "records": created}


@frappe.whitelist()
def list_payroll_import_templates():
	templates = []
	for template in PAYROLL_IMPORT_TEMPLATES:
		item = dict(template)
		item["columns"] = [
			{"excel_column": column[0], "system_field": column[1], "description": column[2]}
			for column in template.get("columns", [])
		]
		templates.append(item)
	return {"templates": templates, "settlement_fields": PAYROLL_SETTLEMENT_FIELD_MAPPINGS}


@frappe.whitelist()
def create_payroll_data_closure_template_file():
	from openpyxl import Workbook
	from openpyxl.styles import Alignment, Font, PatternFill
	from frappe.utils.file_manager import save_file

	workbook = Workbook()
	workbook.remove(workbook.active)
	header_fill = PatternFill("solid", fgColor="D9EAF7")
	header_font = Font(bold=True)

	for template in PAYROLL_IMPORT_TEMPLATES:
		sheet = workbook.create_sheet(template["sheet_name"])
		headers = [column[0] for column in template.get("columns", [])]
		sheet.append(headers)
		for cell in sheet[1]:
			cell.fill = header_fill
			cell.font = header_font
			cell.alignment = Alignment(horizontal="center", vertical="center")
		for index, column in enumerate(headers, start=1):
			sheet.column_dimensions[sheet.cell(1, index).column_letter].width = min(max(len(column) + 8, 14), 32)

	field_sheet = workbook.create_sheet("字段说明")
	field_sheet.append(["工作表", "目标表", "Excel字段", "系统字段", "说明"])
	for template in PAYROLL_IMPORT_TEMPLATES:
		for column in template.get("columns", []):
			field_sheet.append([template["sheet_name"], template["target_doctype"], column[0], column[1], column[2]])
	for cell in field_sheet[1]:
		cell.fill = header_fill
		cell.font = header_font
	for width_index, width in enumerate([22, 34, 22, 28, 58], start=1):
		field_sheet.column_dimensions[field_sheet.cell(1, width_index).column_letter].width = width

	mapping_sheet = workbook.create_sheet("薪资结算字段对应")
	mapping_sheet.append(["Excel列", "Excel字段名", "系统字段", "来源模块", "公式/来源", "对应规则"])
	for mapping in PAYROLL_SETTLEMENT_FIELD_MAPPINGS:
		mapping_sheet.append(
			[
				mapping.get("excel_column"),
				mapping.get("excel_label"),
				mapping.get("system_field"),
				mapping.get("source_module"),
				mapping.get("formula_expression") or mapping.get("source_detail"),
				mapping.get("rule_code"),
			]
		)
	for cell in mapping_sheet[1]:
		cell.fill = header_fill
		cell.font = header_font
	for width_index, width in enumerate([10, 26, 32, 18, 52, 34], start=1):
		mapping_sheet.column_dimensions[mapping_sheet.cell(1, width_index).column_letter].width = width

	output = BytesIO()
	workbook.save(output)
	file_doc = save_file(
		f"薪资数据闭环导入模板-{datetime.today().strftime('%Y%m%d%H%M%S')}.xlsx",
		output.getvalue(),
		None,
		None,
		is_private=1,
	)
	return {"file_url": file_doc.file_url, "file_name": file_doc.file_name}


@frappe.whitelist()
def create_employee_salary_change_template_file():
	"""Create the focused template used for employee salary master-data changes.

	The combined data-closure workbook remains useful for a monthly payroll run.
	This smaller file is deliberately kept next to the salary architecture workflow so
	HR can maintain joiner, confirmation, promotion and adjustment records without
	accidentally importing monthly attendance or welfare data.
	"""
	from openpyxl import Workbook
	from openpyxl.styles import Alignment, Font, PatternFill
	from frappe.utils.file_manager import save_file

	workbook = Workbook()
	sheet = workbook.active
	sheet.title = "员工薪资异动导入"
	template = next(item for item in PAYROLL_IMPORT_TEMPLATES if item["template_key"] == "employee_salary_change")
	headers = [column[0] for column in template["columns"]]
	sheet.append(headers)
	header_fill = PatternFill("solid", fgColor="D9EAF7")
	for cell in sheet[1]:
		cell.fill = header_fill
		cell.font = Font(bold=True)
		cell.alignment = Alignment(horizontal="center", vertical="center")
	for index, column in enumerate(headers, start=1):
		sheet.column_dimensions[sheet.cell(1, index).column_letter].width = min(max(len(column) + 8, 14), 28)

	notes = workbook.create_sheet("填写说明")
	notes.append(["字段", "填写规则"])
	for cell in notes[1]:
		cell.fill = header_fill
		cell.font = Font(bold=True)
	for column in template["columns"]:
		notes.append([column[0], column[2]])
	notes.append(["状态", "建议先导入“草稿”或“待审核”；只有“已批准”且生效日期不晚于算薪月份的记录会进入正式薪资试算。"])
	notes.append(["薪资小计", "可留空，系统会按底薪 + 职能津贴 + 证书津贴 + 多能工津贴计算。"])
	notes.append(["公司", "模板不填写公司；导入时以页面顶部当前公司为准，跨公司数据会被阻断。"])
	notes.column_dimensions["A"].width = 22
	notes.column_dimensions["B"].width = 88

	output = BytesIO()
	workbook.save(output)
	file_doc = save_file(
		f"员工薪资异动导入模板-{datetime.today().strftime('%Y%m%d%H%M%S')}.xlsx",
		output.getvalue(),
		None,
		None,
		is_private=1,
	)
	return {"file_url": file_doc.file_url, "file_name": file_doc.file_name}


@frappe.whitelist()
def preview_payroll_data_closure_workbook(file_url: str):
	workbook = _load_workbook(file_url)
	sheets = []
	for template in PAYROLL_IMPORT_TEMPLATES:
		sheet = _matching_sheet(workbook, template["sheet_name"])
		if not sheet:
			sheets.append({"sheet_name": template["sheet_name"], "target_doctype": template["target_doctype"], "found": False, "row_count": 0})
			continue
		rows = _template_rows_as_dicts(sheet, template)
		sheets.append({"sheet_name": template["sheet_name"], "target_doctype": template["target_doctype"], "found": True, "row_count": len(rows), "sample_rows": rows[:3]})
	settlement_preview = preview_payroll_settlement_workbook(file_url)
	sheets.append(
		{
			"sheet_name": "完整薪资结算表",
			"target_doctype": PAYROLL_SETTLEMENT_DOCTYPE,
			"found": settlement_preview.get("found"),
			"row_count": settlement_preview.get("row_count", 0),
			"sample_rows": settlement_preview.get("sample_rows", []),
		}
	)
	return {"sheets": sheets}


def _upsert_employee_salary_change_from_row(row, payroll_month="", company=""):
	company = _require_company(company)
	employee_code = _first(row, "工号", "员工编号", "employee_code")
	employee_name = _first(row, "姓名", "employee_name")
	if not employee_code and not employee_name:
		return None
	employee = _employee_lookup(employee_code, employee_name)
	employee_context = _employee_context(employee)
	if employee_context.get("company") and employee_context.get("company") != company:
		frappe.throw(_("员工薪资异动导入存在跨公司员工：{0}").format(employee_code or employee_name or employee))
	effective_date = _date_or_none(_first(row, "生效日期")) or (f"{payroll_month}-01" if payroll_month else None)
	if not effective_date:
		frappe.throw(_("员工薪资异动导入缺少生效日期"))

	base_salary = flt(_first(row, "底薪"))
	function_allowance = flt(_first(row, "职能津贴"))
	certificate_allowance = flt(_first(row, "证书津贴", "证书及多能工津贴"))
	multi_skill_allowance = flt(_first(row, "多能工津贴"))
	full_salary = flt(_first(row, "薪资小计")) or base_salary + function_allowance + certificate_allowance + multi_skill_allowance
	values = {
		"company": company,
		"employee": employee,
		"employee_code": employee_code or employee,
		"employee_name": employee_name or employee_context.get("employee_name"),
		"department": _department_lookup(_first(row, "部门")) or employee_context.get("department"),
		"designation": _first(row, "岗位") or employee_context.get("designation"),
		"date_of_joining": employee_context.get("date_of_joining"),
		"effective_date": effective_date,
		"change_reason": _first(row, "异动原因", "调整原因"),
		"salary_grade": _first(row, "薪资档位"),
		"base_salary": base_salary,
		"function_allowance": function_allowance,
		"certificate_allowance": certificate_allowance,
		"multi_skill_allowance": multi_skill_allowance,
		"full_salary": full_salary,
		"housing_fund_enabled": _bool_value(_first(row, "公积金")),
		"social_insurance_enabled": _bool_value(_first(row, "社保")),
		"status": _first(row, "状态") or "已批准",
		"source_file": "Excel导入",
		"remarks": _first(row, "备注"),
	}
	name = frappe.db.get_value(
		EMPLOYEE_SALARY_CHANGE_DOCTYPE,
		{"company": company, "employee_code": values["employee_code"], "effective_date": values["effective_date"]},
		"name",
	)
	if name:
		doc = frappe.get_doc(EMPLOYEE_SALARY_CHANGE_DOCTYPE, name)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": EMPLOYEE_SALARY_CHANGE_DOCTYPE, **values})
		doc.insert(ignore_permissions=True)
	return doc.name


def _upsert_welfare_source_from_row(row, payroll_month="", company="", attendance_lock_version=""):
	month = _first(row, "薪资月份") or payroll_month
	company, month, attendance_lock_version = _require_payroll_scope(company, month, attendance_lock_version)
	return upsert_payroll_welfare_source_record(
		company=company,
		payroll_month=month,
		attendance_lock_version=attendance_lock_version,
		source_type=_first(row, "来源类型"),
		employee_code=_first(row, "工号", "员工编号"),
		employee_name=_first(row, "姓名"),
		department=_first(row, "部门"),
		amount=flt(_first(row, "金额")),
		eligibility_status=_first(row, "资格状态") or "符合",
		confirmation_status=_first(row, "确认状态") or "已确认",
		source_reference=_first(row, "来源单据/说明", "来源说明"),
		remarks=_first(row, "备注"),
	)


def _upsert_attendance_summary_from_row(row, payroll_month="", company="", attendance_lock_version=""):
	attendance_month = _first(row, "考勤月份", "薪资月份") or payroll_month
	company, attendance_month, attendance_lock_version = _require_payroll_scope(company, attendance_month, attendance_lock_version)
	employee_code = _first(row, "工号", "员工编号")
	employee_name = _first(row, "姓名")
	if not employee_code and not employee_name:
		return None
	employee = _employee_lookup(employee_code, employee_name)
	employee_context = _employee_context(employee)
	if employee_context.get("company") and employee_context.get("company") != company:
		frappe.throw(_("月度考勤终稿导入存在跨公司员工：{0}").format(employee_code or employee_name or employee))
	values = {
		"company": company,
		"attendance_month": attendance_month,
		"attendance_lock_version": attendance_lock_version,
		"employee": employee,
		"employee_code": employee_code or employee,
		"employee_name": employee_name or employee_context.get("employee_name"),
		"department": _department_lookup(_first(row, "部门")) or employee_context.get("department"),
		"date_of_joining": _date_or_none(_first(row, "入职日期")) or employee_context.get("date_of_joining"),
		"standard_hours": flt(_first(row, "标准工时")),
		"actual_attendance_hours": flt(_first(row, "基本出勤工时", "实际出勤工时")),
		"adjusted_working_hours": flt(_first(row, "调整后工时")),
		"overtime_1_5_hours": flt(_first(row, "1.5倍加班", "平日加班")),
		"overtime_2_hours": flt(_first(row, "2倍加班", "周末加班")),
		"overtime_3_hours": flt(_first(row, "3倍加班", "节假日加班")),
		"leave_hours": flt(_first(row, "请假工时")),
		"absent_hours": flt(_first(row, "旷工工时")),
		"large_night_shift_count": flt(_first(row, "大夜班次数")),
		"small_night_shift_count": flt(_first(row, "小夜班次数")),
		"apple_reward_amount": flt(_first(row, "红绿苹果金额", "苹果树金额")),
		"full_attendance_deduction": flt(_first(row, "全勤扣款")),
		"status": _first(row, "状态") or "已确认",
		"lock_status": _first(row, "锁定状态") or "已锁定",
		"locked_by": frappe.session.user,
		"locked_on": now_datetime(),
	}
	name = frappe.db.get_value(
		MONTHLY_ATTENDANCE_DOCTYPE,
		{"company": company, "attendance_month": attendance_month, "attendance_lock_version": attendance_lock_version, "employee_code": values["employee_code"]},
		"name",
	)
	if name:
		doc = frappe.get_doc(MONTHLY_ATTENDANCE_DOCTYPE, name)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": MONTHLY_ATTENDANCE_DOCTYPE, **values})
		doc.insert(ignore_permissions=True)
	return doc.name


def _settlement_cell(row, index):
	return row[index - 1] if index - 1 < len(row) else None


def _settlement_float(row, index):
	return flt(_settlement_cell(row, index))


def _payroll_settlement_sheet(workbook):
	return _matching_sheet(workbook, PAYROLL_SETTLEMENT_IMPORT_SHEET)


def _parse_settlement_sheet_rows(sheet):
	rows = []
	for raw in sheet.iter_rows(min_row=4, values_only=True):
		department = _text(_settlement_cell(raw, 2))
		employee_code = _text(_settlement_cell(raw, 3))
		employee_name = _text(_settlement_cell(raw, 4))
		if not employee_code and not employee_name:
			continue
		if department == "小计" or employee_code == "小计" or employee_name == "小计":
			continue
		rows.append(
			{
				"department": department,
				"employee_code": employee_code,
				"employee_name": employee_name,
				"base_salary": _settlement_float(raw, 5),
				"function_allowance": _settlement_float(raw, 6),
				"certificate_skill_allowance": _settlement_float(raw, 7),
				"salary_subtotal": _settlement_float(raw, 8),
				"standard_hours": _settlement_float(raw, 9),
				"basic_attendance_hours": _settlement_float(raw, 10),
				"missing_hours": _settlement_float(raw, 11),
				"raw_weekend_overtime_hours": _settlement_float(raw, 12),
				"adjusted_absence_hours": _settlement_float(raw, 13),
				"absence_deduction_amount": _settlement_float(raw, 14),
				"weekend_overtime_hours": _settlement_float(raw, 15),
				"weekday_overtime_hours": _settlement_float(raw, 16),
				"holiday_overtime_hours": _settlement_float(raw, 17),
				"weekday_overtime_pay": _settlement_float(raw, 18),
				"weekend_overtime_pay": _settlement_float(raw, 19),
				"holiday_overtime_pay": _settlement_float(raw, 20),
				"overtime_pay_total": _settlement_float(raw, 21),
				"large_night_shift_count": _settlement_float(raw, 22),
				"small_night_shift_count": _settlement_float(raw, 23),
				"night_shift_allowance": _settlement_float(raw, 24),
				"attendance_wage": _settlement_float(raw, 25),
				"proposal_improvement_bonus": _settlement_float(raw, 26),
				"apple_reward_amount": _settlement_float(raw, 27),
				"subsidy_bonus_total": _settlement_float(raw, 28),
				"production_bonus": _settlement_float(raw, 29),
				"bonus_total": _settlement_float(raw, 30),
				"absenteeism_hours": _settlement_float(raw, 31),
				"absenteeism_deduction": _settlement_float(raw, 32),
				"late_full_attendance_deduction": _settlement_float(raw, 33),
				"punishment_total": _settlement_float(raw, 34),
				"gross_pay": _settlement_float(raw, 35),
				"social_security_personal": _settlement_float(raw, 36),
				"housing_fund_personal": _settlement_float(raw, 37),
				"paid_proposal_birthday_welfare": _settlement_float(raw, 38),
				"taxable_salary": _settlement_float(raw, 39),
				"continuing_service_bonus": _settlement_float(raw, 40),
				"income_tax": _settlement_float(raw, 42),
				"year_end_bonus_tax": _settlement_float(raw, 43),
				"utilities_deduction": _settlement_float(raw, 44),
				"net_pay": _settlement_float(raw, 45),
				"social_security_company": _settlement_float(raw, 46),
				"housing_fund_company": _settlement_float(raw, 47),
				"company_cost_total": _settlement_float(raw, 48),
				"export_tax_adjusted_net_pay": _settlement_float(raw, 57),
			}
		)
	return rows


def _upsert_by_employee_month(doctype, month_field, payroll_month, employee_code, values, company="", attendance_lock_version=""):
	company = _require_company(company or values.get("company"))
	filters = {"company": company, month_field: payroll_month}
	if attendance_lock_version:
		filters["attendance_lock_version"] = attendance_lock_version
	if employee_code:
		filters["employee_code"] = employee_code
	if values.get("employee_name"):
		filters["employee_name"] = values.get("employee_name")
	name = frappe.db.get_value(doctype, filters, "name")
	if name:
		doc = frappe.get_doc(doctype, name)
		doc.update(values)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({"doctype": doctype, **values})
		doc.insert(ignore_permissions=True)
	return doc.name


def _insert_settlement_welfare_source(company, payroll_month, attendance_lock_version, settlement_row, source_type, amount, reference):
	if not flt(amount):
		return None
	return upsert_payroll_welfare_source_record(
		company=company,
		payroll_month=payroll_month,
		attendance_lock_version=attendance_lock_version,
		source_type=source_type,
		employee_code=settlement_row.get("employee_code"),
		employee_name=settlement_row.get("employee_name"),
		department=settlement_row.get("department"),
		amount=amount,
		eligibility_status="符合",
		confirmation_status="已确认",
		source_reference=reference,
		source_file=PAYROLL_SETTLEMENT_IMPORT_SOURCE,
	)


def _upsert_sources_from_settlement_row(company, payroll_month, attendance_lock_version, row):
	company, payroll_month, attendance_lock_version = _require_payroll_scope(company, payroll_month, attendance_lock_version)
	employee = _employee_lookup(row.get("employee_code"), row.get("employee_name"))
	employee_context = _employee_context(employee)
	if employee_context.get("company") and employee_context.get("company") != company:
		frappe.throw(_("完整薪资结算表导入存在跨公司员工：{0}").format(row.get("employee_code") or row.get("employee_name") or employee))
	full_salary = row.get("salary_subtotal") or row.get("base_salary") + row.get("function_allowance") + row.get("certificate_skill_allowance")
	salary_values = {
		"company": company,
		"employee": employee,
		"employee_code": row.get("employee_code"),
		"employee_name": row.get("employee_name") or employee_context.get("employee_name"),
		"department": _ensure_department(row.get("department")) or employee_context.get("department"),
		"designation": employee_context.get("designation"),
		"date_of_joining": employee_context.get("date_of_joining"),
		"effective_date": f"{payroll_month}-01",
		"change_reason": PAYROLL_SETTLEMENT_IMPORT_SOURCE,
		"base_salary": row.get("base_salary"),
		"function_allowance": row.get("function_allowance"),
		"certificate_allowance": row.get("certificate_skill_allowance"),
		"multi_skill_allowance": 0,
		"full_salary": full_salary,
		"status": "已批准",
		"source_file": PAYROLL_SETTLEMENT_IMPORT_SOURCE,
	}
	_upsert_by_employee_month(EMPLOYEE_SALARY_CHANGE_DOCTYPE, "effective_date", f"{payroll_month}-01", row.get("employee_code"), salary_values, company)

	attendance_values = {
		"company": company,
		"attendance_month": payroll_month,
		"attendance_lock_version": attendance_lock_version,
		"employee": employee,
		"employee_code": row.get("employee_code"),
		"employee_name": row.get("employee_name") or employee_context.get("employee_name"),
		"department": _ensure_department(row.get("department")),
		"date_of_joining": employee_context.get("date_of_joining"),
		"standard_hours": row.get("standard_hours"),
		"actual_attendance_hours": row.get("basic_attendance_hours"),
		"adjusted_working_hours": row.get("standard_hours") - row.get("adjusted_absence_hours"),
		"overtime_1_5_hours": row.get("weekday_overtime_hours"),
		"overtime_2_hours": row.get("raw_weekend_overtime_hours"),
		"overtime_3_hours": row.get("holiday_overtime_hours"),
		"absent_hours": row.get("absenteeism_hours"),
		"large_night_shift_count": row.get("large_night_shift_count"),
		"small_night_shift_count": row.get("small_night_shift_count"),
		"apple_reward_amount": row.get("apple_reward_amount"),
		"full_attendance_deduction": row.get("late_full_attendance_deduction"),
		"status": "已确认",
		"lock_status": "已锁定",
		"locked_by": frappe.session.user,
		"locked_on": now_datetime(),
	}
	_upsert_by_employee_month(MONTHLY_ATTENDANCE_DOCTYPE, "attendance_month", payroll_month, row.get("employee_code"), attendance_values, company, attendance_lock_version)

	input_values = {
		"company": company,
		"payroll_month": payroll_month,
		"attendance_lock_version": attendance_lock_version,
		"employee": employee,
		"employee_code": row.get("employee_code"),
		"employee_name": row.get("employee_name") or employee_context.get("employee_name"),
		"department": _ensure_department(row.get("department")),
		"date_of_joining": employee_context.get("date_of_joining"),
		"standard_hours": row.get("standard_hours"),
		"actual_attendance_hours": row.get("basic_attendance_hours"),
		"adjusted_working_hours": row.get("standard_hours") - row.get("adjusted_absence_hours"),
		"overtime_1_5_hours": row.get("weekday_overtime_hours"),
		"overtime_2_hours": row.get("raw_weekend_overtime_hours"),
		"overtime_3_hours": row.get("holiday_overtime_hours"),
		"absent_hours": row.get("absenteeism_hours"),
		"large_night_shift_count": row.get("large_night_shift_count"),
		"small_night_shift_count": row.get("small_night_shift_count"),
		"apple_reward_amount": row.get("apple_reward_amount"),
		"full_attendance_bonus": row.get("subsidy_bonus_total"),
		"social_security_personal": row.get("social_security_personal"),
		"housing_fund_personal": row.get("housing_fund_personal"),
		"other_bonus": row.get("proposal_improvement_bonus") + row.get("production_bonus"),
		"other_deduction": row.get("late_full_attendance_deduction"),
		"preliminary_earning_total": row.get("bonus_total"),
		"preliminary_deduction_total": row.get("social_security_personal") + row.get("housing_fund_personal") + row.get("utilities_deduction"),
		"settlement_status": "已生成工资表",
	}
	_upsert_by_employee_month(PAYROLL_INPUT_DOCTYPE, "payroll_month", payroll_month, row.get("employee_code"), input_values, company, attendance_lock_version)

	for source_type, fieldname, reference in (
		("提案改善奖", "proposal_improvement_bonus", "完整薪资结算表导入: 提案改善奖"),
		("其他奖金", "subsidy_bonus_total", "完整薪资结算表导入: 全勤奖,住房学历补贴"),
		("生产奖", "production_bonus", "完整薪资结算表导入: 生产奖"),
		("社保个人", "social_security_personal", "完整薪资结算表导入: 保险基金员工负担额"),
		("公积金个人", "housing_fund_personal", "完整薪资结算表导入: 住房公积金"),
		("已发福利", "paid_proposal_birthday_welfare", "完整薪资结算表导入: 提案改善奖&生日福利金已发"),
		("继续服务奖", "continuing_service_bonus", "完整薪资结算表导入: 继续服务奖"),
		("所得税", "income_tax", "完整薪资结算表导入: 所得税代扣款"),
		("年终奖所得税", "year_end_bonus_tax", "完整薪资结算表导入: 年终奖所得税"),
		("水电费及扣款", "utilities_deduction", "完整薪资结算表导入: 水电费及扣款"),
		("社保公司", "social_security_company", "完整薪资结算表导入: 保险基金公司负担额"),
		("公积金公司", "housing_fund_company", "完整薪资结算表导入: 住房公积金公司负担"),
	):
		_insert_settlement_welfare_source(company, payroll_month, attendance_lock_version, row, source_type, row.get(fieldname), reference)


@frappe.whitelist()
def preview_payroll_settlement_workbook(file_url: str):
	workbook = _load_workbook(file_url)
	sheet = _payroll_settlement_sheet(workbook)
	if not sheet:
		return {"found": False, "sheet_name": PAYROLL_SETTLEMENT_IMPORT_SHEET, "row_count": 0, "sample_rows": []}
	rows = _parse_settlement_sheet_rows(sheet)
	return {
		"found": True,
		"sheet_name": sheet.title,
		"row_count": len(rows),
		"sample_rows": rows[:5],
		"totals": {
			"gross_pay": round(sum(flt(row.get("gross_pay")) for row in rows), 2),
			"net_pay": round(sum(flt(row.get("net_pay")) for row in rows), 2),
			"company_cost_total": round(sum(flt(row.get("company_cost_total")) for row in rows), 2),
		},
	}


@frappe.whitelist()
def import_payroll_settlement_workbook(file_url: str, payroll_month: str = "", company: str = "", attendance_lock_version: str = ""):
	_require_payroll_scope(company, payroll_month or datetime.today().strftime("%Y-%m"), attendance_lock_version)
	frappe.throw(_("完整薪资结算表只能用于预览核对，不允许从 Excel 终稿直接覆盖薪资结算；请先导入/确认同公司同锁定版本变量，再由系统生成薪资输入表和薪资结算表。"))


@frappe.whitelist()
def import_payroll_data_closure_workbook(file_url: str, payroll_month: str = "", company: str = "", attendance_lock_version: str = ""):
	company, payroll_month, attendance_lock_version = _require_payroll_scope(company, payroll_month or datetime.today().strftime("%Y-%m"), attendance_lock_version)
	workbook = _load_workbook(file_url)
	result = {"created_or_updated": defaultdict(int), "skipped_sheets": []}
	importers = {
		"employee_salary_change": _upsert_employee_salary_change_from_row,
		"welfare_source": _upsert_welfare_source_from_row,
		"monthly_attendance_summary": _upsert_attendance_summary_from_row,
	}
	for template in PAYROLL_IMPORT_TEMPLATES:
		sheet = _matching_sheet(workbook, template["sheet_name"])
		if not sheet:
			result["skipped_sheets"].append(template["sheet_name"])
			continue
		rows = _template_rows_as_dicts(sheet, template)
		importer = importers.get(template["template_key"])
		for row in rows:
			month = _first(row, "薪资月份", "考勤月份") or payroll_month
			if template["template_key"] == "employee_salary_change":
				name = importer(row, month, company)
			else:
				name = importer(row, month, company, attendance_lock_version)
			if name:
				result["created_or_updated"][template["sheet_name"]] += 1
	if _payroll_settlement_sheet(workbook):
		result["skipped_sheets"].append("完整薪资结算表（仅预览核对，不直接写入结算）")
	frappe.db.commit()
	result["created_or_updated"] = dict(result["created_or_updated"])
	return result


@frappe.whitelist()
def preview_payroll_variable_workbook(file_url: str):
	workbook = _load_workbook(file_url)
	sheets = []
	for sheet_name in PAYROLL_VARIABLE_SHEETS:
		sheet = _matching_sheet(workbook, sheet_name)
		rows = _rows_as_dicts(sheet) if sheet else []
		variable_type = SHEET_VARIABLE_TYPES[sheet_name]
		mapped_rows = sum(1 for row in rows if _amount_for_type(row, variable_type))
		sheets.append({"sheet_name": sheet_name, "found": bool(sheet), "row_count": len(rows), "mapped_rows": mapped_rows})
	settlement_sheet = _payroll_settlement_sheet(workbook)
	if settlement_sheet:
		settlement_rows = _parse_settlement_sheet_rows(settlement_sheet)
		sheets.append({"sheet_name": "完整薪资结算表", "found": True, "row_count": len(settlement_rows), "mapped_rows": len(settlement_rows)})
	return {"sheets": sheets, "found_sheets": [sheet["sheet_name"] for sheet in sheets if sheet["found"]]}


def _insert_variable(batch_name, company, payroll_month, attendance_lock_version, sheet_name, row):
	company, payroll_month, attendance_lock_version = _require_payroll_scope(company, payroll_month, attendance_lock_version)
	variable_type = SHEET_VARIABLE_TYPES[sheet_name]
	amount = _amount_for_type(row, variable_type)
	if not amount:
		return None
	employee_code = _first(row, "工号", "受奖惩人工号")
	employee_name = _first(row, "姓名", "受奖/惩人", "受奖惩人姓名")
	if not employee_code and not employee_name:
		return None
	employee = _employee_lookup(employee_code, employee_name)
	employee_context = _employee_context(employee)
	if employee_context.get("company") and employee_context.get("company") != company:
		frappe.throw(_("薪资变量导入存在跨公司员工：{0}").format(employee_code or employee_name or employee))
	trace_payload, trace_hash = _source_trace_hash(
		{
			"company": company,
			"payroll_month": payroll_month,
			"attendance_lock_version": attendance_lock_version,
			"import_batch": batch_name,
			"source_sheet": sheet_name,
			"employee": employee or employee_code or employee_name,
			"raw_row": row,
		}
	)
	doc = frappe.get_doc(
		{
			"doctype": VARIABLE_RECORD_DOCTYPE,
			"import_batch": batch_name,
			"company": company,
			"payroll_month": payroll_month,
			"attendance_lock_version": attendance_lock_version,
			"employee": employee,
			"employee_code": employee_code,
			"employee_name": employee_name,
			"department": _department_lookup(_first(row, "部门", "单位", "受奖/惩人部门")),
			"variable_type": variable_type,
			"amount": amount,
			"source_sheet": sheet_name,
			"remarks": _first(row, "备注"),
			"raw_row_json": json.dumps(row, ensure_ascii=False, default=str),
			"source_trace_json": trace_payload,
			"source_hash": trace_hash,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


@frappe.whitelist()
def import_payroll_variable_workbook(file_url: str, payroll_month: str = "", company: str = "", attendance_lock_version: str = ""):
	company, payroll_month, attendance_lock_version = _require_payroll_scope(company, payroll_month or datetime.today().strftime("%Y-%m"), attendance_lock_version)
	workbook = _load_workbook(file_url)
	batch = frappe.get_doc(
		{
			"doctype": VARIABLE_BATCH_DOCTYPE,
			"company": company,
			"payroll_month": payroll_month,
			"attendance_lock_version": attendance_lock_version,
			"source_file": file_url,
			"status": "已导入",
			"imported_by": frappe.session.user,
			"imported_on": now_datetime(),
		}
	)
	batch.insert(ignore_permissions=True)

	created = []
	for sheet_name in PAYROLL_VARIABLE_SHEETS:
		sheet = _matching_sheet(workbook, sheet_name)
		if not sheet:
			continue
		for row in _rows_as_dicts(sheet):
			name = _insert_variable(batch.name, company, payroll_month, attendance_lock_version, sheet_name, row)
			if name:
				created.append(name)
	batch.variable_rows = len(created)
	batch.save(ignore_permissions=True)
	settlement_result = {}
	if _payroll_settlement_sheet(workbook):
		frappe.throw(_("完整薪资结算表只能作为来源映射核对，不允许在变量导入时直接覆盖薪资结算。请使用数据闭环导入并指定公司、月份和锁定版本。"))
	frappe.db.commit()
	return {"batch": batch.name, "variable_rows": len(created), **settlement_result}


def _source_file_label(file_url):
	return (file_url or "").split("/")[-1] or file_url or ""


@frappe.whitelist()
def list_payroll_variable_import_batches(company: str, payroll_month: str = "", attendance_lock_version: str = "", page_length: int = 20):
	company = _require_company(company)
	filters = {"company": company}
	if payroll_month:
		filters["payroll_month"] = payroll_month
	if attendance_lock_version:
		filters["attendance_lock_version"] = attendance_lock_version
	batches = frappe.get_all(
		VARIABLE_BATCH_DOCTYPE,
		filters=filters,
		fields=["name", "company", "payroll_month", "attendance_lock_version", "source_file", "status", "variable_rows", "imported_by", "imported_on", "modified"],
		order_by="imported_on desc, modified desc",
		limit_page_length=int(page_length or 20),
	)
	for batch in batches:
		rows = frappe.get_all(
			VARIABLE_RECORD_DOCTYPE,
			filters={"company": company, "payroll_month": batch.payroll_month, "attendance_lock_version": batch.attendance_lock_version, "import_batch": batch.name},
			fields=["source_sheet"],
			limit_page_length=1000,
		)
		source_sheets = sorted({row.source_sheet for row in rows if row.source_sheet})
		batch["source_file_label"] = _source_file_label(batch.source_file)
		batch["source_sheets"] = "、".join(source_sheets)
		batch["actual_variable_rows"] = len(rows)
		batch["can_delete"] = 1
	return batches


@frappe.whitelist()
def delete_payroll_variable_import_batch(batch_name: str, company: str = "", attendance_lock_version: str = ""):
	if not batch_name or not frappe.db.exists(VARIABLE_BATCH_DOCTYPE, batch_name):
		frappe.throw(_("导入批次不存在"))

	batch = frappe.get_doc(VARIABLE_BATCH_DOCTYPE, batch_name)
	company = _require_company(company or batch.company)
	if batch.company != company:
		frappe.throw(_("导入批次公司与当前公司不一致，已阻断删除。"))
	if attendance_lock_version and batch.attendance_lock_version != attendance_lock_version:
		frappe.throw(_("导入批次锁定版本与当前锁定版本不一致，已阻断删除。"))
	scope_filters = _payroll_scope_filters(company, batch.payroll_month, batch.attendance_lock_version)
	variable_names = frappe.get_all(VARIABLE_RECORD_DOCTYPE, filters={**scope_filters, "import_batch": batch.name}, pluck="name")
	input_names = frappe.get_all(PAYROLL_INPUT_DOCTYPE, filters=scope_filters, pluck="name")

	for name in variable_names:
		frappe.delete_doc(VARIABLE_RECORD_DOCTYPE, name, ignore_permissions=True, force=True)
	for name in input_names:
		frappe.delete_doc(PAYROLL_INPUT_DOCTYPE, name, ignore_permissions=True, force=True)
	frappe.delete_doc(VARIABLE_BATCH_DOCTYPE, batch.name, ignore_permissions=True, force=True)
	frappe.db.commit()

	return {
		"deleted_batch": batch.name,
		"payroll_month": batch.payroll_month,
		"deleted_variable_records": len(variable_names),
		"deleted_payroll_input_records": len(input_names),
		"settlement_records_deleted": 0,
		"message": _("同月份薪资输入表已清空，请重新生成；结算表不会自动删除。"),
	}


@frappe.whitelist()
def update_payroll_variable_record(
	name: str,
	employee: str = "",
	employee_code: str = "",
	employee_name: str = "",
	department: str = "",
	variable_type: str = "",
	amount: float = 0,
	source_sheet: str = "",
	remarks: str = "",
):
	if not name or not frappe.db.exists(VARIABLE_RECORD_DOCTYPE, name):
		frappe.throw(_("薪资变量记录不存在"))

	resolved_employee = employee if employee and frappe.db.exists("Employee", employee) else None
	resolved_employee = resolved_employee or _employee_lookup(employee_code, employee_name)
	if not resolved_employee:
		frappe.throw(_("请先选择或填写可匹配到员工档案的员工。"))

	employee_context = _employee_context(resolved_employee)
	doc = frappe.get_doc(VARIABLE_RECORD_DOCTYPE, name)
	company = _require_company(doc.company)
	if employee_context.get("company") and employee_context.get("company") != company:
		frappe.throw(_("薪资变量员工 {0} 不属于公司 {1}").format(employee_code or employee_name or resolved_employee, company))
	doc.employee = resolved_employee
	doc.employee_code = employee_code or resolved_employee
	doc.employee_name = employee_name or employee_context.get("employee_name")
	doc.department = _department_lookup(department) or employee_context.get("department")
	if variable_type:
		doc.variable_type = variable_type
	doc.amount = flt(amount)
	doc.source_sheet = source_sheet or doc.source_sheet
	doc.remarks = remarks
	doc.save(ignore_permissions=True)

	input_names = frappe.get_all(
		PAYROLL_INPUT_DOCTYPE,
		filters=_payroll_scope_filters(company, doc.payroll_month, doc.attendance_lock_version),
		pluck="name",
	)
	for input_name in input_names:
		frappe.delete_doc(PAYROLL_INPUT_DOCTYPE, input_name, ignore_permissions=True, force=True)
	frappe.db.commit()
	result = frappe.get_value(VARIABLE_RECORD_DOCTYPE, doc.name, ["name", "employee", "employee_code", "employee_name", "department", "variable_type", "amount", "source_sheet", "remarks"], as_dict=True)
	result["deleted_payroll_input_records"] = len(input_names)
	result["message"] = _("薪资变量明细已保存；同月份薪资输入表已清空，请重新生成；结算表不会自动删除。")
	return result


def _variable_totals(company, payroll_month, attendance_lock_version=""):
	company = _require_company(company)
	filters = {"company": company, "payroll_month": payroll_month}
	if attendance_lock_version:
		filters["attendance_lock_version"] = attendance_lock_version
	totals = defaultdict(lambda: defaultdict(float))
	identity = {}
	sources = defaultdict(list)
	for row in frappe.get_all(VARIABLE_RECORD_DOCTYPE, filters=filters, fields=["*"]):
		_assert_row_company(row, company, _("薪资变量"))
		key = _employee_identity_key(row)
		if not key:
			continue
		identity.setdefault(key, row)
		totals[key][row.variable_type] += flt(row.amount)
		sources[key].append(
			{
				"name": row.name,
				"variable_type": row.variable_type,
				"amount": flt(row.amount),
				"source_sheet": row.source_sheet,
				"source_hash": row.source_hash,
			}
		)
	return totals, identity, sources


@frappe.whitelist()
def generate_payroll_input_records(company: str, payroll_month: str, attendance_lock_version: str):
	company, payroll_month, attendance_lock_version = _require_payroll_scope(company, payroll_month, attendance_lock_version)
	calculation_rules = _payroll_calculation_rules(company, payroll_month)
	input_filters = _payroll_scope_filters(company, payroll_month, attendance_lock_version)
	variables, variable_identity, variable_sources = _variable_totals(company, payroll_month, attendance_lock_version)
	summary_rows = frappe.get_all(MONTHLY_ATTENDANCE_DOCTYPE, filters=_attendance_scope_filters(company, payroll_month, attendance_lock_version), fields=["*"])
	if not summary_rows:
		frappe.throw(_("未找到公司 {0}、月份 {1}、锁定版本 {2} 的已锁定月度考勤终稿。").format(company, payroll_month, attendance_lock_version))

	attendance_by_key = {}
	for row in summary_rows:
		_assert_row_company(row, company, _("月度考勤终稿"))
		key = _employee_identity_key(row)
		if not key:
			frappe.throw(_("月度考勤终稿存在无法识别员工的记录。"))
		if key in attendance_by_key:
			frappe.throw(_("月度考勤终稿存在重复员工：{0}").format(key))
		attendance_by_key[key] = row

	extra_variable_keys = sorted(set(variable_identity) - set(attendance_by_key))
	if extra_variable_keys:
		frappe.throw(_("薪资变量存在未匹配已锁定考勤终稿的员工：{0}").format(", ".join(extra_variable_keys[:10])))

	active_salary_changes = _active_salary_changes_for_month(company, payroll_month)
	missing_salary_profiles = []
	trial_salary_profiles = []
	for key, attendance in attendance_by_key.items():
		profile = (
			active_salary_changes.get(getattr(attendance, "employee", None))
			or active_salary_changes.get(getattr(attendance, "employee_code", None))
			or active_salary_changes.get(getattr(attendance, "employee_name", None))
		)
		label = getattr(attendance, "employee_code", None) or getattr(attendance, "employee_name", None) or key
		if not profile:
			missing_salary_profiles.append(label)
		elif _is_trial_salary_change(profile):
			trial_salary_profiles.append(label)
	if missing_salary_profiles:
		frappe.throw(_("无法生成薪资输入表：以下员工缺少本月有效且已批准的薪资异动：{0}").format(", ".join(missing_salary_profiles[:10])))
	if trial_salary_profiles and company != LOCAL_PAYROLL_TEST_COMPANY:
		frappe.throw(_("无法生成薪资输入表：以下员工仍使用本地试运营/测试薪资数据，请先导入并批准正式薪资异动：{0}").format(", ".join(trial_salary_profiles[:10])))

	for name in frappe.get_all(PAYROLL_INPUT_DOCTYPE, filters=input_filters, pluck="name"):
		frappe.delete_doc(PAYROLL_INPUT_DOCTYPE, name, ignore_permissions=True, force=True)

	created = []
	for key in sorted(k for k in attendance_by_key if k):
		attendance = attendance_by_key.get(key)
		source = attendance
		values = defaultdict(float, variables.get(key, {}))
		calculated_full_attendance_bonus, full_attendance_absence_basis = _full_attendance_bonus(
			attendance, calculation_rules["ATTENDANCE_FULL_ATTENDANCE_BONUS"]
		)
		manual_full_attendance_bonus = "全勤奖" in values
		full_attendance_bonus = values["全勤奖"] if manual_full_attendance_bonus else calculated_full_attendance_bonus
		apple_reward_amount = flt(getattr(attendance, "apple_reward_amount", 0)) + values["苹果树"]
		earnings = (
			apple_reward_amount
			+ full_attendance_bonus
			+ values["住房补贴"]
			+ values["学历补贴"]
			+ values["其他奖金"]
		)
		deductions = values["宿舍扣款"] + values["社保个人"] + values["公积金个人"] + values["其他扣款"]
		trace, source_hash = _source_trace_hash({
			"company": company,
			"payroll_month": payroll_month,
			"attendance_lock_version": attendance_lock_version,
			"attendance_summary": getattr(attendance, "name", ""),
			"variable_records": variable_sources.get(key, []),
			"calculation_rules": calculation_rules,
			"full_attendance_bonus_source": "确认变量" if manual_full_attendance_bonus else "考勤规则自动计算",
			"full_attendance_absence_basis": full_attendance_absence_basis,
		})
		doc = frappe.get_doc(
			{
				"doctype": PAYROLL_INPUT_DOCTYPE,
				"company": company,
				"payroll_month": payroll_month,
				"attendance_lock_version": attendance_lock_version,
				"employee": getattr(source, "employee", None),
				"employee_code": getattr(source, "employee_code", ""),
				"employee_name": getattr(source, "employee_name", ""),
				"department": getattr(source, "department", None),
				"date_of_joining": getattr(attendance, "date_of_joining", None),
				"standard_hours": flt(getattr(attendance, "standard_hours", 0)),
				"actual_attendance_hours": flt(getattr(attendance, "actual_attendance_hours", 0)),
				"adjusted_working_hours": flt(getattr(attendance, "adjusted_working_hours", 0)),
				"overtime_1_5_hours": flt(getattr(attendance, "overtime_1_5_hours", 0)),
				"overtime_2_hours": flt(getattr(attendance, "overtime_2_hours", 0)),
				"overtime_3_hours": flt(getattr(attendance, "overtime_3_hours", 0)),
				"leave_hours": flt(getattr(attendance, "leave_hours", 0)),
				"absent_hours": flt(getattr(attendance, "absent_hours", 0)),
				"large_night_shift_count": flt(getattr(attendance, "large_night_shift_count", 0)),
				"small_night_shift_count": flt(getattr(attendance, "small_night_shift_count", 0)),
				"apple_reward_amount": apple_reward_amount,
				"attendance_full_deduction": flt(getattr(attendance, "full_attendance_deduction", 0)),
				"full_attendance_bonus": full_attendance_bonus,
				"housing_subsidy": values["住房补贴"],
				"education_subsidy": values["学历补贴"],
				"dormitory_deduction": values["宿舍扣款"],
				"social_security_personal": values["社保个人"],
				"housing_fund_personal": values["公积金个人"],
				"other_bonus": values["其他奖金"],
				"other_deduction": values["其他扣款"],
				"preliminary_earning_total": earnings,
				"preliminary_deduction_total": deductions,
				"settlement_status": "待结算",
				"source_trace_json": trace,
				"source_hash": source_hash,
			}
		)
		doc.insert(ignore_permissions=True)
		created.append(doc.name)

	frappe.db.commit()
	return {"created": len(created), "records": created}


@frappe.whitelist()
def list_payroll_variable_records(company: str, payroll_month: str = "", import_batch: str = "", attendance_lock_version: str = "", page_length: int = 50):
	company = _require_company(company)
	filters = {"company": company}
	if payroll_month:
		filters["payroll_month"] = payroll_month
	if attendance_lock_version:
		filters["attendance_lock_version"] = attendance_lock_version
	if import_batch:
		filters["import_batch"] = import_batch
	return frappe.get_all(VARIABLE_RECORD_DOCTYPE, filters=filters, fields=["*"], order_by="modified desc", limit_page_length=int(page_length or 50))


@frappe.whitelist()
def list_payroll_input_records(company: str, payroll_month: str = "", attendance_lock_version: str = "", page_length: int = 50):
	company = _require_company(company)
	filters = {"company": company}
	if payroll_month:
		filters["payroll_month"] = payroll_month
	if attendance_lock_version:
		filters["attendance_lock_version"] = attendance_lock_version
	return frappe.get_all(PAYROLL_INPUT_DOCTYPE, filters=filters, fields=["*"], order_by="modified desc", limit_page_length=int(page_length or 50))


def _rate(amount, divisor=PAYROLL_STANDARD_HOURS_DIVISOR):
	return flt(amount) / flt(divisor) if flt(amount) and flt(divisor) else 0


def _money(value):
	return flt(value, 2)


def _company_social_security(personal_amount, rule=None):
	if rule:
		return _company_social_security_from_rule(personal_amount, rule)
	amount = flt(personal_amount)
	if amount <= 0 or amount < 524.96:
		return 0
	if amount == 524.96:
		return 1256.82
	if 520 < amount < 531:
		return 1269
	if 531 < amount < 636:
		return 1522.8
	if amount > 636:
		return 1649.7
	return 0


@frappe.whitelist()
def generate_payroll_settlement_records(company: str, payroll_month: str, attendance_lock_version: str):
	company, payroll_month, attendance_lock_version = _require_payroll_scope(company, payroll_month, attendance_lock_version)
	calculation_rules = _payroll_calculation_rules(company, payroll_month)
	payroll_formulas = _effective_payroll_formulas(company, payroll_month)
	settlement_filters = _payroll_scope_filters(company, payroll_month, attendance_lock_version)
	locked = frappe.get_all(PAYROLL_SETTLEMENT_DOCTYPE, filters={**settlement_filters, "calculation_status": ["in", ["已确认", "已生成工资单"]]}, pluck="name")
	if locked:
		frappe.throw(_("公司 {0} 月份 {1} 锁定版本 {2} 已存在锁定薪资结算，不允许覆盖。").format(company, payroll_month, attendance_lock_version))

	variables, variable_identity, variable_sources = _variable_totals(company, payroll_month, attendance_lock_version)
	input_rows = frappe.get_all(PAYROLL_INPUT_DOCTYPE, filters=_payroll_scope_filters(company, payroll_month, attendance_lock_version), fields=["*"])
	if not input_rows:
		frappe.throw(_("未找到公司 {0}、月份 {1}、锁定版本 {2} 的薪资输入表。").format(company, payroll_month, attendance_lock_version))
	input_by_key = {}
	for row in input_rows:
		_assert_row_company(row, company, _("薪资输入表"))
		key = _employee_identity_key(row)
		if not key:
			frappe.throw(_("薪资输入表存在无法识别员工的记录。"))
		if key in input_by_key:
			frappe.throw(_("薪资输入表存在重复员工：{0}").format(key))
		input_by_key[key] = row

	extra_variable_keys = sorted(set(variable_identity) - set(input_by_key))
	if extra_variable_keys:
		frappe.throw(_("薪资变量存在未匹配薪资输入表的员工：{0}").format(", ".join(extra_variable_keys[:10])))
	active_salary_changes = _active_salary_changes_for_month(company, payroll_month)
	missing_salary_profiles = []
	trial_salary_profiles = []
	for key, input_row in input_by_key.items():
		profile = (
			active_salary_changes.get(getattr(input_row, "employee", None))
			or active_salary_changes.get(getattr(input_row, "employee_code", None))
			or active_salary_changes.get(getattr(input_row, "employee_name", None))
		)
		if not profile:
			missing_salary_profiles.append(getattr(input_row, "employee_code", None) or getattr(input_row, "employee_name", None) or key)
		elif _is_trial_salary_change(profile):
			trial_salary_profiles.append(getattr(input_row, "employee_code", None) or getattr(input_row, "employee_name", None) or key)
	if missing_salary_profiles:
		frappe.throw(_("无法试算：以下员工缺少本月有效且已批准的薪资异动：{0}").format(", ".join(missing_salary_profiles[:10])))
	if trial_salary_profiles and company != LOCAL_PAYROLL_TEST_COMPANY:
		frappe.throw(
			_("无法试算：以下员工仍使用本地试运营/测试薪资数据，请先导入并批准正式薪资异动：{0}").format(
				", ".join(trial_salary_profiles[:10])
			)
		)

	for name in frappe.get_all(PAYROLL_SETTLEMENT_DOCTYPE, filters=settlement_filters, pluck="name"):
		frappe.delete_doc(PAYROLL_SETTLEMENT_DOCTYPE, name, ignore_permissions=True, force=True)

	created = []
	for key in sorted(k for k in input_by_key if k):
		input_row = input_by_key.get(key)
		source = input_row
		values = defaultdict(float, variables.get(key, {}))
		salary_change = get_active_salary_change_for_employee(
			employee=getattr(source, "employee", None),
			employee_code=getattr(source, "employee_code", ""),
			payroll_month=payroll_month,
			company=company,
		) or {}

		base_salary = values["底薪"] or flt(salary_change.get("base_salary"))
		function_allowance = values["职能津贴"] or values["职务津贴"] or flt(salary_change.get("function_allowance"))
		certificate_skill_allowance = values["证书及多能工津贴"] or values["证书津贴"] + values["多能工津贴"] or flt(salary_change.get("certificate_allowance")) + flt(salary_change.get("multi_skill_allowance"))
		formula_context = {
			"base_salary": base_salary,
			"function_allowance": function_allowance,
			"certificate_skill_allowance": certificate_skill_allowance,
			"standard_hours": flt(getattr(input_row, "standard_hours", 0)),
			"basic_attendance_hours": flt(getattr(input_row, "actual_attendance_hours", 0)),
			"raw_weekend_overtime_hours": flt(getattr(input_row, "overtime_2_hours", 0)),
			"weekday_overtime_hours": flt(getattr(input_row, "overtime_1_5_hours", 0)),
			"holiday_overtime_hours": flt(getattr(input_row, "overtime_3_hours", 0)),
			"large_night_shift_count": flt(getattr(input_row, "large_night_shift_count", 0)),
			"small_night_shift_count": flt(getattr(input_row, "small_night_shift_count", 0)),
			"absenteeism_hours": flt(getattr(input_row, "absent_hours", 0)),
			"proposal_improvement_bonus": values["提案改善奖"],
			"apple_reward_amount": flt(getattr(input_row, "apple_reward_amount", 0)),
			"full_attendance_bonus": flt(getattr(input_row, "full_attendance_bonus", 0)),
			"housing_subsidy": flt(getattr(input_row, "housing_subsidy", 0)),
			"education_subsidy": flt(getattr(input_row, "education_subsidy", 0)),
			"other_bonus": flt(getattr(input_row, "other_bonus", 0)),
			"production_bonus": values["生产奖"],
			"late_full_attendance_deduction": values["迟到金额+全勤奖扣款"] or flt(getattr(input_row, "attendance_full_deduction", 0)),
			"other_deduction": flt(getattr(input_row, "other_deduction", 0)),
			"social_security_personal": flt(getattr(input_row, "social_security_personal", 0)),
			"housing_fund_personal": flt(getattr(input_row, "housing_fund_personal", 0)),
			"paid_proposal_birthday_welfare": values["已发福利"],
			"continuing_service_bonus": values["继续服务奖"],
			"income_tax": values["所得税"],
			"year_end_bonus_tax": values["年终奖所得税"],
			"utilities_deduction": _money(values["水电费及扣款"] + flt(getattr(input_row, "dormitory_deduction", 0))),
			"manual_social_security_company": values["社保公司"],
			"manual_housing_fund_company": values["公积金公司"],
		}
		try:
			calculated, formula_trace = evaluate_formula_set(payroll_formulas, formula_context)
		except FormulaError as exc:
			frappe.throw(_("员工 {0} 薪资公式执行失败：{1}").format(getattr(source, "employee_name", key), exc))
		# Explicit local names keep the settlement document construction readable.
		salary_subtotal = calculated["salary_subtotal"]
		standard_hours = formula_context["standard_hours"]
		basic_attendance_hours = formula_context["basic_attendance_hours"]
		raw_weekend_overtime_hours = formula_context["raw_weekend_overtime_hours"]
		weekday_overtime_hours = formula_context["weekday_overtime_hours"]
		holiday_overtime_hours = formula_context["holiday_overtime_hours"]
		large_night_shift_count = formula_context["large_night_shift_count"]
		small_night_shift_count = formula_context["small_night_shift_count"]
		absenteeism_hours = formula_context["absenteeism_hours"]
		proposal_improvement_bonus = formula_context["proposal_improvement_bonus"]
		apple_reward_amount = formula_context["apple_reward_amount"]
		production_bonus = formula_context["production_bonus"]
		late_full_attendance_deduction = formula_context["late_full_attendance_deduction"]
		social_security_personal = formula_context["social_security_personal"]
		housing_fund_personal = formula_context["housing_fund_personal"]
		paid_proposal_birthday_welfare = formula_context["paid_proposal_birthday_welfare"]
		continuing_service_bonus = formula_context["continuing_service_bonus"]
		income_tax = formula_context["income_tax"]
		year_end_bonus_tax = formula_context["year_end_bonus_tax"]
		utilities_deduction = formula_context["utilities_deduction"]
		missing_hours = calculated["missing_hours"]
		adjusted_absence_hours = calculated["adjusted_absence_hours"]
		weekend_overtime_hours = calculated["weekend_overtime_hours"]
		full_salary_hourly_rate = calculated["full_salary_hourly_rate"]
		base_salary_hourly_rate = calculated["base_salary_hourly_rate"]
		absence_deduction_amount = calculated["absence_deduction_amount"]
		weekday_overtime_pay = calculated["weekday_overtime_pay"]
		weekend_overtime_pay = calculated["weekend_overtime_pay"]
		holiday_overtime_pay = calculated["holiday_overtime_pay"]
		overtime_pay_total = calculated["overtime_pay_total"]
		night_shift_allowance = calculated["night_shift_allowance"]
		subsidy_bonus_total = calculated["subsidy_bonus_total"]
		bonus_total = calculated["bonus_total"]
		absenteeism_deduction = calculated["absenteeism_deduction"]
		punishment_total = calculated["punishment_total"]
		attendance_wage = calculated["attendance_wage"]
		gross_pay = calculated["gross_pay"]
		taxable_salary = calculated["taxable_salary"]
		net_pay = calculated["net_pay"]
		social_security_company = calculated["social_security_company"]
		housing_fund_company = calculated["housing_fund_company"]
		company_cost_total = calculated["company_cost_total"]
		export_tax_adjusted_net_pay = calculated["export_tax_adjusted_net_pay"]
		trace, source_hash = _source_trace_hash({
			"company": company,
			"payroll_month": payroll_month,
			"attendance_lock_version": attendance_lock_version,
			"payroll_input_record": getattr(input_row, "name", ""),
			"variable_records": variable_sources.get(key, []),
			"salary_change": salary_change.get("name") if salary_change else "",
			"calculation_rules": calculation_rules,
			"formula_trace": formula_trace,
			"salary_subtotal_source": "公司公式：底薪、职能津贴、证书及多能工津贴",
		})

		doc = frappe.get_doc(
			{
				"doctype": PAYROLL_SETTLEMENT_DOCTYPE,
				"company": company,
				"payroll_month": payroll_month,
				"attendance_lock_version": attendance_lock_version,
				"employee": getattr(source, "employee", None),
				"employee_code": getattr(source, "employee_code", ""),
				"employee_name": getattr(source, "employee_name", ""),
				"department": getattr(source, "department", None),
				"base_salary": base_salary,
				"function_allowance": function_allowance,
				"certificate_skill_allowance": certificate_skill_allowance,
				"salary_subtotal": salary_subtotal,
				"standard_hours": standard_hours,
				"basic_attendance_hours": basic_attendance_hours,
				"missing_hours": missing_hours,
				"raw_weekend_overtime_hours": raw_weekend_overtime_hours,
				"adjusted_absence_hours": adjusted_absence_hours,
				"absence_deduction_amount": absence_deduction_amount,
				"weekday_overtime_hours": weekday_overtime_hours,
				"weekend_overtime_hours": weekend_overtime_hours,
				"holiday_overtime_hours": holiday_overtime_hours,
				"full_salary_hourly_rate": full_salary_hourly_rate,
				"base_salary_hourly_rate": base_salary_hourly_rate,
				"weekday_overtime_pay": weekday_overtime_pay,
				"weekend_overtime_pay": weekend_overtime_pay,
				"holiday_overtime_pay": holiday_overtime_pay,
				"overtime_pay_total": overtime_pay_total,
				"large_night_shift_count": large_night_shift_count,
				"small_night_shift_count": small_night_shift_count,
				"night_shift_allowance": night_shift_allowance,
				"attendance_wage": attendance_wage,
				"proposal_improvement_bonus": proposal_improvement_bonus,
				"apple_reward_amount": apple_reward_amount,
				"subsidy_bonus_total": subsidy_bonus_total,
				"production_bonus": production_bonus,
				"bonus_total": bonus_total,
				"absenteeism_hours": absenteeism_hours,
				"absenteeism_deduction": absenteeism_deduction,
				"late_full_attendance_deduction": late_full_attendance_deduction,
				"punishment_total": punishment_total,
				"gross_pay": gross_pay,
				"social_security_personal": social_security_personal,
				"housing_fund_personal": housing_fund_personal,
				"paid_proposal_birthday_welfare": paid_proposal_birthday_welfare,
				"taxable_salary": taxable_salary,
				"continuing_service_bonus": continuing_service_bonus,
				"income_tax": income_tax,
				"year_end_bonus_tax": year_end_bonus_tax,
				"utilities_deduction": utilities_deduction,
				"net_pay": net_pay,
				"social_security_company": social_security_company,
				"housing_fund_company": housing_fund_company,
				"company_cost_total": company_cost_total,
				"export_tax_adjusted_net_pay": export_tax_adjusted_net_pay,
				"calculation_status": "已生成",
				"source_trace_json": trace,
				"source_hash": source_hash,
			}
		)
		doc.insert(ignore_permissions=True)
		created.append(doc.name)

	frappe.db.commit()
	return {"created": len(created), "records": created}


@frappe.whitelist()
def list_payroll_settlement_records(company: str, payroll_month: str = "", attendance_lock_version: str = "", page_length: int = 50):
	company = _require_company(company)
	filters = {"company": company}
	if payroll_month:
		filters["payroll_month"] = payroll_month
	if attendance_lock_version:
		filters["attendance_lock_version"] = attendance_lock_version
	return frappe.get_all(PAYROLL_SETTLEMENT_DOCTYPE, filters=filters, fields=["*"], order_by="modified desc", limit_page_length=int(page_length or 50))


def _latest_salary_change_map(payroll_month="", company=""):
	company = _require_company(company)
	# A draft or a rejected adjustment must never become the payroll source simply
	# because it is newer than the last approved one.
	filters = {"company": company, "status": "已批准"}
	month_end = _month_end(payroll_month)
	if month_end:
		filters["effective_date"] = ["<=", month_end]
	rows = frappe.get_all(
		EMPLOYEE_SALARY_CHANGE_DOCTYPE,
		filters=filters,
		fields=["*"],
		order_by="effective_date desc, modified desc",
		limit_page_length=100000,
	)
	by_key = {}
	for row in rows:
		for key in (row.employee, row.employee_code, row.employee_name):
			if key and key not in by_key:
				by_key[key] = row
	return by_key


def _is_trial_salary_change(row):
	"""Return true for the deliberately seeded/local trial salary values.

	This is a guardrail, not a financial rule.  Trial values are allowed in local
	testing, but a payroll operator must replace them with an approved real salary
	change before a formal run.
	"""
	text = " ".join(
		[
			_text(row.get("change_reason")),
			_text(row.get("remarks")),
			_text(row.get("source_file")),
		]
	).upper()
	return any(marker in text for marker in ("TEST", "试运营", "本地试运行", "本地试运营", "DEMO", "SEED"))


def _active_salary_structure_versions(payroll_month=""):
	"""Return enabled versions that cover the selected payroll month."""
	month_end = _month_end(payroll_month)
	versions = frappe.get_all(
		SALARY_STRUCTURE_VERSION_DOCTYPE,
		filters={"status": "已启用"},
		fields=["name", "structure_version", "effective_from", "effective_to", "source_file"],
		order_by="effective_from desc, modified desc",
		limit_page_length=1000,
	)
	if not month_end:
		return versions
	return [
		version
		for version in versions
		if (not version.effective_from or str(version.effective_from) <= month_end)
		and (not version.effective_to or str(version.effective_to) >= month_end)
	]


@frappe.whitelist()
def get_salary_architecture_workbench(company: str, payroll_month: str = ""):
	"""Return the operational readiness view for the salary architecture tab.

	The page uses this to show the exact gap between imported salary structures,
	employee salary decisions and the payroll calculation, instead of implying that
	a visible "salary" value is automatically eligible for payment.
	"""
	company = _require_company(company)
	month_end = _month_end(payroll_month)
	employee_filters = {"company": company} if _doctype_has_field("Employee", "company") else {}
	if _doctype_has_field("Employee", "status"):
		employee_filters["status"] = "Active"
	employee_fields = _safe_fields("Employee", ["name", "employee_name", "employee_number", "custom_employee_code", "department", "designation"])
	employees = _safe_get_all("Employee", filters=employee_filters, fields=employee_fields, order_by="employee_name asc", limit_page_length=100000)
	approved_changes = _latest_salary_change_map(payroll_month, company)
	all_changes = frappe.get_all(
		EMPLOYEE_SALARY_CHANGE_DOCTYPE,
		filters={"company": company},
		fields=["name", "employee", "employee_code", "employee_name", "effective_date", "status", "change_reason", "remarks", "source_file"],
		order_by="effective_date desc, modified desc",
		limit_page_length=100000,
	)

	missing_profiles = []
	trial_profiles = []
	for employee in employees:
		code = _employee_code(employee)
		change = approved_changes.get(employee.name) or approved_changes.get(code) or approved_changes.get(employee.get("employee_name"))
		profile = {
			"employee": employee.name,
			"employee_name": employee.get("employee_name") or employee.name,
			"employee_code": code,
			"department": employee.get("department"),
			"designation": employee.get("designation"),
		}
		if not change:
			missing_profiles.append(profile)
		elif _is_trial_salary_change(change):
			profile.update({"salary_change": change.get("name"), "effective_date": change.get("effective_date")})
			trial_profiles.append(profile)

	pending_changes = [row for row in all_changes if row.get("status") in ("草稿", "待审核")]
	versions = _active_salary_structure_versions(payroll_month)
	version_names = [row.name for row in versions]
	grade_count = _safe_count(SALARY_GRADE_DOCTYPE, {"salary_structure_version": ["in", version_names]}) if version_names else 0
	enabled_rule_count = _safe_count(PAYROLL_RULE_DOCTYPE, {"company": company, "status": "已启用"})
	formula_count = _safe_count(PAYROLL_RULE_DOCTYPE, {"company": company, "rule_code": ["like", "FORMULA_%"], "status": "已启用"})
	mapping_count = _safe_count(PAYROLL_FIELD_MAPPING_DOCTYPE, {"status": "已启用"})
	standard_template_filters = {}
	if _doctype_has_field("Salary Structure", "company"):
		standard_template_filters["company"] = company
	if _doctype_has_field("Salary Structure", "is_active"):
		standard_template_filters["is_active"] = 1
	standard_template_count = _safe_count("Salary Structure", standard_template_filters)
	standard_assignment_filters = {}
	if _doctype_has_field("Salary Structure Assignment", "company"):
		standard_assignment_filters["company"] = company
	if _doctype_has_field("Salary Structure Assignment", "docstatus"):
		standard_assignment_filters["docstatus"] = 1
	month_end = _month_end(payroll_month)
	if month_end and _doctype_has_field("Salary Structure Assignment", "from_date"):
		standard_assignment_filters["from_date"] = ["<=", month_end]
	standard_assignment_count = _safe_count("Salary Structure Assignment", standard_assignment_filters)
	approved_count = len(employees) - len(missing_profiles)
	coverage_percent = round((approved_count / len(employees) * 100), 1) if employees else 0

	stages = [
		{
			"key": "employee",
			"title": "员工基础资料",
			"status": "已就绪" if employees else "待维护",
			"tone": "ready" if employees else "blocked",
			"count": len(employees),
			"unit": "人",
			"detail": "员工花名册必须包含公司、工号、姓名、部门、岗位、在职状态和入职/转正信息。",
		},
		{
			"key": "structure",
			"title": "薪资架构版本",
			"status": "已就绪" if versions and grade_count else "待配置",
			"tone": "ready" if versions and grade_count else "warning",
			"count": grade_count,
			"unit": "个薪资档位",
			"detail": "已启用且适用于当前月份的薪资架构版本。" if versions else "请先导入并启用薪资架构表。",
		},
		{
			"key": "rules",
			"title": "薪资规则与字段",
			"status": "已连接" if enabled_rule_count and formula_count and mapping_count else "待配置",
			"tone": "ready" if enabled_rule_count and formula_count and mapping_count else "warning",
			"count": formula_count,
			"unit": "个公式",
			"detail": "结算字段映射、加班/扣款规则和公式必须启用；否则只能展示数据，不能形成可信结算。",
		},
		{
			"key": "profile",
			"title": "员工定薪覆盖",
			"status": "已覆盖" if not missing_profiles else "待补齐",
			"tone": "ready" if not missing_profiles else "warning",
			"count": approved_count,
			"unit": f" / {len(employees)} 人",
			"detail": "仅统计已批准且生效日期不晚于当前算薪月份的薪资异动。",
		},
		{
			"key": "approval",
			"title": "待审核异动",
			"status": "无待审" if not pending_changes else "待处理",
			"tone": "ready" if not pending_changes else "pending",
			"count": len(pending_changes),
			"unit": "条",
			"detail": "草稿或待审核记录不会进入正式薪资试算。",
		},
		{
			"key": "trial",
			"title": "试运营值检查",
			"status": "可用于正式算薪" if not trial_profiles else "需要替换",
			"tone": "ready" if not trial_profiles else "blocked",
			"count": len(trial_profiles),
			"unit": "人",
			"detail": "本地试运营或测试工资值不能作为正式发薪依据。",
		},
	]
	return {
		"company": company,
		"payroll_month": payroll_month,
		"coverage": {"active_employee_count": len(employees), "approved_profile_count": approved_count, "missing_profile_count": len(missing_profiles), "coverage_percent": coverage_percent},
		"rules": {"enabled_rule_count": enabled_rule_count, "formula_count": formula_count, "mapping_count": mapping_count},
		"standard_payroll": {"template_count": standard_template_count, "assignment_count": standard_assignment_count},
		"stages": stages,
		"active_versions": versions,
		"missing_profiles": missing_profiles[:100],
		"trial_profiles": trial_profiles[:100],
		"pending_changes": pending_changes[:100],
	}


def _settlement_map(payroll_month="", company="", attendance_lock_version=""):
	company = _require_company(company)
	filters = {"company": company}
	if payroll_month:
		filters["payroll_month"] = payroll_month
	if attendance_lock_version:
		filters["attendance_lock_version"] = attendance_lock_version
	rows = frappe.get_all(PAYROLL_SETTLEMENT_DOCTYPE, filters=filters, fields=["*"], limit_page_length=100000)
	by_key = {}
	for row in rows:
		for key in (row.employee, row.employee_code, row.employee_name):
			if key and key not in by_key:
				by_key[key] = row
	return by_key


def _status_label(row):
	status = row.get("status") or ""
	if status == "Active":
		return "在职"
	if status == "Left":
		return "已离职"
	if status == "Inactive":
		return "待离职"
	return status or "未维护"


def _employment_stage(row, month_end=""):
	employment_type = row.get("employment_type") or ""
	if "试用" in employment_type or "Probation" in employment_type:
		return "试用"
	confirmation_date = row.get("final_confirmation_date") or row.get("confirmation_date")
	if confirmation_date and month_end and str(confirmation_date) > month_end:
		return "试用"
	if confirmation_date and (not month_end or str(confirmation_date) <= month_end):
		return "正式"
	if row.get("status") == "Active":
		return "正式"
	return _status_label(row)


@frappe.whitelist()
def list_employee_salary_profiles(company: str, payroll_month: str = "", attendance_lock_version: str = "", page_length: int = 100):
	company = _require_company(company)
	employee_fields = _safe_fields(
		"Employee",
		[
			"name",
			"employee_name",
			"employee_number",
			"custom_employee_code",
			"department",
			"designation",
			"employment_type",
			"status",
			"date_of_joining",
			"final_confirmation_date",
			"confirmation_date",
			"relieving_date",
			"company",
		],
	)
	employee_filters = {"company": company} if _doctype_has_field("Employee", "company") else {}
	employees = _safe_get_all("Employee", filters=employee_filters, fields=employee_fields, order_by="employee_name asc", limit_page_length=100000)
	salary_changes = _latest_salary_change_map(payroll_month, company)
	settlements = _settlement_map(payroll_month, company, attendance_lock_version)
	month_end = _month_end(payroll_month)
	rows = []
	counts = {"active": 0, "regular": 0, "probation": 0, "pending_exit": 0}

	for employee in employees:
		code = _employee_code(employee)
		change = salary_changes.get(employee.name) or salary_changes.get(code) or salary_changes.get(employee.get("employee_name")) or frappe._dict()
		settlement = settlements.get(employee.name) or settlements.get(code) or settlements.get(employee.get("employee_name")) or frappe._dict()
		status_label = _status_label(employee)
		stage = _employment_stage(employee, month_end)
		if employee.get("status") == "Active" or status_label == "在职":
			counts["active"] += 1
		if stage == "正式":
			counts["regular"] += 1
		if stage == "试用":
			counts["probation"] += 1
		if employee.get("relieving_date") or status_label == "待离职":
			counts["pending_exit"] += 1

	for employee in employees[: int(page_length or 100)]:
		code = _employee_code(employee)
		change = salary_changes.get(employee.name) or salary_changes.get(code) or salary_changes.get(employee.get("employee_name")) or frappe._dict()
		settlement = settlements.get(employee.name) or settlements.get(code) or settlements.get(employee.get("employee_name")) or frappe._dict()
		status_label = _status_label(employee)
		stage = _employment_stage(employee, month_end)

		salary_risk = ""
		if status_label == "在职" and not change:
			salary_risk = "缺少已批准的薪资异动"
		elif change and _is_trial_salary_change(change):
			salary_risk = "当前为试运营测试值，不可用于正式发薪"

		rows.append(
			{
				"employee": employee.name,
				"employee_name": employee.get("employee_name") or employee.name,
				"employee_code": code,
				"department": employee.get("department") or change.get("department") or settlement.get("department"),
				"designation": employee.get("designation") or change.get("designation"),
				"employment_type": employee.get("employment_type") or stage,
				"employee_status": status_label,
				"fixed_salary": flt(change.get("base_salary")) or flt(settlement.get("base_salary")),
				"total_salary": flt(change.get("full_salary")) or flt(settlement.get("salary_subtotal")),
				"date_of_joining": employee.get("date_of_joining") or change.get("date_of_joining"),
				"confirmation_date": employee.get("final_confirmation_date") or employee.get("confirmation_date"),
				"latest_adjustment_date": change.get("effective_date"),
				"adjustment_reason": change.get("change_reason"),
				"salary_grade": change.get("salary_grade"),
				"salary_change_status": change.get("status") or ("已批准" if change else "未维护"),
				"salary_risk": salary_risk,
				"salary_source": change.get("name") or settlement.get("name") or "",
				"settlement_status": settlement.get("calculation_status") or "未结算",
			}
		)

	return {"counts": counts, "rows": rows}


@frappe.whitelist()
def list_monthly_payroll_overview(company: str, payroll_month: str = "", attendance_lock_version: str = ""):
	company = _require_company(company)
	employee_filters = {"company": company} if _doctype_has_field("Employee", "company") else {}
	if _doctype_has_field("Employee", "status"):
		employee_filters["status"] = "Active"
	employee_count = _safe_count("Employee", employee_filters)
	attendance_filters = {"company": company}
	input_filters = {"company": company}
	settlement_filters = {"company": company}
	variable_filters = {"company": company}
	welfare_filters = {"company": company}
	if payroll_month:
		attendance_filters["attendance_month"] = payroll_month
		input_filters["payroll_month"] = payroll_month
		settlement_filters["payroll_month"] = payroll_month
		variable_filters["payroll_month"] = payroll_month
		welfare_filters["payroll_month"] = payroll_month
	if attendance_lock_version:
		attendance_filters["attendance_lock_version"] = attendance_lock_version
		attendance_filters["lock_status"] = "已锁定"
		input_filters["attendance_lock_version"] = attendance_lock_version
		settlement_filters["attendance_lock_version"] = attendance_lock_version
		variable_filters["attendance_lock_version"] = attendance_lock_version
		welfare_filters["attendance_lock_version"] = attendance_lock_version
	attendance_count = _safe_count(MONTHLY_ATTENDANCE_DOCTYPE, attendance_filters)
	input_count = _safe_count(PAYROLL_INPUT_DOCTYPE, input_filters)
	settlement_count = _safe_count(PAYROLL_SETTLEMENT_DOCTYPE, settlement_filters)
	variable_count = _safe_count(VARIABLE_RECORD_DOCTYPE, variable_filters)
	welfare_count = _safe_count(WELFARE_SOURCE_DOCTYPE, welfare_filters)
	settlements = frappe.get_all(PAYROLL_SETTLEMENT_DOCTYPE, filters=settlement_filters, fields=["gross_pay", "net_pay", "company_cost_total"]) if payroll_month else []
	gross_total = sum(flt(row.gross_pay) for row in settlements)
	net_total = sum(flt(row.net_pay) for row in settlements)
	company_cost_total = sum(flt(row.company_cost_total) for row in settlements)
	coverage = round(settlement_count / employee_count * 100, 2) if employee_count else 0
	return {
		"cards": [
			{"label": "在职员工", "value": employee_count},
			{"label": "考勤终稿", "value": attendance_count},
			{"label": "薪资输入表", "value": input_count},
			{"label": "薪资结算表", "value": settlement_count},
			{"label": "变量记录", "value": variable_count},
			{"label": "福利扣款来源", "value": welfare_count},
			{"label": "结算覆盖率", "value": f"{coverage}%"},
			{"label": "公司实际负担总计", "value": round(company_cost_total, 2)},
		],
		"totals": {"gross_pay": round(gross_total, 2), "net_pay": round(net_total, 2), "company_cost_total": round(company_cost_total, 2)},
	}


def _active_salary_changes_for_month(company, payroll_month):
	filters = {"company": _require_company(company), "status": "已批准"}
	month_end = _month_end(payroll_month)
	if month_end:
		filters["effective_date"] = ["<=", month_end]
	rows = frappe.get_all(
		EMPLOYEE_SALARY_CHANGE_DOCTYPE,
		filters=filters,
		fields=[
			"name",
			"employee",
			"employee_code",
			"employee_name",
			"effective_date",
			"full_salary",
			"change_reason",
			"remarks",
			"source_file",
		],
		order_by="effective_date desc, modified desc",
		limit_page_length=100000,
	)
	by_key = {}
	for row in rows:
		for key in (row.employee, row.employee_code, row.employee_name):
			if key and key not in by_key:
				by_key[key] = row
	return by_key


@frappe.whitelist()
def get_payroll_month_runbook(company: str, payroll_month: str, attendance_lock_version: str):
	"""Return the controlled monthly payroll checklist for one company/month/attendance lock."""
	company, payroll_month, attendance_lock_version = _require_payroll_scope(company, payroll_month, attendance_lock_version)
	attendance_rows = frappe.get_all(
		MONTHLY_ATTENDANCE_DOCTYPE,
		filters=_attendance_scope_filters(company, payroll_month, attendance_lock_version),
		fields=["name", "employee", "employee_code", "employee_name"],
		limit_page_length=100000,
	)
	active_changes = _active_salary_changes_for_month(company, payroll_month)
	missing_salary_profiles = []
	trial_salary_profiles = []
	for row in attendance_rows:
		keys = (row.employee, row.employee_code, row.employee_name)
		profile = next((active_changes[key] for key in keys if key and key in active_changes), None)
		if not profile:
			missing_salary_profiles.append(row.employee_code or row.employee_name or row.name)
		elif _is_trial_salary_change(profile):
			trial_salary_profiles.append(row.employee_code or row.employee_name or row.name)

	scope_filters = _payroll_scope_filters(company, payroll_month, attendance_lock_version)
	input_count = _safe_count(PAYROLL_INPUT_DOCTYPE, scope_filters)
	settlement_count = _safe_count(PAYROLL_SETTLEMENT_DOCTYPE, scope_filters)
	confirmed_settlement_count = _safe_count(PAYROLL_SETTLEMENT_DOCTYPE, {**scope_filters, "calculation_status": "已确认"})
	variable_count = _safe_count(VARIABLE_RECORD_DOCTYPE, scope_filters)
	confirmed_welfare_count = _safe_count(WELFARE_SOURCE_DOCTYPE, {**scope_filters, "confirmation_status": "已确认", "eligibility_status": "符合"})
	pending_welfare_count = _safe_count(WELFARE_SOURCE_DOCTYPE, {**scope_filters, "confirmation_status": ["in", ["草稿", "待确认"]]})
	employee_filters = {"company": company} if _doctype_has_field("Employee", "company") else {}
	if _doctype_has_field("Employee", "status"):
		employee_filters["status"] = "Active"
	employee_count = _safe_count("Employee", employee_filters)
	enabled_rule_count = _safe_count(PAYROLL_RULE_DOCTYPE, {"company": company, "status": "已启用"})
	formula_count = _safe_count(PAYROLL_RULE_DOCTYPE, {"company": company, "rule_code": ["like", "FORMULA_%"], "status": "已启用"})
	mapping_count = _safe_count(PAYROLL_FIELD_MAPPING_DOCTYPE, {"status": "已启用"})
	standard_template_filters = {}
	if _doctype_has_field("Salary Structure", "company"):
		standard_template_filters["company"] = company
	if _doctype_has_field("Salary Structure", "is_active"):
		standard_template_filters["is_active"] = 1
	standard_template_count = _safe_count("Salary Structure", standard_template_filters)
	standard_assignment_filters = {}
	if _doctype_has_field("Salary Structure Assignment", "company"):
		standard_assignment_filters["company"] = company
	if _doctype_has_field("Salary Structure Assignment", "docstatus"):
		standard_assignment_filters["docstatus"] = 1
	month_end = _month_end(payroll_month)
	if month_end and _doctype_has_field("Salary Structure Assignment", "from_date"):
		standard_assignment_filters["from_date"] = ["<=", month_end]
	standard_assignment_count = _safe_count("Salary Structure Assignment", standard_assignment_filters)

	def stage(title, summary, count, status, tone, route, action_label, detail=""):
		return {
			"title": title,
			"summary": summary,
			"count": count,
			"unit": " 条",
			"status": status,
			"tone": tone,
			"route": route,
			"action_label": action_label,
			"detail": detail,
		}

	attendance_count = len(attendance_rows)
	master_ready = attendance_count > 0 and not missing_salary_profiles and not trial_salary_profiles
	input_ready = attendance_count > 0 and master_ready and input_count == attendance_count
	settlement_ready = input_count > 0 and settlement_count == input_count
	stages = [
		stage(
			"薪资档案与异动",
			"每位进入考勤终稿的员工必须有当月有效的已批准薪资异动。",
			attendance_count - len(missing_salary_profiles) - len(trial_salary_profiles),
			"已就绪" if master_ready else "待补齐",
			"ready" if master_ready else "blocked",
			"salary-assignments",
			"处理员工分配",
			(
				"缺少 {0} 位员工的有效薪资异动；另有 {1} 位员工仍使用试运营/测试薪资。".format(
					len(missing_salary_profiles), len(trial_salary_profiles)
				)
				if missing_salary_profiles or trial_salary_profiles
				else "底薪、职能、证书/多能工与全薪从异动记录读取。"
			),
		),
		stage(
			"已锁定月度考勤终稿",
			"仅读取同公司、同月份、同锁定版本且状态为已锁定的考勤终稿。",
			attendance_count,
			"已就绪" if attendance_count else "待锁定",
			"ready" if attendance_count else "blocked",
			"data-closure",
			"查看考勤来源",
			"无锁定考勤时系统不能生成薪资输入表。",
		),
		stage(
			"月度变量与福利扣款",
			"奖金、补贴、宿舍水电、社保公积金、个税和离职结算按已确认来源进入变量。",
			variable_count + confirmed_welfare_count,
			"待复核" if pending_welfare_count else "已就绪",
			"warning" if pending_welfare_count else "ready",
			"welfare-sources",
			"维护月度变量",
			"已确认来源 {0} 条，待确认来源 {1} 条。".format(confirmed_welfare_count, pending_welfare_count),
		),
		stage(
			"生成薪资输入表",
			"将锁定考勤与月度变量按员工汇总，先核对工时、加班、苹果树和扣款。",
			input_count,
			"已生成" if input_ready else "待生成",
			"ready" if input_ready else "pending",
			"inputs",
			"查看输入表",
			"输入表需与锁定考勤人数一致。",
		),
		stage(
			"试算与差异复核",
			"按公司结算公式生成所有细项、应付工资、实发工资及公司实际负担。",
			settlement_count,
			"已试算" if settlement_ready else "待试算",
			"ready" if settlement_ready else "pending",
			"settlements",
			"查看结算表",
			"结算表必须与输入表人数一致；可展开显示全部字段及来源。",
		),
		stage(
			"确认与发放",
			"复核无差异后确认本次试算；确认后不得被重新生成覆盖。",
			confirmed_settlement_count,
			"已确认" if settlement_count and confirmed_settlement_count == settlement_count else "待确认",
			"ready" if settlement_count and confirmed_settlement_count == settlement_count else "pending",
			"payroll-disbursement",
			"复核与发放",
			"工资条和发放仅消费已确认的结算结果。",
		),
	]
	warnings = []
	if missing_salary_profiles:
		warnings.append("待补薪资异动：{0}".format("、".join(missing_salary_profiles[:10])))
	if trial_salary_profiles:
		warnings.append("待替换试运营/测试薪资：{0}".format("、".join(trial_salary_profiles[:10])))
	if pending_welfare_count:
		warnings.append("存在 {0} 条待确认福利/扣款来源".format(pending_welfare_count))
	if attendance_count and input_count and input_count != attendance_count:
		warnings.append("薪资输入表人数与锁定考勤不一致")
	if input_count and settlement_count and settlement_count != input_count:
		warnings.append("薪资结算表人数与薪资输入表不一致")
	process_steps = [
		{
			"key": "master",
			"title": "基础资料",
			"summary": "员工花名册必须有公司、工号、姓名、部门、岗位、状态和入职/转正信息。",
			"status": "已满足" if employee_count else "待维护",
			"tone": "ready" if employee_count else "blocked",
			"count": employee_count,
			"detail": "员工基础资料是薪资档案、考勤和变量匹配的主键来源。",
		},
		{
			"key": "items",
			"title": "薪酬项目",
			"summary": "底薪、津贴、考勤、奖金、扣款和公司成本需要有启用的规则或来源映射。",
			"status": "已满足" if enabled_rule_count and formula_count and mapping_count else "待配置",
			"tone": "ready" if enabled_rule_count and formula_count and mapping_count else "blocked",
			"count": enabled_rule_count,
			"detail": "缺规则时只能展示导入数据，不能形成可信试算。",
		},
		{
			"key": "templates",
			"title": "工资表模板",
			"summary": "必须建立当前公司已启用的标准 HRMS 工资表模板。",
			"status": "已满足" if standard_template_count else "待配置",
			"tone": "ready" if standard_template_count else "blocked",
			"count": standard_template_count,
			"detail": "模板组合应发、应扣和公司承担项，不保存员工实际金额。",
		},
		{
			"key": "assignments",
			"title": "员工分配",
			"summary": "进入考勤终稿的员工必须同时有有效模板分配和已批准定薪。",
			"status": "已满足" if master_ready and standard_assignment_count >= attendance_count else "待补齐",
			"tone": "ready" if master_ready and standard_assignment_count >= attendance_count else "blocked",
			"count": min(standard_assignment_count, attendance_count - len(missing_salary_profiles) - len(trial_salary_profiles)),
			"detail": "缺少模板分配、已批准定薪或仍使用试运营值时，系统拒绝生成薪资输入表。",
		},
		{
			"key": "sources",
			"title": "月度来源",
			"summary": "只读取同公司、同月份、同锁定版本的考勤终稿和已确认变量。",
			"status": "已满足" if attendance_count and not pending_welfare_count else ("待复核" if attendance_count else "缺考勤锁定"),
			"tone": "ready" if attendance_count and not pending_welfare_count else ("warning" if attendance_count else "blocked"),
			"count": attendance_count + variable_count + confirmed_welfare_count,
			"detail": "考勤未锁定或福利扣款待确认时，不能进入正式试算。",
		},
		{
			"key": "calculation",
			"title": "试算复核",
			"summary": "先生成薪资输入表，再生成薪资结算表并做差异复核。",
			"status": "已满足" if settlement_ready else ("已生成输入" if input_ready else "待生成"),
			"tone": "ready" if settlement_ready else ("warning" if input_ready else "pending"),
			"count": settlement_count or input_count,
			"detail": "输入表与结算表人数必须分别匹配锁定考勤和输入表。",
		},
		{
			"key": "delivery",
			"title": "报表发放",
			"summary": "复核确认后再进入工资发放、工资条和报表导出。",
			"status": "已满足" if settlement_count and confirmed_settlement_count == settlement_count else "待确认",
			"tone": "ready" if settlement_count and confirmed_settlement_count == settlement_count else "pending",
			"count": confirmed_settlement_count,
			"detail": "未确认结算结果不作为发放依据。",
		},
	]
	return {
		"scope": {"company": company, "payroll_month": payroll_month, "attendance_lock_version": attendance_lock_version},
		"cards": [
			{"label": "锁定考勤", "value": attendance_count},
			{"label": "有效薪资档案", "value": attendance_count - len(missing_salary_profiles) - len(trial_salary_profiles)},
			{"label": "确认变量来源", "value": variable_count + confirmed_welfare_count},
			{"label": "薪资输入表", "value": input_count},
			{"label": "薪资结算表", "value": settlement_count},
			{"label": "已确认结算", "value": confirmed_settlement_count},
		],
		"process_steps": process_steps,
		"stages": stages,
		"warning": "；".join(warnings),
	}


@frappe.whitelist()
def confirm_payroll_settlement_records(company: str, payroll_month: str, attendance_lock_version: str):
	"""Lock a reviewed payroll trial so later recalculation cannot overwrite it."""
	if not _can_manage_payroll_rules():
		frappe.throw(_("您没有确认薪资结算的权限"))
	company, payroll_month, attendance_lock_version = _require_payroll_scope(company, payroll_month, attendance_lock_version)
	scope_filters = _payroll_scope_filters(company, payroll_month, attendance_lock_version)
	attendance_count = _safe_count(MONTHLY_ATTENDANCE_DOCTYPE, _attendance_scope_filters(company, payroll_month, attendance_lock_version))
	input_count = _safe_count(PAYROLL_INPUT_DOCTYPE, scope_filters)
	settlement_count = _safe_count(PAYROLL_SETTLEMENT_DOCTYPE, scope_filters)
	pending_welfare_count = _safe_count(WELFARE_SOURCE_DOCTYPE, {**scope_filters, "confirmation_status": ["in", ["草稿", "待确认"]]})
	if not attendance_count:
		frappe.throw(_("未找到已锁定月度考勤终稿，不能确认薪资结算。"))
	if input_count != attendance_count or settlement_count != input_count:
		frappe.throw(_("薪资确认前，锁定考勤、薪资输入表和薪资结算表人数必须一致。"))
	if pending_welfare_count:
		frappe.throw(_("仍有 {0} 条福利/扣款来源待确认，不能确认薪资结算。").format(pending_welfare_count))
	for name in frappe.get_all(PAYROLL_SETTLEMENT_DOCTYPE, filters=scope_filters, pluck="name"):
		doc = frappe.get_doc(PAYROLL_SETTLEMENT_DOCTYPE, name)
		if doc.calculation_status not in ("已确认", "已生成工资单"):
			doc.calculation_status = "已确认"
			doc.save(ignore_permissions=True)
	frappe.db.commit()
	return {"confirmed": settlement_count, "company": company, "payroll_month": payroll_month, "attendance_lock_version": attendance_lock_version}


@frappe.whitelist()
def list_payroll_disbursement_records(company: str, payroll_month: str = "", attendance_lock_version: str = "", page_length: int = 100):
	company = _require_company(company)
	filters = {"company": company}
	if payroll_month:
		filters["payroll_month"] = payroll_month
	if attendance_lock_version:
		filters["attendance_lock_version"] = attendance_lock_version
	rows = frappe.get_all(
		PAYROLL_SETTLEMENT_DOCTYPE,
		filters=filters,
		fields=["employee", "employee_code", "employee_name", "department", "gross_pay", "net_pay", "company_cost_total", "calculation_status", "modified"],
		order_by="department asc, employee_name asc",
		limit_page_length=int(page_length or 100),
	)
	for row in rows:
		row["payment_status"] = "待发放" if row.get("calculation_status") in ("已确认", "已生成工资单") else "待结算"
		row["confirmation_status"] = "已确认" if row.get("calculation_status") in ("已确认", "已生成工资单") else "待确认"
	return rows


@frappe.whitelist()
def list_payroll_report_summary(company: str, payroll_month: str = "", attendance_lock_version: str = ""):
	company = _require_company(company)
	filters = {"company": company}
	if payroll_month:
		filters["payroll_month"] = payroll_month
	if attendance_lock_version:
		filters["attendance_lock_version"] = attendance_lock_version
	rows = frappe.get_all(
		PAYROLL_SETTLEMENT_DOCTYPE,
		filters=filters,
		fields=[
			"department",
			"gross_pay",
			"net_pay",
			"company_cost_total",
			"overtime_pay_total",
			"bonus_total",
			"punishment_total",
			"social_security_personal",
			"housing_fund_personal",
			"social_security_company",
			"housing_fund_company",
		],
		limit_page_length=100000,
	)
	summary = defaultdict(lambda: defaultdict(float))
	for row in rows:
		key = row.department or "未维护部门"
		summary[key]["headcount"] += 1
		for field in (
			"gross_pay",
			"net_pay",
			"company_cost_total",
			"overtime_pay_total",
			"bonus_total",
			"punishment_total",
			"social_security_personal",
			"housing_fund_personal",
			"social_security_company",
			"housing_fund_company",
		):
			summary[key][field] += flt(row.get(field))
	return [
		{"department": department, **{field: round(value, 2) for field, value in values.items()}}
		for department, values in sorted(summary.items(), key=lambda item: item[0])
	]


@frappe.whitelist()
def list_payroll_analysis(company: str, payroll_month: str = "", attendance_lock_version: str = ""):
	report_rows = list_payroll_report_summary(company, payroll_month, attendance_lock_version)
	totals = defaultdict(float)
	for row in report_rows:
		for key, value in row.items():
			if key != "department":
				totals[key] += flt(value)
	cost_buckets = [
		{"label": "应付工资", "value": round(totals["gross_pay"], 2)},
		{"label": "实发工资", "value": round(totals["net_pay"], 2)},
		{"label": "加班工资", "value": round(totals["overtime_pay_total"], 2)},
		{"label": "奖金福利", "value": round(totals["bonus_total"], 2)},
		{"label": "惩处扣款", "value": round(totals["punishment_total"], 2)},
		{"label": "公司社保公积金", "value": round(totals["social_security_company"] + totals["housing_fund_company"], 2)},
		{"label": "公司实际负担总计", "value": round(totals["company_cost_total"], 2)},
	]
	return {"cost_buckets": cost_buckets, "department_rows": report_rows}


@frappe.whitelist()
def list_payroll_dependency_status(company: str, payroll_month: str = "", attendance_lock_version: str = ""):
	company = _require_company(company)
	attendance_filters = {"company": company}
	input_filters = {"company": company}
	settlement_filters = {"company": company}
	welfare_filters = {"company": company}
	if payroll_month:
		attendance_filters["attendance_month"] = payroll_month
		input_filters["payroll_month"] = payroll_month
		settlement_filters["payroll_month"] = payroll_month
		welfare_filters["payroll_month"] = payroll_month
	if attendance_lock_version:
		attendance_filters["attendance_lock_version"] = attendance_lock_version
		input_filters["attendance_lock_version"] = attendance_lock_version
		settlement_filters["attendance_lock_version"] = attendance_lock_version
		welfare_filters["attendance_lock_version"] = attendance_lock_version
	return [
		{"source": "员工花名册", "doctype": "Employee", "count": _safe_count("Employee", {"company": company} if _doctype_has_field("Employee", "company") else {}), "status": "已联动"},
		{"source": "薪资主数据/薪资异动", "doctype": EMPLOYEE_SALARY_CHANGE_DOCTYPE, "count": _safe_count(EMPLOYEE_SALARY_CHANGE_DOCTYPE, {"company": company}), "status": "已联动"},
		{"source": "月度考勤终稿", "doctype": MONTHLY_ATTENDANCE_DOCTYPE, "count": _safe_count(MONTHLY_ATTENDANCE_DOCTYPE, attendance_filters), "status": "仅已锁定可入薪资"},
		{"source": "福利扣款来源", "doctype": WELFARE_SOURCE_DOCTYPE, "count": _safe_count(WELFARE_SOURCE_DOCTYPE, welfare_filters), "status": "已联动"},
		{"source": "薪资输入表", "doctype": PAYROLL_INPUT_DOCTYPE, "count": _safe_count(PAYROLL_INPUT_DOCTYPE, input_filters), "status": "公司隔离"},
		{"source": "薪资结算表", "doctype": PAYROLL_SETTLEMENT_DOCTYPE, "count": _safe_count(PAYROLL_SETTLEMENT_DOCTYPE, settlement_filters), "status": "公司隔离"},
		{"source": "薪资规则/字段映射", "doctype": PAYROLL_RULE_DOCTYPE, "count": _safe_count(PAYROLL_RULE_DOCTYPE), "status": "已联动"},
	]
