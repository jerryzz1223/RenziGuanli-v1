"""Ephemeral, company-scoped realistic payroll acceptance seed.

This fixture is deliberately separate from TEST-HRMS.  It uses plausible
Chinese employee data and can remove its entire company scope after an E2E
payroll run, so it is safe for acceptance testing on a local site.
"""

from __future__ import annotations

from collections import OrderedDict
from decimal import Decimal, ROUND_HALF_UP

import frappe
from frappe.utils import now_datetime

from hrms.api import attendance_import, payroll_input
from hrms.api.demo_seed import _create_seed_workbook_file


COMPANY = "薪资验收模拟公司"
MONTH = "2099-04"
FILE_PREFIX = "RSE-209904"

EMPLOYEES = (
	{"code": "RSE24001", "name": "张伟", "gender": "Male", "department": "RSE-生产部", "designation": "RSE-制造技师", "employment_type": "Full-time", "joined": "2021-03-08", "salary": (6000, 300, 100, 100), "social": (630, 150, 1500, 150)},
	{"code": "RSE24002", "name": "李娜", "gender": "Female", "department": "RSE-品质部", "designation": "RSE-质量检验员", "employment_type": "Full-time", "joined": "2022-07-18", "salary": (5200, 200, 0, 0), "social": (520, 100, 1280, 100)},
	{"code": "RSE24003", "name": "王强", "gender": "Male", "department": "RSE-技术部", "designation": "RSE-设备工程师", "employment_type": "Full-time", "joined": "2019-11-04", "salary": (7500, 500, 300, 200), "social": (780, 180, 1950, 180)},
	{"code": "RSE24004", "name": "陈静", "gender": "Female", "department": "RSE-人力行政部", "designation": "RSE-人事专员", "employment_type": "Full-time", "joined": "2020-05-11", "salary": (5500, 300, 0, 0), "social": (550, 150, 1400, 150)},
	{"code": "RSE24005", "name": "刘洋", "gender": "Male", "department": "RSE-生产部", "designation": "RSE-一线操作工", "employment_type": "Probation", "joined": "2099-02-10", "salary": (4200, 100, 0, 0), "social": None},
	{"code": "RSE24006", "name": "赵敏", "gender": "Female", "department": "RSE-物流部", "designation": "RSE-仓储主管", "employment_type": "Full-time", "joined": "2020-09-21", "salary": (5800, 200, 0, 0), "social": (600, 130, 1500, 130)},
)


def _round(value, digits=2):
	quantum = Decimal("1").scaleb(-digits)
	return float(Decimal(str(value)).quantize(quantum, rounding=ROUND_HALF_UP))


def _employee_by_code(code):
	return next(row for row in EMPLOYEES if row["code"] == code)


def _department_name(label):
	return frappe.db.get_value("Department", {"department_name": label, "company": COMPANY}, "name")


def _employee_name(code):
	return frappe.db.get_value("Employee", {"company": COMPANY, "custom_employee_code": code}, "name")


def _ensure_foundation():
	if not frappe.db.exists("Company", COMPANY):
		frappe.get_doc({"doctype": "Company", "company_name": COMPANY, "abbr": "RSE", "default_currency": "CNY", "country": "China"}).insert(ignore_permissions=True)
	for label in sorted({row["department"] for row in EMPLOYEES}):
		if not _department_name(label):
			frappe.get_doc({"doctype": "Department", "department_name": label, "company": COMPANY}).insert(ignore_permissions=True)
	for designation in sorted({row["designation"] for row in EMPLOYEES}):
		if not frappe.db.exists("Designation", designation):
			frappe.get_doc({"doctype": "Designation", "designation_name": designation}).insert(ignore_permissions=True)
	for row in EMPLOYEES:
		if _employee_name(row["code"]):
			continue
		department = _department_name(row["department"])
		frappe.get_doc({
			"doctype": "Employee", "first_name": row["name"], "gender": row["gender"],
			"date_of_birth": "1988-06-15", "date_of_joining": row["joined"], "status": "Active",
			"company": COMPANY, "department": department, "designation": row["designation"],
			"custom_employee_code": row["code"], "employment_type": row["employment_type"],
			"cell_number": "1390000" + row["code"][-4:], "personal_email": f'{row["code"].lower()}@example.invalid',
			"final_confirmation_date": row["joined"] if row["employment_type"] == "Full-time" else None,
		}).insert(ignore_permissions=True)
	frappe.db.commit()


