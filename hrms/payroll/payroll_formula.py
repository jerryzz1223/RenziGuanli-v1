"""Restricted, auditable formula engine for company payroll rules."""

from __future__ import annotations

import ast
import re
from decimal import Decimal, ROUND_HALF_UP


FIELD_DEFINITIONS = [
	# Controlled inputs
	{"fieldname": "base_salary", "label": "底薪", "group": "薪资字段", "source": "员工薪资档案"},
	{"fieldname": "function_allowance", "label": "职能津贴", "group": "薪资字段", "source": "员工薪资档案"},
	{"fieldname": "certificate_skill_allowance", "label": "证书及多能工津贴", "group": "薪资字段", "source": "员工薪资档案"},
	{"fieldname": "standard_hours", "label": "标准工时", "group": "考勤字段", "source": "已锁定考勤终稿"},
	{"fieldname": "basic_attendance_hours", "label": "基本出勤工时", "group": "考勤字段", "source": "已锁定考勤终稿"},
	{"fieldname": "raw_weekend_overtime_hours", "label": "调整前周末加班", "group": "考勤字段", "source": "已锁定考勤终稿"},
	{"fieldname": "weekday_overtime_hours", "label": "平日加班时数", "group": "考勤字段", "source": "已锁定考勤终稿"},
	{"fieldname": "holiday_overtime_hours", "label": "节假日加班时数", "group": "考勤字段", "source": "已锁定考勤终稿"},
	{"fieldname": "large_night_shift_count", "label": "大夜班次数", "group": "考勤字段", "source": "已锁定考勤终稿"},
	{"fieldname": "small_night_shift_count", "label": "小夜班次数", "group": "考勤字段", "source": "已锁定考勤终稿"},
	{"fieldname": "absenteeism_hours", "label": "旷工工时", "group": "考勤字段", "source": "已锁定考勤终稿"},
	{"fieldname": "proposal_improvement_bonus", "label": "提案改善奖", "group": "月度变量", "source": "已确认变量"},
	{"fieldname": "apple_reward_amount", "label": "红绿苹果", "group": "月度变量", "source": "已确认绩效/苹果树变量"},
	{"fieldname": "full_attendance_bonus", "label": "全勤奖", "group": "月度变量", "source": "考勤终稿或已确认变量"},
	{"fieldname": "housing_subsidy", "label": "住房补贴", "group": "月度变量", "source": "已确认变量"},
	{"fieldname": "education_subsidy", "label": "学历补贴", "group": "月度变量", "source": "已确认变量"},
	{"fieldname": "other_bonus", "label": "其他奖金", "group": "月度变量", "source": "已确认变量"},
	{"fieldname": "production_bonus", "label": "生产奖", "group": "月度变量", "source": "已确认变量"},
	{"fieldname": "late_full_attendance_deduction", "label": "迟到及全勤奖扣款", "group": "月度变量", "source": "考勤终稿或已确认变量"},
	{"fieldname": "other_deduction", "label": "其他扣款", "group": "月度变量", "source": "已确认变量"},
	{"fieldname": "social_security_personal", "label": "社保个人", "group": "月度变量", "source": "已确认变量"},
	{"fieldname": "housing_fund_personal", "label": "公积金个人", "group": "月度变量", "source": "已确认变量"},
	{"fieldname": "paid_proposal_birthday_welfare", "label": "已发福利", "group": "月度变量", "source": "已确认变量"},
	{"fieldname": "continuing_service_bonus", "label": "继续服务奖", "group": "月度变量", "source": "已确认变量"},
	{"fieldname": "income_tax", "label": "所得税", "group": "月度变量", "source": "财务确认变量"},
	{"fieldname": "year_end_bonus_tax", "label": "年终奖所得税", "group": "月度变量", "source": "财务确认变量"},
	{"fieldname": "utilities_deduction", "label": "水电费及扣款", "group": "月度变量", "source": "已确认变量"},
	{"fieldname": "manual_social_security_company", "label": "社保公司手工金额", "group": "月度变量", "source": "已确认变量"},
	{"fieldname": "manual_housing_fund_company", "label": "公积金公司手工金额", "group": "月度变量", "source": "已确认变量"},
	# Derived values, evaluated in template order.
	{"fieldname": "salary_subtotal", "label": "薪资小计", "group": "计算结果", "source": "公式"},
	{"fieldname": "missing_hours", "label": "缺勤工时", "group": "计算结果", "source": "公式"},
	{"fieldname": "adjusted_absence_hours", "label": "调整后缺勤工时", "group": "计算结果", "source": "公式"},
	{"fieldname": "weekend_overtime_hours", "label": "调整后周末加班", "group": "计算结果", "source": "公式"},
	{"fieldname": "full_salary_hourly_rate", "label": "全薪时薪", "group": "计算结果", "source": "公式"},
	{"fieldname": "base_salary_hourly_rate", "label": "底薪时薪", "group": "计算结果", "source": "公式"},
	{"fieldname": "absence_deduction_amount", "label": "缺勤扣款", "group": "计算结果", "source": "公式"},
	{"fieldname": "weekday_overtime_pay", "label": "平日加班费", "group": "计算结果", "source": "公式"},
	{"fieldname": "weekend_overtime_pay", "label": "周末加班费", "group": "计算结果", "source": "公式"},
	{"fieldname": "holiday_overtime_pay", "label": "节假日加班费", "group": "计算结果", "source": "公式"},
	{"fieldname": "overtime_pay_total", "label": "加班费小计", "group": "计算结果", "source": "公式"},
	{"fieldname": "night_shift_allowance", "label": "夜班津贴", "group": "计算结果", "source": "公式"},
	{"fieldname": "subsidy_bonus_total", "label": "补贴小计", "group": "计算结果", "source": "公式"},
	{"fieldname": "bonus_total", "label": "奖金小计", "group": "计算结果", "source": "公式"},
	{"fieldname": "absenteeism_deduction", "label": "旷工扣款", "group": "计算结果", "source": "公式"},
	{"fieldname": "punishment_total", "label": "惩处小计", "group": "计算结果", "source": "公式"},
	{"fieldname": "attendance_wage", "label": "出勤工资", "group": "计算结果", "source": "公式"},
	{"fieldname": "gross_pay", "label": "应付工资", "group": "计算结果", "source": "公式"},
	{"fieldname": "taxable_salary", "label": "计税工资", "group": "计算结果", "source": "公式"},
	{"fieldname": "net_pay", "label": "实发工资", "group": "计算结果", "source": "公式"},
	{"fieldname": "social_security_company", "label": "社保公司", "group": "计算结果", "source": "公式"},
	{"fieldname": "housing_fund_company", "label": "公积金公司", "group": "计算结果", "source": "公式"},
	{"fieldname": "company_cost_total", "label": "公司实际负担", "group": "计算结果", "source": "公式"},
	{"fieldname": "export_tax_adjusted_net_pay", "label": "导出校验工资", "group": "计算结果", "source": "公式"},
]

