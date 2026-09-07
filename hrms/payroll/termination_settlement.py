"""Versioned, Decimal-based reproduction of 离职人员薪资计算.xlsx, row 5.

This calculator owns only the departure worksheet. It never changes the normal
monthly formula set and does not infer deductions from an employee's status.
"""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

RULE_VERSION = "termination-xlsx-v1"
SOURCE_FILE = "离职人员薪资计算.xlsx"
TRACE_OUTPUT_FIELDS = {
    "salary_subtotal", "missing_hours", "adjusted_absence_hours", "absence_deduction_amount",
    "weekend_overtime_hours", "weekday_overtime_pay", "weekend_overtime_pay", "holiday_overtime_pay",
    "overtime_pay_total", "night_shift_allowance", "absenteeism_deduction", "gross_pay",
    "taxable_salary", "income_tax", "net_pay",
}
INPUT_FIELDS = [
    ("base_salary", "底薪", "D5"),
    ("function_allowance", "津贴", "E5"),
    ("standard_hours", "当月标准工时", "G5"),
    ("basic_attendance_hours", "基本出勤工时（抵扣前）", "H5"),
    ("raw_weekend_overtime_hours", "周末加班工时（抵扣前）", "J5"),
    ("weekday_overtime_hours", "平日加班工时（抵扣前）", "N5"),
    ("holiday_overtime_hours", "节假日加班工时", "O5"),
    ("large_night_shift_count", "大夜班次数", "T5"),
    ("small_night_shift_count", "小夜班次数", "U5"),
    ("green_apple_amount", "奖金小计／绿苹果", "W5"),
    ("red_apple_amount", "惩处小计／红苹果", "X5"),
    ("attendance_housing_allowance", "全勤／住房津贴", "Y5"),
    ("absenteeism_hours", "旷工扣款对应工时（样表为0）", "Z5"),
    ("social_security_personal", "保险基金个人承担额", "AB5"),
    ("housing_fund_personal", "住房公积金个人承担额", "AC5"),
    ("utilities_deduction", "住宿伙食及水电费", "AG5"),
    ("insurance_deduction", "意外险／全额社保扣款", "AH5"),
]


def normalize_inputs(values):
    if not isinstance(values, dict):
        raise ValueError("请核对并填写离职结算输入。")
    normalized = {}
    for field, label, _cell in INPUT_FIELDS:
        value = values.get(field)
        if value is None or value == "" or isinstance(value, bool):
            raise ValueError(f"请填写{label}；无金额或工时请明确填写0。")
        try:
            number = Decimal(str(value))
        except InvalidOperation:
            raise ValueError(f"{label}必须是有效数字。") from None
        if not number.is_finite() or number < 0:
            raise ValueError(f"{label}必须为有限的非负数。")
        if field.endswith("shift_count") and number != number.to_integral_value():
            raise ValueError(f"{label}必须为整数。")
        normalized[field] = number
    if normalized["standard_hours"] <= 0:
        raise ValueError("当月标准工时必须大于0，不能用174替代缺失值。")
    if normalized["basic_attendance_hours"] > normalized["standard_hours"]:
        raise ValueError("基本出勤工时不能超过当月标准工时，请将加班单独填写。")
    tax = values.get("income_tax_override")
    if tax is not None and tax != "":
        try:
            tax = Decimal(str(tax))
        except InvalidOperation:
            raise ValueError("财务确认所得税必须是有效数字。") from None
        if not tax.is_finite() or tax < 0:
            raise ValueError("财务确认所得税必须为有限的非负数。")
        normalized["income_tax_override"] = tax
    return normalized