def _roster():
	result = {}
	for row in EMPLOYEES:
		employee = _employee_name(row["code"])
		if not employee:
			frappe.throw(f"未找到验收员工 {row['code']}")
		context = frappe.db.get_value("Employee", employee, ["employee_name", "department", "designation"], as_dict=True)
		result[row["code"]] = {**row, "employee": employee, **context}
	return result


def _attendance_rows(roster):
	headers = [
		"姓名", "工号", "日期", "班次", "应上班时间", "应下班时间", "上班时间", "下班时间",
		"上班缺卡", "下班缺卡", "请假/旷工(小时)", "标准工时", "实际出勤(小时)",
		"工作日加班（小时）", "休息日加班（小时）", "节假日加班（小时）", "大夜班", "小夜班",
		"请假/事假(小时)", "请假/病假(小时)", "请假/特休(小时)", "迟到次数", "早退次数", "实际部门", "关联审批单",
	]
	overrides = {
		("RSE24001", 3): {"workday": 4, "approval": "OT-20990403-001"},
		("RSE24002", 4): {"actual": 0, "sick": 8, "approval": "LEAVE-20990404-001"},
		("RSE24003", 5): {"holiday": 8, "large": 2, "approval": "OT-20990405-001"},
		("RSE24004", 8): {"missing_out": "是", "actual_out": ""},
		("RSE24005", 7): {"actual_in": "08:15", "late": 1, "workday": 2},
		("RSE24005", 12): {"actual_out": "16:40", "early": 1},
		("RSE24006", 10): {"actual": 0, "absent": 8},
		("RSE24006", 11): {"rest": 4, "approval": "OT-20990411-001"},
	}
	daily = [headers]
	for code, context in roster.items():
		for day in range(1, 23):
			item = {"actual": 8, "absent": 0, "workday": 0, "rest": 0, "holiday": 0, "large": 0, "small": 0, "personal": 0, "sick": 0, "annual": 0, "late": 0, "early": 0, "actual_in": "08:00", "actual_out": "17:00", "missing_out": "", "approval": ""}
			item.update(overrides.get((code, day), {}))
			daily.append([context["employee_name"], code, f"{MONTH}-{day:02d}", "白班", "08:00", "17:00", item["actual_in"], item["actual_out"], "", item["missing_out"], item["absent"], 8, item["actual"], item["workday"], item["rest"], item["holiday"], item["large"], item["small"], item["personal"], item["sick"], item["annual"], item["late"], item["early"], context["department"], item["approval"]])
	leaves = [
		["请假类型", "创建人", "工号", "创建人部门", "开始时间", "结束时间", "时长", "审批编号", "审批结果", "审批状态", "请假事由"],
		["病假", roster["RSE24002"]["employee_name"], "RSE24002", roster["RSE24002"]["department"], f"{MONTH}-04 08:00", f"{MONTH}-04 17:00", "8小时", "LEAVE-20990404-001", "审批通过", "已结束", "门诊病假"],
	]
	return [("1.1每日统计", daily), ("1.2请假单", leaves), ("1.3苹果树", [["奖/惩日期", "受奖/惩人", "工号", "受奖/惩人部门", "奖/惩项目", "绿苹果", "红苹果", "审批编号", "审批结果", "审批状态", "创建人"]])]


