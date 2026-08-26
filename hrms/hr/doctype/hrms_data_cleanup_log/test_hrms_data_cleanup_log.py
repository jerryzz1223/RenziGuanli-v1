import frappe
from frappe.tests import UnitTestCase

from hrms.api.data_operations import execute_company_data_cleanup, preview_company_data_cleanup


class TestHRMSDataCleanupLog(UnitTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		suffix = frappe.generate_hash(length=6).upper()
		self.company = f"_Cleanup Test {suffix}"
		self.company_abbr = suffix[:5]
		company_doc = frappe.get_doc(
			{
				"doctype": "Company",
				"name": self.company,
				"company_name": self.company,
				"abbr": self.company_abbr,
				"default_currency": "INR",
				"country": "India",
			}
		)
		# These tests need a valid Link target, not Company setup side effects such
		# as chart-of-accounts and standard departments.
		company_doc.db_insert()

	def tearDown(self):
		for doctype in (
			"HRMS Attendance Processing Record",
			"HRMS Attendance Import Batch",
			"HRMS Business Process Record",
			"HRMS Form Import Row",
			"HRMS Form Import Batch",
		):
			frappe.db.delete(doctype, {"company": self.company})
		frappe.db.delete("HRMS Data Cleanup Log", {"company_code": self.company})
		frappe.db.delete("Department", {"company": self.company})
		frappe.db.delete("Company", {"name": self.company})

	def make_form_batch(self):
		return frappe.get_doc(
			{
				"doctype": "HRMS Form Import Batch",
				"company": self.company,
				"module_name": "system_feedback",
				"template_key": "cleanup-test",
				"template_name": "Cleanup Test",
				"source_file": "/files/cleanup-test.xlsx",
				"status": "已导入待处理",
			}
		).insert(ignore_permissions=True)

	def test_company_setup_uses_company_scoped_department_keys(self):
		department = frappe.get_doc(
			{
				"doctype": "Department",
				"department_name": "Shared Operations",
				"company": self.company,
				"is_group": 1,
			}
		).insert(ignore_permissions=True)
		self.assertEqual(department.department_name, "Shared Operations")
		self.assertEqual(department.company, self.company)
		self.assertEqual(department.name, f"Shared Operations - {self.company_abbr}")

	def test_preview_is_company_scoped_and_stable(self):
		batch = self.make_form_batch()
		preview = preview_company_data_cleanup(self.company, ["form_intake"])

		self.assertEqual(preview["company"], self.company)
		self.assertEqual(preview["count"], 1)
		self.assertEqual(preview["blockers"], [])
		self.assertEqual(len(preview["plan_token"]), 64)
		self.assertIn(batch.name, preview["records"][0]["sample_names"])

	def test_execute_requires_preview_and_preserves_company(self):
		batch = self.make_form_batch()
		preview = preview_company_data_cleanup(self.company, ["form_intake"])

		with self.assertRaises(frappe.ValidationError):
			execute_company_data_cleanup(
				self.company,
				["form_intake"],
				confirm="wrong confirmation",
				plan_token=preview["plan_token"],
			)

		result = execute_company_data_cleanup(
			self.company,
			["form_intake"],
			confirm=preview["confirmation_text"],
			plan_token=preview["plan_token"],
		)

		self.assertEqual(result["count"], 1)
		self.assertFalse(frappe.db.exists("HRMS Form Import Batch", batch.name))
		self.assertTrue(frappe.db.exists("Company", self.company))
		self.assertTrue(frappe.db.exists("HRMS Data Cleanup Log", {"company_code": self.company, "record_count": 1}))

	def test_changed_data_invalidates_preview_token(self):
		self.make_form_batch()
		preview = preview_company_data_cleanup(self.company, ["form_intake"])
		self.make_form_batch()

		with self.assertRaises(frappe.ValidationError):
			execute_company_data_cleanup(
				self.company,
				["form_intake"],
				confirm=preview["confirmation_text"],
				plan_token=preview["plan_token"],
			)

	def test_attendance_cleanup_removes_processing_records_before_import_batches(self):
		batch = frappe.get_doc(
			{
				"doctype": "HRMS Attendance Import Batch",
				"company": self.company,
				"attendance_month": "2026-08",
				"source_file": "/files/cleanup-attendance-test.xlsx",
				"status": "待处理",
			}
		).insert(ignore_permissions=True)
		record = frappe.get_doc(
			{
				"doctype": "HRMS Attendance Processing Record",
				"company": self.company,
				"attendance_month": "2026-08",
				"import_batch": batch.name,
				"source_type": "attendance_draft",
				"employee_code": "CLEANUP-TEST",
				"employee_name": "Cleanup Test",
				"review_status": "待审核",
			}
		).insert(ignore_permissions=True)

		preview = preview_company_data_cleanup(self.company, ["attendance"])
		self.assertEqual(preview["count"], 2)

		execute_company_data_cleanup(
			self.company,
			["attendance"],
			confirm=preview["confirmation_text"],
			plan_token=preview["plan_token"],
		)

		self.assertFalse(frappe.db.exists("HRMS Attendance Processing Record", record.name))
		self.assertFalse(frappe.db.exists("HRMS Attendance Import Batch", batch.name))