def calculate_termination_settlement(values):
    v = normalize_inputs(values)
    result, trace = {}, []

    def rounded(value):
        return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    def put(field, cell, label, formula, value):
        result[field] = value
        trace.append({"output_field": field, "cell": cell, "label": label,
                      "expression": formula, "value": float(value)})
        return value

    salary = put("salary_subtotal", "F5", "薪资小计", "D5+E5", v["base_salary"] + v["function_allowance"])
    missing = put("missing_hours", "I5", "缺勤工时", "G5-H5", v["standard_hours"] - v["basic_attendance_hours"])
    put("adjusted_absence_hours", "K5", "调整后缺勤工时", "I5（周末不抵扣）", missing)
    absence = put("absence_deduction_amount", "L5", "缺勤对应扣除金额", "F5/G5*K5", salary / v["standard_hours"] * missing)
    weekend = put("weekend_overtime_hours", "M5", "调整后周末加班", "J5（保留全部工时）", v["raw_weekend_overtime_hours"])
    weekday_pay = put("weekday_overtime_pay", "P5", "平日加班费", "ROUND(D5/174*1.5*N5,2)", rounded(v["base_salary"] / 174 * Decimal("1.5") * v["weekday_overtime_hours"]))
    weekend_pay = put("weekend_overtime_pay", "Q5", "周末加班费", "ROUND(D5/174*2*M5,2)", rounded(v["base_salary"] / 174 * 2 * weekend))
    holiday_pay = put("holiday_overtime_pay", "R5", "节假日加班费", "D5/174*3*O5", v["base_salary"] / 174 * 3 * v["holiday_overtime_hours"])
    overtime = put("overtime_pay_total", "S5", "加班费小计", "P5+Q5+R5", weekday_pay + weekend_pay + holiday_pay)
    night = put("night_shift_allowance", "V5", "夜班津贴", "T5*45+U5*24", v["large_night_shift_count"] * 45 + v["small_night_shift_count"] * 24)
    absent = put("absenteeism_deduction", "Z5", "旷工扣款", "F5/174*3*已确认旷工工时", salary / 174 * 3 * v["absenteeism_hours"])
    gross = put("gross_pay", "AA5", "应付工资", "ROUND(F5-L5+S5+V5+W5-X5+Y5-Z5,2)", rounded(salary - absence + overtime + night + v["green_apple_amount"] - v["red_apple_amount"] + v["attendance_housing_allowance"] - absent))
    taxable = put("taxable_salary", "AD5/AE5", "未纳税总计", "ROUND(AA5-AB5-AC5,2)", rounded(gross - v["social_security_personal"] - v["housing_fund_personal"]))
    if "income_tax_override" in v:
        tax, tax_expression = v["income_tax_override"], "财务确认所得税（有人工调整记录）"
    else:
        # AF5's last ELSE incorrectly returns AE5 itself above 40000. Do not
        # silently turn the entire taxable pay into a deduction in that range.
        if taxable > 40000:
            raise ValueError("原表AF5在未纳税总计超过40000时返回整笔工资，请填写财务确认所得税后再结算。")
        if taxable < 5000:
            tax = Decimal(0)
        elif taxable <= 8000:
            tax = (taxable - 5000) * Decimal(".03")
        elif taxable <= 17000:
            tax = (taxable - 5000) * Decimal(".10") - 210
        elif taxable <= 30000:
            tax = (taxable - 5000) * Decimal(".20") - 1410
        else:
            tax = (taxable - 5000) * Decimal(".25") - 2660
        tax = max(Decimal(0), rounded(tax))
        tax_expression = "原表AF5分段公式：5000／8000／17000／30000／40000"
    tax = put("income_tax", "AF5", "所得税扣除", tax_expression, tax)
    net = put("net_pay", "AI5", "实发工资", "AE5-AF5-AG5-AH5", taxable - tax - v["utilities_deduction"] - v["insurance_deduction"])
    # The common settlement schema is a shared output, never a second payment.
    result.update({
        "full_salary_hourly_rate": salary / v["standard_hours"],
        "base_salary_hourly_rate": v["base_salary"] / 174,
        "subsidy_bonus_total": v["attendance_housing_allowance"],
        "bonus_total": v["green_apple_amount"] + v["attendance_housing_allowance"],
        "punishment_total": v["red_apple_amount"] + absent,
        "attendance_wage": salary - absence + overtime + night - absent - v["red_apple_amount"],
        "export_tax_adjusted_net_pay": net,
    })
    return {"rule_version": RULE_VERSION, "source_file": SOURCE_FILE,
            "inputs": {k: float(n) for k, n in v.items()},
            "calculated": {k: float(n) for k, n in result.items()}, "formula_trace": trace}