def _closure_rows(roster):
	salary = [["薪资月份", "工号", "姓名", "部门", "岗位", "生效日期", "异动原因", "薪资档位", "底薪", "职能津贴", "证书津贴", "多能工津贴", "薪资小计", "社保", "公积金", "状态", "备注"]]
	for code, context in roster.items():
		base, function, certificate, multi = context["salary"]
		enabled = "是" if context["social"] else "否"
		salary.append([MONTH, code, context["employee_name"], context["department"], context["designation"], f"{MONTH}-01", "年度调薪/定薪", "", base, function, certificate, multi, base + function + certificate + multi, enabled, enabled, "已批准", "验收模拟定薪数据"])
	welfare = [["薪资月份", "来源类型", "工号", "姓名", "部门", "金额", "方向", "资格状态", "确认状态", "来源单据/说明", "备注"]]
	def add(code, source_type, amount, direction=""):
		context = roster[code]
		welfare.append([MONTH, source_type, code, context["employee_name"], context["department"], amount, direction, "符合", "已确认", f"{source_type}月度确认单", "验收模拟来源"])
	for code, context in roster.items():
		if context["social"]:
			personal_social, personal_fund, company_social, company_fund = context["social"]
			add(code, "社保个人", personal_social, "应扣")
			add(code, "公积金个人", personal_fund, "应扣")
			add(code, "社保公司", company_social, "公司承担")
			add(code, "公积金公司", company_fund, "公司承担")
	add("RSE24001", "学历补贴", 200, "应发"); add("RSE24001", "租房补贴", 300, "应发"); add("RSE24001", "提案改善奖", 80, "应发"); add("RSE24001", "生产奖", 150, "应发"); add("RSE24001", "继续服务奖", 100, "应发"); add("RSE24001", "已发福利", 30, "应扣"); add("RSE24001", "所得税", 30, "应扣"); add("RSE24001", "水电费及扣款", 50, "应扣")
	add("RSE24002", "宿舍住宿费", 200, "应扣")
	add("RSE24003", "所得税", 120, "应扣")
	add("RSE24004", "租房补贴", 200, "应发"); add("RSE24004", "水电费及扣款", 40, "应扣")
	add("RSE24005", "其他扣款", 50, "应扣")
	add("RSE24006", "所得税", 50, "应扣"); add("RSE24006", "其他扣款", 40, "应扣")
	return [("员工薪资异动导入", salary), ("福利扣款来源导入", welfare)]


def _variable_rows(roster):
	return [("全勤奖", [["工号", "姓名", "部门", "全勤奖", "备注"], ["RSE24001", roster["RSE24001"]["employee_name"], roster["RSE24001"]["department"], 220, "全勤奖确认"], ["RSE24003", roster["RSE24003"]["employee_name"], roster["RSE24003"]["department"], 150, "全勤奖确认"], ["RSE24004", roster["RSE24004"]["employee_name"], roster["RSE24004"]["department"], 100, "全勤奖确认"]])]