FIELD_BY_LABEL = {item["label"]: item for item in FIELD_DEFINITIONS}
FIELD_BY_NAME = {item["fieldname"]: item for item in FIELD_DEFINITIONS}

FORMULA_TEMPLATES = [
	{"output_field": "salary_subtotal", "expression": "[底薪] + [职能津贴] + [证书及多能工津贴]", "category": "固定薪资", "description": "5.2薪资结算表 H=SUM(E:G)"},
	{"output_field": "missing_hours", "expression": "MAX([标准工时] - [基本出勤工时], 0)", "category": "考勤结算", "description": "缺勤工时 K=I-J"},
	{"output_field": "adjusted_absence_hours", "expression": "MAX([缺勤工时] - [调整前周末加班], 0)", "category": "考勤结算", "description": "调整后缺勤工时 M=IF(K-L>0,K-L,0)"},
	{"output_field": "weekend_overtime_hours", "expression": "MAX([调整前周末加班] - [缺勤工时] + [调整后缺勤工时], 0)", "category": "考勤结算", "description": "调整后周末加班 O=L-K+M"},
	{"output_field": "full_salary_hourly_rate", "expression": "ROUND([薪资小计] / 174, 8)", "category": "考勤结算", "description": "全薪小时单价"},
	{"output_field": "base_salary_hourly_rate", "expression": "ROUND([底薪] / 174, 8)", "category": "考勤结算", "description": "底薪小时单价"},
	{"output_field": "absence_deduction_amount", "expression": "ROUND([全薪时薪] * [调整后缺勤工时], 2)", "category": "考勤结算", "description": "缺勤扣款 N=ROUND(H/174*M,2)"},
	{"output_field": "weekday_overtime_pay", "expression": "ROUND([底薪时薪] * [平日加班时数] * 1.5, 2)", "category": "考勤结算", "description": "平日加班费"},
	{"output_field": "weekend_overtime_pay", "expression": "ROUND([底薪时薪] * [调整后周末加班] * 2, 2)", "category": "考勤结算", "description": "周末加班费"},
	{"output_field": "holiday_overtime_pay", "expression": "ROUND([底薪时薪] * [节假日加班时数] * 3, 2)", "category": "考勤结算", "description": "节假日加班费"},
	{"output_field": "overtime_pay_total", "expression": "[平日加班费] + [周末加班费] + [节假日加班费]", "category": "考勤结算", "description": "加班费小计 U=SUM(R:T)"},
	{"output_field": "night_shift_allowance", "expression": "[大夜班次数] * 45 + [小夜班次数] * 24", "category": "考勤结算", "description": "夜班津贴 X=V*45+W*24"},
	{"output_field": "subsidy_bonus_total", "expression": "[全勤奖] + [住房补贴] + [学历补贴] + [其他奖金]", "category": "奖金补贴", "description": "全勤、住房、学历及其他补贴汇总"},
	{"output_field": "bonus_total", "expression": "[提案改善奖] + [红绿苹果] + [补贴小计] + [生产奖]", "category": "奖金补贴", "description": "奖金小计 AD=SUM(Z:AC)"},
	{"output_field": "absenteeism_deduction", "expression": "ROUND([全薪时薪] * [旷工工时] * 3, 2)", "category": "扣款税费", "description": "旷工扣款 AF=ROUND(H/174*AE*3,2)"},
	{"output_field": "punishment_total", "expression": "[旷工扣款] + [迟到及全勤奖扣款] + [其他扣款]", "category": "扣款税费", "description": "惩处小计"},
	{"output_field": "attendance_wage", "expression": "[薪资小计] - [缺勤扣款] + [加班费小计] + [夜班津贴] - [惩处小计]", "category": "应付与实发", "description": "不含奖金的出勤工资"},
	{"output_field": "gross_pay", "expression": "[出勤工资] + [奖金小计]", "category": "应付与实发", "description": "应付工资 AI=H-N+U+X+AD-AH"},
	{"output_field": "taxable_salary", "expression": "[应付工资] - [社保个人] - [公积金个人] + [已发福利]", "category": "应付与实发", "description": "计税工资 AM=AI-AJ-AK+AL"},
	{"output_field": "net_pay", "expression": "[计税工资] - [所得税] - [年终奖所得税] - [水电费及扣款] + [继续服务奖] - [已发福利]", "category": "应付与实发", "description": "实发工资 AS=AM-AP-AQ-AR+AN-AL"},
	{"output_field": "social_security_company", "expression": "IF([社保公司手工金额] > 0, [社保公司手工金额], IF([社保个人] = 524.96, 1256.82, IF([社保个人] > 520 AND [社保个人] <= 531, 1269, IF([社保个人] > 531 AND [社保个人] <= 636, 1522.8, IF([社保个人] > 636, 1649.7, 0)))))", "category": "公司成本", "description": "公司社保手工确认优先，否则沿用5.2区间"},
	{"output_field": "housing_fund_company", "expression": "IF([公积金公司手工金额] > 0, [公积金公司手工金额], [公积金个人])", "category": "公司成本", "description": "公司公积金手工确认优先"},
	{"output_field": "company_cost_total", "expression": "[应付工资] + [社保公司] + [公积金公司] + [继续服务奖] + [已发福利]", "category": "公司成本", "description": "公司实际负担 AV=AI+AT+AU+AN+AL"},
	{"output_field": "export_tax_adjusted_net_pay", "expression": "[计税工资] + [继续服务奖] - [水电费及扣款] - [所得税] - [已发福利] - [年终奖所得税]", "category": "应付与实发", "description": "Excel BE导出校验口径"},
]

