"""Repair company ownership added after early HRMS trial imports.

The first local payroll/attendance trial predated the required ``company``
fields on several HRMS DocTypes.  Those rows remained valid historical data,
but company-scoped pages could no longer see them once Yongxin isolation was
enforced.  This patch restores only provable ownership:

* real historical rows are attached to Yongxin;
* explicit SEED/2099 fixtures are quarantined under the existing test company;
* employee links are refreshed only when company + normalized employee code +
  name identify one current Yongxin employee.

No business row is deleted and timestamps are preserved.
"""

from __future__ import annotations

from collections import defaultdict

import frappe


YONGXIN_COMPANY = "永新"
TEST_COMPANY = "_Test Company"

EMPLOYEE_SCOPED_DOCTYPES = (
	"HRMS Monthly Attendance Summary",
	"HRMS Payroll Settlement Record",
	"HRMS Employee Salary Change",
	"HRMS Payroll Input Record",
	"HRMS Payroll Welfare Source Record",
)


def _doctype_available(doctype: str) -> bool:
	return bool(frappe.db.exists("DocType", doctype))


def _blank_company_rows(doctype: str, fields: list[str]):
	if not _doctype_available(doctype):
		return []
	return frappe.get_all(
		doctype,
		filters={"company": ["is", "not set"]},
		fields=list(dict.fromkeys(["name", *fields])),
		limit_page_length=0,
	)


def _is_seed_record(row) -> bool:
	code = str(row.get("employee_code") or "").strip().upper()
	name = str(row.get("employee_name") or "").strip()
	return code.startswith("SEED") or name.startswith("测试")


def _set_company(doctype: str, name: str, company: str, counters: dict[str, int]):
	frappe.db.set_value(doctype, name, "company", company, update_modified=False)
	counters[f"{doctype} -> {company}"] += 1


def _repair_blank_company_values(counters: dict[str, int]):
	for doctype in EMPLOYEE_SCOPED_DOCTYPES:
		for row in _blank_company_rows(doctype, ["employee_code", "employee_name"]):
			company = TEST_COMPANY if _is_seed_record(row) and frappe.db.exists("Company", TEST_COMPANY) else YONGXIN_COMPANY
			_set_company(doctype, row.name, company, counters)

	for row in _blank_company_rows("HRMS Payroll Variable Import Batch", ["payroll_month", "source_file"]):
		is_seed = str(row.get("payroll_month") or "").startswith("2099-")
		company = TEST_COMPANY if is_seed and frappe.db.exists("Company", TEST_COMPANY) else YONGXIN_COMPANY
		_set_company("HRMS Payroll Variable Import Batch", row.name, company, counters)

	for row in _blank_company_rows("HRMS Payroll Rule", ["rule_code", "source_file"]):
		source = f"{row.get('rule_code') or ''} {row.get('source_file') or ''}".upper()
		is_seed = "TEST" in source or "SEED" in source
		company = TEST_COMPANY if is_seed and frappe.db.exists("Company", TEST_COMPANY) else YONGXIN_COMPANY
		_set_company("HRMS Payroll Rule", row.name, company, counters)


def _quarantine_retired_cleanup_fixtures(counters: dict[str, int]):
	"""Keep fixture audit rows valid without exposing them in Yongxin."""
	if not (_doctype_available("HRMS Form Import Batch") and frappe.db.exists("Company", TEST_COMPANY)):
		return
	valid_companies = set(frappe.get_all("Company", pluck="name"))
	rows = frappe.get_all("HRMS Form Import Batch", fields=["name", "company"], limit_page_length=0)
	for row in rows:
		company = str(row.company or "")
		if company and company not in valid_companies and company.startswith("_Cleanup Test"):
			_set_company("HRMS Form Import Batch", row.name, TEST_COMPANY, counters)


def _normalize_employee_code(value: str) -> str:
	code = str(value or "").strip().upper()
	if code.isdigit():
		return code.lstrip("0") or "0"
	return code


def _employee_indexes():
	by_code = defaultdict(list)
	for employee in frappe.get_all(
		"Employee",
		filters={"company": YONGXIN_COMPANY},
		fields=["name", "employee_name", "custom_employee_code"],
		limit_page_length=0,
	):
		code = _normalize_employee_code(employee.custom_employee_code)
		if code:
			by_code[code].append(employee)
	return by_code


def _repair_employee_links(counters: dict[str, int]):
	by_code = _employee_indexes()
	for doctype in EMPLOYEE_SCOPED_DOCTYPES:
		if not _doctype_available(doctype):
			continue
		rows = frappe.get_all(
			doctype,
			filters={"company": YONGXIN_COMPANY},
			fields=["name", "employee", "employee_code", "employee_name"],
			limit_page_length=0,
		)
		for row in rows:
			if row.employee and frappe.db.get_value("Employee", row.employee, "company") == YONGXIN_COMPANY:
				continue
			candidates = by_code.get(_normalize_employee_code(row.employee_code), [])
			if len(candidates) != 1:
				continue
			candidate = candidates[0]
			if row.employee_name and candidate.employee_name != row.employee_name:
				continue
			frappe.db.set_value(doctype, row.name, "employee", candidate.name, update_modified=False)
			counters[f"{doctype} employee link"] += 1


def execute():
	if not frappe.db.exists("Company", YONGXIN_COMPANY):
		frappe.throw("历史公司关系修复已中止：未找到“永新”公司。")

	counters = defaultdict(int)
	_repair_blank_company_values(counters)
	_quarantine_retired_cleanup_fixtures(counters)
	_repair_employee_links(counters)

	frappe.clear_cache()
	if counters:
		print("永新公司与历史数据关系已修复：" + "；".join(f"{key} {value} 条" for key, value in sorted(counters.items())))