def _manual_expected():
	"""Independent arithmetic using fixture facts, not the formula evaluator."""
	inputs = {
		"RSE24001": {"actual": 176, "workday": 4, "rest": 0, "holiday": 0, "large": 0, "absent": 0, "full": 220, "housing": 300, "education": 200, "proposal": 80, "production": 150, "social": 630, "fund": 150, "company_social": 1500, "company_fund": 150, "tax": 30, "utilities": 50, "continuing": 100, "paid": 30},
		"RSE24002": {"actual": 168, "workday": 0, "rest": 0, "holiday": 0, "large": 0, "absent": 0, "full": 150, "housing": 0, "education": 0, "proposal": 0, "production": 0, "social": 520, "fund": 100, "company_social": 1280, "company_fund": 100, "tax": 0, "utilities": 200, "continuing": 0, "paid": 0, "attendance_deduction": 50},
		"RSE24003": {"actual": 176, "workday": 0, "rest": 0, "holiday": 8, "large": 2, "absent": 0, "full": 150, "housing": 0, "education": 0, "proposal": 0, "production": 0, "social": 780, "fund": 180, "company_social": 1950, "company_fund": 180, "tax": 120, "utilities": 0, "continuing": 0, "paid": 0},
		"RSE24004": {"actual": 175.5, "workday": 0, "rest": 0, "holiday": 0, "large": 0, "absent": 0, "full": 100, "housing": 200, "education": 0, "proposal": 0, "production": 0, "social": 550, "fund": 150, "company_social": 1400, "company_fund": 150, "tax": 0, "utilities": 40, "continuing": 0, "paid": 0, "attendance_deduction": 10},
		"RSE24005": {"actual": 176, "workday": 2, "rest": 0, "holiday": 0, "large": 0, "absent": 0, "full": 200, "housing": 0, "education": 0, "proposal": 0, "production": 0, "social": 0, "fund": 0, "company_social": 0, "company_fund": 0, "tax": 0, "utilities": 0, "continuing": 0, "paid": 0, "other": 50},
		"RSE24006": {"actual": 168, "workday": 0, "rest": 4, "holiday": 0, "large": 0, "absent": 8, "full": 150, "housing": 0, "education": 0, "proposal": 0, "production": 0, "social": 600, "fund": 130, "company_social": 1500, "company_fund": 130, "tax": 50, "utilities": 0, "continuing": 0, "paid": 0, "other": 40, "attendance_deduction": 50},
	}
	result = {}
	for employee in EMPLOYEES:
		code = employee["code"]; facts = inputs[code]
		base, function, certificate, multi = employee["salary"]
		subtotal = base + function + certificate + multi
		missing = 176 - facts["actual"]; adjusted_absence = max(missing - facts["rest"], 0); adjusted_weekend = max(facts["rest"] - missing + adjusted_absence, 0)
		full_rate = _round(Decimal(subtotal) / Decimal(174), 8); base_rate = _round(Decimal(base) / Decimal(174), 8)
		absence = _round(full_rate * adjusted_absence); overtime = _round(base_rate * facts["workday"] * 1.5) + _round(base_rate * adjusted_weekend * 2) + _round(base_rate * facts["holiday"] * 3)
		bonus = facts["full"] + facts["housing"] + facts["education"] + facts["proposal"] + facts["production"]
		punishment = _round(full_rate * facts["absent"] * 3) + facts.get("other", 0) + facts.get("attendance_deduction", 0)
		gross = _round(subtotal - absence + overtime + facts["large"] * 45 - punishment + bonus)
		taxable = _round(gross - facts["social"] - facts["fund"] + facts["paid"])
		net = _round(taxable - facts["tax"] - facts["utilities"] + facts["continuing"] - facts["paid"])
		company_cost = _round(gross + facts["company_social"] + facts["company_fund"] + facts["continuing"] + facts["paid"])
		result[code] = {"standard_hours": 176.0, "basic_attendance_hours": facts["actual"], "missing_hours": float(missing), "adjusted_absence_hours": float(adjusted_absence), "gross_pay": gross, "net_pay": net, "company_cost_total": company_cost}
	return result


def _status():
	lock = frappe.db.get_value("HRMS Attendance Month Lock", {"company": COMPANY, "attendance_month": MONTH}, ["name", "status", "active_version"], as_dict=True) or {}
	version = str(lock.get("active_version") or "")
	payroll = {"company": COMPANY, "payroll_month": MONTH}
	if version:
		payroll["attendance_lock_version"] = version
	return {"company": COMPANY, "payroll_month": MONTH, "lock": lock, "counts": {"company": int(bool(frappe.db.exists("Company", COMPANY))), "employees": frappe.db.count("Employee", {"company": COMPANY}), "departments": frappe.db.count("Department", {"company": COMPANY}), "attendance_batches": frappe.db.count("HRMS Attendance Import Batch", {"company": COMPANY, "attendance_month": MONTH}), "summaries": frappe.db.count("HRMS Monthly Attendance Summary", {"company": COMPANY, "attendance_month": MONTH}), "salary_changes": frappe.db.count("HRMS Employee Salary Change", {"company": COMPANY, "effective_date": ["between", [f"{MONTH}-01", f"{MONTH}-30"]]}), "welfare_sources": frappe.db.count("HRMS Payroll Welfare Source Record", payroll), "variables": frappe.db.count("HRMS Payroll Variable Record", payroll), "inputs": frappe.db.count("HRMS Payroll Input Record", payroll), "settlements": frappe.db.count("HRMS Payroll Settlement Record", payroll)}}