FUNCTIONS = [
	{"name": "IF", "label": "条件", "signature": "IF(条件, 成立值, 不成立值)"},
	{"name": "ROUND", "label": "四舍五入", "signature": "ROUND(数值, 位数)"},
	{"name": "MIN", "label": "最小值", "signature": "MIN(数值1, 数值2)"},
	{"name": "MAX", "label": "最大值", "signature": "MAX(数值1, 数值2)"},
	{"name": "ABS", "label": "绝对值", "signature": "ABS(数值)"},
	{"name": "SUM", "label": "求和", "signature": "SUM(数值1, 数值2, ...)"},
]

_FIELD_TOKEN = re.compile(r"\[([^\[\]]+)\]")


class FormulaError(ValueError):
	pass


def _excel_round(value, digits=0):
	quantum = Decimal("1").scaleb(-int(digits))
	return float(Decimal(str(value)).quantize(quantum, rounding=ROUND_HALF_UP))


def compile_formula(expression: str):
	if not expression or not str(expression).strip():
		raise FormulaError("计算公式不能为空")
	dependencies = []

	def replace(match):
		label = match.group(1).strip()
		field = FIELD_BY_LABEL.get(label)
		if not field:
			raise FormulaError(f"未知字段：{label}")
		dependencies.append(field["fieldname"])
		return field["fieldname"]

	try:
		compiled = _FIELD_TOKEN.sub(replace, str(expression).strip())
	except FormulaError:
		raise
	# Keep the UI close to spreadsheet syntax while Python's parser remains the
	# strict grammar validator.
	compiled = re.sub(r"(?<![<>=!])=(?!=)", "==", compiled)
	compiled = re.sub(r"\bAND\b", " and ", compiled, flags=re.I)
	compiled = re.sub(r"\bOR\b", " or ", compiled, flags=re.I)
	try:
		tree = ast.parse(compiled, mode="eval")
	except SyntaxError as exc:
		raise FormulaError(f"公式语法错误：{exc.msg}") from exc
	_validate_node(tree)
	return tree, list(dict.fromkeys(dependencies))


