"""Local TEST-HRMS acceptance. Run inside an initialized Frappe site.

Uses a previously unused test month; leaves synthetic records for browser QA.
Never edits a production company's records.
"""
import json
from pathlib import Path

import frappe
from openpyxl import load_workbook
from hrms.api import attendance_processing_center as api


def run():
	frappe.set_user("Administrator")
	company, month = "TEST-HRMS", "2099-10"
	assert frappe.db.exists("Company", company), "TEST-HRMS foundation is required"
	for batch in frappe.get_all(api.IMPORT_BATCH_DOCTYPE, filters={"company": company, "attendance_month": month}, fields=["source_checksum"]):
		assert batch.source_checksum.startswith("TEST-optional-2099-10-"), "Foreign test data; do not overwrite it"

	def fixture(data, filters):
		name = frappe.db.get_value(data["doctype"], filters, "name")
		if name:
			doc = frappe.get_doc(data["doctype"], name)
			doc.update({key: value for key, value in data.items() if key not in {"doctype", "notes"}})
			return doc.save(ignore_permissions=True)
		return frappe.get_doc(data).insert(ignore_permissions=True)
	for number in (1, 2):
		code = f"TEST-OPT-{number:03d}"
		if not frappe.db.exists("Employee", {"company": company, "custom_employee_code": code}):
			frappe.get_doc({"doctype": "Employee", "company": company, "custom_employee_code": code, "first_name": f"TEST-可选来源{number}", "gender": "Male", "date_of_birth": "1990-01-01", "date_of_joining": "2026-01-01", "status": "Active"}).insert(ignore_permissions=True)
	employees = [row for row in api._employee_directory(company) if row.get("employee_code", "").startswith("TEST-OPT-")][:2]
	assert len(employees) == 2, "Need two synthetic TEST-HRMS employees"
	output = Path("/workspace/outputs/attendance-optional-runtime-2099-10")
	output.mkdir(parents=True, exist_ok=True)
	batches = {}
	for source in ("attendance_draft", "housing_allowance"):
		batches[source] = fixture({"doctype": api.IMPORT_BATCH_DOCTYPE, "company": company, "attendance_month": month, "source_type": source, "source_file": "/private/files/TEST-optional-" + source + ".xlsx", "source_checksum": "TEST-optional-2099-10-" + source, "status": "已确认", "imported_by": "Administrator", "notes": json.dumps({"attendance_processing_center": {"monthly_support_precheck": {"is_valid": True, "record_count": 1}}})}, {"company": company, "attendance_month": month, "source_type": source})
	attendance_records = []
	for employee in employees:
		values = {"employee_code": employee["employee_code"], "employee_name": employee.get("employee_name") or "TEST", "department": employee.get("department") or "", "standard_hours": 160, "actual_attendance_hours": 160, "source_row_count": 20}
		attendance_records.append(fixture({"doctype": api.PROCESSING_RECORD_DOCTYPE, "import_batch": batches["attendance_draft"].name, "company": company, "attendance_month": month, "source_type": "attendance_draft", "employee_code": values["employee_code"], "employee_name": values["employee_name"], "processed_value_json": json.dumps(values), "proposed_value_json": json.dumps(values), "review_status": "无需审核", "exception_codes": "[]", "eligible_for_downstream": 1}, {"import_batch": batches["attendance_draft"].name, "employee_code": values["employee_code"]}))
	values = {"employee_code": employees[0]["employee_code"], "employee_name": employees[0].get("employee_name") or "TEST", "housing_allowance": 0}
	housing = fixture({"doctype": api.PROCESSING_RECORD_DOCTYPE, "import_batch": batches["housing_allowance"].name, "company": company, "attendance_month": month, "source_type": "housing_allowance", "employee_code": values["employee_code"], "employee_name": values["employee_name"], "processed_value_json": json.dumps(values), "proposed_value_json": json.dumps(values), "review_status": "无需审核", "exception_codes": "[]", "eligible_for_downstream": 1}, {"import_batch": batches["housing_allowance"].name, "employee_code": values["employee_code"]})
	checks = api.get_monthly_final_generation_check(company, month)
	assert checks["ready"], checks
	assert len([item for item in checks["inputs"] if not item["provided"]]) == 4
	housing_check = next(item for item in checks["inputs"] if item["source_type"] == "housing_allowance")
	assert any(entry.get("employee_code") == employees[1]["employee_code"] for entry in housing_check["missing_items"])
	# A confirmed batch must not conceal a pending employee record.
	attendance_records[0].review_status = "待审核"
	attendance_records[0].exception_codes = '["ATTENDANCE_HOURS_MISMATCH"]'
	attendance_records[0].exception_message = "TEST:工时不一致，必须修正"
	attendance_records[0].save(ignore_permissions=True)
	assert not api.get_monthly_final_generation_check(company, month)["ready"]
	assert api.generate_monthly_final_files(company, month)["blocked"]
	attendance_records[0].review_status = "已通过"
	attendance_records[0].exception_codes = "[]"
	attendance_records[0].exception_message = ""
	attendance_records[0].save(ignore_permissions=True)
	# An automatically excluded import error still blocks the monthly lock.
	housing.exception_codes = '["INVALID_AMOUNT"]'
	housing.eligible_for_downstream = 0
	housing.save(ignore_permissions=True)
	assert not api.get_monthly_final_generation_check(company, month)["ready"]
	housing.exception_codes = "[]"
	housing.eligible_for_downstream = 1
	housing.save(ignore_permissions=True)
	api.approve_monthly_final_in_one_click(company, month, "TEST:可选来源与错误拦截验收")
	result = api.generate_monthly_final_files(company, month)
	assert not result["blocked"], result
	urls = [result["first_signed_outputs"]["file_url"], result["final_outputs"]["signed_file_url"], result["final_outputs"]["finance_file_url"]]
	for url in urls:
		file_doc = frappe.get_doc("File", {"file_url": url})
		path = Path(file_doc.get_full_path())
		book = load_workbook(path)
		assert "生成检查清单" in book.sheetnames
		if "工时汇总" in book.sheetnames:
			assert all(book["工时汇总"][f"I{r}"].value is None for r in (5, 6))
		if "第二次员工签字版" in book.sheetnames:
			assert all(book["第二次员工签字版"][f"J{r}"].value is None for r in (5, 6))
		if "财务版" in book.sheetnames:
			assert sorted([book["财务版"][f"P{r}"].value for r in (5, 6)], key=lambda v: v is None) == [0, None]
			assert book["财务版"]["Q5"].value is None
		(output / path.name).write_bytes(path.read_bytes())
	preview = api.get_monthly_final_preview(company, month, "finance")
	assert preview["available"] and len(preview["rows"]) == 2
	assert sum(row["housing_allowance"] is None for row in preview["rows"]) == 1
	# Reopen an error after a lock: the downstream reader must reject it.
	attendance_records[0].review_status = "待审核"
	attendance_records[0].save(ignore_permissions=True)
	assert not api.get_monthly_final_preview(company, month, "finance")["available"]
	attendance_records[0].review_status = "已通过"
	attendance_records[0].save(ignore_permissions=True)
	api.approve_monthly_final_in_one_click(company, month, "TEST:恢复有效版本供页面验收")
	result = api.generate_monthly_final_files(company, month)
	assert not result["blocked"]
	from hrms.api import payroll_input
	lock_version = payroll_input.PROCESSING_ATTENDANCE_LOCK_PREFIX + result["snapshot_version"]
	synced = payroll_input.sync_locked_attendance_final_to_payroll(company, month, lock_version)
	assert synced["variable_rows"] == 1, synced
	variables = frappe.get_all(payroll_input.VARIABLE_RECORD_DOCTYPE, filters={"company": company, "payroll_month": month, "attendance_lock_version": lock_version}, fields=["variable_type", "amount"])
	assert len(variables) == 1 and variables[0].variable_type == "住房补贴" and variables[0].amount == 0
	urls = [result["first_signed_outputs"]["file_url"], result["final_outputs"]["signed_file_url"], result["final_outputs"]["finance_file_url"]]
	for url, label in zip(urls, ("一次签字版.xlsx", "第二次员工签字版.xlsx", "财务版.xlsx")):
		file_doc = frappe.get_doc("File", {"file_url": url})
		(output / label).write_bytes(Path(file_doc.get_full_path()).read_bytes())
	report = {"company": company, "month": month, "employee_count": 2, "missing_optional_sources": 4, "missing_employee_housing": 1, "pending_record_blocked": True, "excluded_import_error_blocked": True, "downstream_error_blocked": True, "three_files_generated": True, "blank_and_zero_verified": True, "source_quality_saved": True, "payroll_missing_amounts_not_inserted": True, "files": urls}
	(output / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
	frappe.db.commit()
	print(json.dumps(report, ensure_ascii=False))


run()