@frappe.whitelist()
def seed_realistic_payroll_e2e():
	"""Run the realistic company fixture through imports, locking and confirmation."""
	if _status()["counts"]["attendance_batches"]:
		frappe.throw("真实验收 seed 已存在；请先清理后再运行。")
	_ensure_foundation(); roster = _roster()
	attendance_file = _create_seed_workbook_file(f"{FILE_PREFIX}-考勤导入.xlsx", _attendance_rows(roster))
	attendance_result = attendance_import.import_attendance_workbook(attendance_file.file_url, MONTH, COMPANY)
	manual_source = frappe.db.get_value("HRMS Attendance Day Check", {"company": COMPANY, "employee_code": "RSE24004", "attendance_date": f"{MONTH}-09", "source_kind": "旧模板"}, "name")
	if not manual_source:
		frappe.throw("未找到 RSE24004 的人工更正考勤源行。")
	manual = attendance_import.create_attendance_manual_adjustment(manual_source, {"actual_out_time": "16:30", "actual_attendance_hours": 7.5, "leave_hours": 0.5, "personal_leave_hours": 0.5, "leave_summary": "已审批事假 0.5 小时"}, "人事确认：事假 0.5 小时")
	exceptions = attendance_import.generate_attendance_exceptions(attendance_result["batch"])
	for name in frappe.get_all("HRMS Attendance Exception", filters={"import_batch": attendance_result["batch"]}, pluck="name"):
		frappe.db.set_value("HRMS Attendance Exception", name, {"confirmation_status": "已确认", "confirmed_by": frappe.session.user, "confirmed_on": now_datetime(), "remarks": "验收复核通过"})
	monthly = attendance_import.generate_monthly_attendance_summary(COMPANY, MONTH); version = str(monthly["attendance_lock_version"])
	attendance_import.list_attendance_department_confirmations(COMPANY, MONTH)
	for name in frappe.get_all("HRMS Attendance Department Confirmation", filters={"company": COMPANY, "attendance_month": MONTH, "confirmation_scope": "月度部门工时", "attendance_lock_version": int(version)}, pluck="name"):
		attendance_import.review_attendance_department_confirmation(name, "confirm", "部门负责人确认")
	lock = attendance_import.lock_attendance_month(COMPANY, MONTH, "验收模拟公司月度考勤锁定")
	closure_file = _create_seed_workbook_file(f"{FILE_PREFIX}-薪资来源导入.xlsx", _closure_rows(roster))
	closure = payroll_input.import_payroll_data_closure_workbook(closure_file.file_url, MONTH, COMPANY, version)
	welfare_sync = payroll_input.sync_welfare_sources_to_payroll_variables(COMPANY, MONTH, version)
	variable_file = _create_seed_workbook_file(f"{FILE_PREFIX}-薪资变量导入.xlsx", _variable_rows(roster))
	variable_import = payroll_input.import_payroll_variable_workbook(variable_file.file_url, MONTH, COMPANY, version)
	inputs = payroll_input.generate_payroll_input_records(COMPANY, MONTH, version)
	settlements = payroll_input.generate_payroll_settlement_records(COMPANY, MONTH, version)
	confirmed = payroll_input.confirm_payroll_settlement_records(COMPANY, MONTH, version)
	actual = frappe.get_all("HRMS Payroll Settlement Record", filters={"company": COMPANY, "payroll_month": MONTH, "attendance_lock_version": version}, fields=["employee_code", "standard_hours", "basic_attendance_hours", "missing_hours", "adjusted_absence_hours", "gross_pay", "net_pay", "company_cost_total", "calculation_status"], order_by="employee_code asc")
	expected = _manual_expected(); differences = []
	for row in actual:
		for field, value in expected[row.employee_code].items():
			if _round(row.get(field, 0)) != _round(value):
				differences.append({"employee_code": row.employee_code, "field": field, "expected": value, "actual": row.get(field)})
	if len(actual) != len(EMPLOYEES) or differences or any(row.calculation_status != "已确认" for row in actual):
		frappe.throw(f"验收 seed 对账失败：{differences}")
	return {"company": COMPANY, "payroll_month": MONTH, "attendance": {"import": attendance_result, "manual_adjustment": manual, "exceptions": exceptions, "monthly": monthly, "lock": lock}, "payroll": {"closure": closure, "welfare_sync": welfare_sync, "variable_import": variable_import, "inputs": inputs, "settlements": settlements, "confirmed": confirmed}, "manual_reconciliation": {"passed": True, "expected": expected, "actual": actual}, "status": _status()}


@frappe.whitelist()
def get_realistic_payroll_e2e_status():
	return _status()


