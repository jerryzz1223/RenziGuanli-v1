"""Execute manual-correction guards and trusted saves without a Frappe site."""
import importlib.util
import ast
from datetime import datetime
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]

class Doc:
	def __init__(self, old=None, **new):
		self.old=old
		self.values={"status":"Left","custom_work_nature":"离职","relieving_date":"2026-10-01","reason_for_leaving":"历史纠错",**new}
		self.flags=SimpleNamespace()
		self.comments=[]
	def get(self,key):return self.values.get(key)
	def get_doc_before_save(self):return SimpleNamespace(get=lambda key:self.old.get(key)) if self.old else None
	def is_new(self):return self.old is None
	def add_comment(self,*args):self.comments.append(args)

class EmployeeStatusCorrectionTests(unittest.TestCase):
	def setUp(self):
		def reject(message, exception=ValueError):raise exception(message)
		self.frappe=SimpleNamespace(session=SimpleNamespace(user="HR-USER"), get_roles=lambda _:[],throw=reject,PermissionError=PermissionError,_=lambda s:s)
		spec=importlib.util.spec_from_file_location("status_updates",ROOT/"hrms/utils/employee_status_updates.py")
		self.module=importlib.util.module_from_spec(spec)
		frappe_patch=patch.dict(sys.modules,{"frappe":self.frappe})
		frappe_patch.start()
		self.addCleanup(frappe_patch.stop)
		spec.loader.exec_module(self.module)
		self.active={"status":"Active","custom_work_nature":"在职·正式"}

	def test_regular_writer_cannot_directly_depart_or_restore_employee(self):
		for doc in [Doc(self.active), Doc({"status":"Left","custom_work_nature":"离职"},status="Active",custom_work_nature="在职·正式")]:
			with self.subTest(doc=doc.values),self.assertRaisesRegex(PermissionError,"日常离职"):
				self.module.validate_employee_status_correction(doc)

	def test_administrator_requires_date_and_reason_and_audits_changes(self):
		self.frappe.session.user="Administrator"
		for field, message in [("relieving_date","日期"),("reason_for_leaving","原因")]:
			with self.subTest(field=field),self.assertRaisesRegex(ValueError,message):
				self.module.validate_employee_status_correction(Doc(self.active,**{field:""}))
		doc=Doc(self.active,reason_for_leaving="历史补录 <script>")
		self.module.validate_employee_status_correction(doc)
		self.module.record_employee_status_correction(doc)
		self.assertEqual(len(doc.comments),1)
		self.assertIn("Administrator",doc.comments[0][1])
		self.assertIn("Active → Left",doc.comments[0][1])
		self.assertIn("&lt;script&gt;",doc.comments[0][1])
		self.module.record_employee_status_correction(doc)
		self.assertEqual(len(doc.comments),1)

	def test_system_manager_can_correct_but_unrelated_edits_are_untouched(self):
		self.frappe.get_roles=lambda _:["System Manager"]
		doc=Doc(self.active)
		self.module.validate_employee_status_correction(doc)
		self.assertIsNotNone(doc.flags.hrms_status_correction)
		self.frappe.get_roles=lambda _:[]
		doc=Doc({"status":"Left","custom_work_nature":"离职","relieving_date":"2026-10-01","reason_for_leaving":"历史纠错"})
		self.module.validate_employee_status_correction(doc)
		self.assertIsNone(doc.flags.hrms_status_correction)

	def test_trusted_workflow_and_archive_saves_are_scoped_and_reset_on_failure(self):
		for source in ("separation","roster_import"):
			doc=Doc(self.active,reason_for_leaving="",relieving_date="")
			doc.save=lambda **kwargs:self.module.validate_employee_status_correction(doc)
			self.module.save_employee_status_update(doc,source,ignore_permissions=True)
			with self.assertRaises(PermissionError):self.module.validate_employee_status_correction(doc)
		def fail():raise RuntimeError("save failed")
		doc.save=fail
		with self.assertRaises(RuntimeError):self.module.save_employee_status_update(doc,"separation")
		self.assertIsNone(self.module._status_write.get())

	def test_real_separation_methods_save_for_non_admin_through_trusted_context(self):
		class Employee(Doc):
			def __setattr__(self,key,value):
				if key in {"status","custom_work_nature","relieving_date","reason_for_leaving"}:
					self.values[key]=value
				else:object.__setattr__(self,key,value)
		employee=Employee(self.active,**self.active)
		employee.meta=SimpleNamespace(has_field=lambda _:True)
		employee.save=lambda:self.module.validate_employee_status_correction(employee)
		self.frappe.db=SimpleNamespace(exists=lambda *args:True)
		self.frappe.get_doc=lambda *args:employee
		source=ROOT/"hrms/hr/doctype/employee_separation/employee_separation.py"
		cls=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.ClassDef) and n.name=="EmployeeSeparation")
		cls.bases=[]
		cls.body=[n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name in {"_set_employee_pending_state","_set_employee_departure_state"}]
		ns={"frappe":self.frappe,"get_datetime":datetime.fromisoformat,"getdate":lambda v:v.date(),"_current_system_datetime":lambda:datetime(2026,10,23)}
		exec(compile(ast.Module(body=[cls],type_ignores=[]),str(source),"exec"),ns)
		separation=ns["EmployeeSeparation"]()
		separation.employee="EMP-1"
		separation.departed_on="2026-10-01 09:00:00"
		with patch.dict(sys.modules,{"hrms.utils.employee_status_updates":self.module}):
			self.assertTrue(separation._set_employee_pending_state())
			self.assertEqual(employee.get("status"),"Inactive")
			self.assertTrue(separation._set_employee_departure_state())
			self.assertEqual(employee.get("status"),"Left")
			self.assertEqual(str(employee.get("relieving_date")),"2026-10-01")
		self.assertIsNone(self.module._status_write.get())

	def test_posted_document_flags_do_not_bypass_manual_guard(self):
		doc=Doc(self.active)
		doc.flags.hrms_employee_roster_import=True
		doc.flags.hrms_dingtalk_sync=True
		with self.assertRaises(PermissionError):self.module.validate_employee_status_correction(doc)

if __name__=="__main__":unittest.main()