def _validate_node(node):
	allowed = (
		ast.Expression, ast.Constant, ast.Name, ast.Load, ast.BinOp, ast.UnaryOp,
		ast.BoolOp, ast.Compare, ast.Call, ast.Add, ast.Sub, ast.Mult, ast.Div,
		ast.Mod, ast.Pow, ast.USub, ast.UAdd, ast.And, ast.Or, ast.Eq, ast.NotEq,
		ast.Lt, ast.LtE, ast.Gt, ast.GtE,
	)
	if not isinstance(node, allowed):
		raise FormulaError(f"公式包含不允许的语法：{type(node).__name__}")
	if isinstance(node, ast.Call) and (not isinstance(node.func, ast.Name) or node.func.id.upper() not in {item["name"] for item in FUNCTIONS}):
		raise FormulaError("只允许使用系统提供的函数")
	for child in ast.iter_child_nodes(node):
		_validate_node(child)


def evaluate_formula(expression: str, context: dict | None = None):
	tree, dependencies = compile_formula(expression)
	values = {key: float(value or 0) for key, value in (context or {}).items() if key in FIELD_BY_NAME}
	try:
		result = _evaluate_node(tree.body, values)
	except ZeroDivisionError as exc:
		raise FormulaError("公式发生除零，请检查分母字段") from exc
	if isinstance(result, bool):
		result = 1 if result else 0
	return float(result or 0), dependencies


def _evaluate_node(node, context):
	if isinstance(node, ast.Constant):
		if not isinstance(node.value, (int, float, bool)):
			raise FormulaError("公式只允许数字常量")
		return node.value
	if isinstance(node, ast.Name):
		if node.id not in FIELD_BY_NAME:
			raise FormulaError(f"未知系统字段：{node.id}")
		return context.get(node.id, 0)
	if isinstance(node, ast.UnaryOp):
		value = _evaluate_node(node.operand, context)
		return -value if isinstance(node.op, ast.USub) else +value
	if isinstance(node, ast.BinOp):
		left, right = _evaluate_node(node.left, context), _evaluate_node(node.right, context)
		operations = {ast.Add: lambda: left + right, ast.Sub: lambda: left - right, ast.Mult: lambda: left * right, ast.Div: lambda: left / right, ast.Mod: lambda: left % right, ast.Pow: lambda: left ** right}
		return operations[type(node.op)]()
	if isinstance(node, ast.BoolOp):
		values = [_evaluate_node(item, context) for item in node.values]
		return all(values) if isinstance(node.op, ast.And) else any(values)
	if isinstance(node, ast.Compare):
		left = _evaluate_node(node.left, context)
		for operator, comparator in zip(node.ops, node.comparators):
			right = _evaluate_node(comparator, context)
			checks = {ast.Eq: left == right, ast.NotEq: left != right, ast.Lt: left < right, ast.LtE: left <= right, ast.Gt: left > right, ast.GtE: left >= right}
			if not checks[type(operator)]:
				return False
			left = right
		return True
	if isinstance(node, ast.Call):
		name = node.func.id.upper()
		if name == "IF":
			if len(node.args) != 3:
				raise FormulaError("IF 必须填写条件、成立值和不成立值")
			return _evaluate_node(node.args[1], context) if _evaluate_node(node.args[0], context) else _evaluate_node(node.args[2], context)
		args = [_evaluate_node(item, context) for item in node.args]
		if name == "ROUND":
			return _excel_round(args[0], args[1] if len(args) > 1 else 0)
		if name == "MIN":
			return min(args)
		if name == "MAX":
			return max(args)
		if name == "ABS":
			return abs(args[0])
		if name == "SUM":
			return sum(args)
	raise FormulaError("无法执行该公式")


def evaluate_formula_set(formulas, context):
	results = dict(context or {})
	trace = []
	for formula in formulas:
		value, dependencies = evaluate_formula(formula["expression"], results)
		results[formula["output_field"]] = value
		trace.append({"output_field": formula["output_field"], "expression": formula["expression"], "dependencies": dependencies, "value": value, "version": formula.get("version", 1), "source": formula.get("source", "内置模板")})
	return results, trace