@frappe.whitelist()
def verify_realistic_payroll_e2e():
	"""Compare current settlement rows with an independently written calculation."""
	status = _status(); version = str((status.get("lock") or {}).get("active_version") or "")
	actual = frappe.get_all("HRMS Payroll Settlement Record", filters={"company": COMPANY, "payroll_month": MONTH, "attendance_lock_version": version}, fields=["employee_code", "standard_hours", "basic_attendance_hours", "missing_hours", "adjusted_absence_hours", "gross_pay", "net_pay", "company_cost_total", "calculation_status"], order_by="employee_code asc")
	expected = _manual_expected(); differences = []
	for row in actual:
		for field, value in expected.get(row.employee_code, {}).items():
			if _round(row.get(field, 0)) != _round(value):
				differences.append({"employee_code": row.employee_code, "field": field, "expected": value, "actual": row.get(field)})
	return {"passed": len(actual) == len(EMPLOYEES) and not differences and all(row.calculation_status == "已确认" for row in actual), "expected": expected, "actual": actual, "differences": differences}


@frappe.whitelist()
def reset_realistic_payroll_e2e(confirm: str = ""):
	"""Delete every record created by this isolated realistic acceptance fixture."""
	if confirm != "RESET REALISTIC PAYROLL E2E":
		frappe.throw('必须传入 confirm="RESET REALISTIC PAYROLL E2E" 才会清理验收 seed。')
	batches = frappe.get_all("HRMS Attendance Import Batch", filters={"company": COMPANY, "attendance_month": MONTH}, pluck="name")
	targets = (
		("File", {"file_name": ["like", f"{FILE_PREFIX}-%"]}),
		("HRMS Payroll Settlement Record", {"company": COMPANY, "payroll_month": MONTH}), ("HRMS Payroll Input Record", {"company": COMPANY, "payroll_month": MONTH}), ("HRMS Payroll Variable Record", {"company": COMPANY, "payroll_month": MONTH}), ("HRMS Payroll Variable Import Batch", {"company": COMPANY, "payroll_month": MONTH}), ("HRMS Payroll Welfare Source Record", {"company": COMPANY, "payroll_month": MONTH}), ("HRMS Employee Salary Change", {"company": COMPANY, "effective_date": ["between", [f"{MONTH}-01", f"{MONTH}-30"]]}),
		("HRMS Monthly Attendance Summary", {"company": COMPANY, "attendance_month": MONTH}), ("HRMS Attendance Department Confirmation", {"company": COMPANY, "attendance_month": MONTH}), ("HRMS Attendance Exception", {"import_batch": ["in", batches or ["__none__"]]}), ("HRMS Attendance Leave Evidence", {"import_batch": ["in", batches or ["__none__"]]}), ("HRMS Apple Reward Record", {"import_batch": ["in", batches or ["__none__"]]}), ("HRMS Attendance Day Check", {"import_batch": ["in", batches or ["__none__"]]}), ("HRMS Attendance Lock Audit", {"company": COMPANY, "attendance_month": MONTH}), ("HRMS Attendance Month Lock", {"company": COMPANY, "attendance_month": MONTH}), ("HRMS Attendance Import Batch", {"name": ["in", batches or ["__none__"]]}),
		("Employee", {"company": COMPANY}), ("Department", {"company": COMPANY}),
	)
	deleted = OrderedDict()
	for doctype, filters in targets:
		names = frappe.get_all(doctype, filters=filters, pluck="name")
		deleted[doctype] = len(names)
		# A local migration can leave hundreds of unrelated search-index jobs in
		# Redis.  ``delete_doc`` then refuses even this isolated cleanup because it
		# queues dynamic-link work per row.  These records are all private fixture
		# rows selected by exact company/month/prefix filters, so remove them in a
		# single database operation instead.  Files need their binary content
		# removed explicitly before their File rows are deleted.
		if doctype == "File":
			for name in names:
				frappe.get_doc("File", name).delete_file_data_content()
		if names:
			frappe.db.delete(doctype, {"name": ["in", names]})
	for designation in sorted({row["designation"] for row in EMPLOYEES}):
		if frappe.db.exists("Designation", designation):
			frappe.db.delete("Designation", {"name": designation})
	if frappe.db.exists("Company", COMPANY):
		frappe.db.delete("Company", {"name": COMPANY})
	frappe.db.commit()
	return {"deleted": deleted, "status": _status()}
