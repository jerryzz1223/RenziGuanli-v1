"""Focused personnel regressions; no running Frappe site required."""
import ast
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "hrms/overrides/employee_master.py"
API = ROOT / "hrms/api/employee_field_template.py"

def load_function(path, name, **dependencies):
	node = next(n for n in ast.parse(path.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == name)
	exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), "exec"), dependencies)
	return dependencies[name]

class PersonnelRepairs(unittest.TestCase):
	def employee(self, **values):
		class Doc(SimpleNamespace):
			def get(self, field): return getattr(self, field, None)
		return Doc(flags=SimpleNamespace(hrms_employee_roster_import=True), meta=SimpleNamespace(has_field=lambda _: True),
			is_new=lambda: True, has_value_changed=lambda _: False, **values)

	def test_departed_import_preserves_state_and_date_without_work_nature_column(self):
		apply = load_function(MASTER, "apply_employee_work_nature", cstr=lambda v: str(v or ""),
			WORK_NATURE_OPTIONS=("在职·正式", "在职·试用期", "退休返聘", "待离职", "离职"),
			_find_employment_type=lambda *args: args[0])
		for flag, status, nature in [(True, "Left", "离职"), (True, "Inactive", "待离职"), (True, "Active", "在职·试用期"), (False, "Left", "在职·试用期")]:
			with self.subTest(flag=flag, status=status):
				doc = self.employee(status=status, relieving_date="2026-09-01")
				doc.flags.hrms_employee_roster_import = flag
				apply(doc)
				self.assertEqual(doc.custom_work_nature, nature)
				if flag and status == "Left":
					self.assertEqual(doc.status, "Left")
					self.assertEqual(doc.relieving_date, "2026-09-01")

	def test_explicit_departed_import_still_requires_departure_date(self):
		# Stop after the date guard so unrelated link validation cannot mask it.
		node = next(n for n in ast.parse(API.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == "_validate_employee_import_row")
		end = next(i for i,n in enumerate(node.body) if isinstance(n, ast.If) and "relieving_date" in ast.unparse(n.test))
		node.body = node.body[:end+1] + [ast.Return(ast.Name("errors", ast.Load()))]
		ast.fix_missing_locations(node)
		ns = {"_is_blank_value": lambda v: v in (None, ""), "_": lambda s: s,
			"EMPLOYEE_DUPLICATE_MATCH_FIELDS": {}, "_field_error": lambda row, field, message, *_: {"fieldname":field["fieldname"], "message":message}}
		exec(compile(ast.Module(body=[node], type_ignores=[]), str(API), "exec"), ns)
		validate=ns["_validate_employee_import_row"]
		self.assertEqual(validate({"status":"Left"}, {}, {}, 2)[0]["fieldname"], "relieving_date")
		self.assertEqual(validate({"status":"Left", "relieving_date":"2026-09-01"}, {}, {}, 2), [])

	def test_optional_candidate_and_email_do_not_disable_other_mandatory_checks(self):
		class Base:
			def _get_missing_mandatory_fields(self):
				return [(f,f) for f in ("job_applicant", "personal_email", "company_email", "prefered_contact_email", "first_name", "custom_employee_code")]
			def get(self, key): return getattr(self, key, None)
		node=next(n for n in ast.parse(MASTER.read_text()).body if isinstance(n, ast.ClassDef) and n.name=="EmployeeMaster")
		node.body=[n for n in node.body if isinstance(n, ast.FunctionDef) and n.name=="_get_missing_mandatory_fields"]
		ns={"Employee":Base, "cint":lambda v:int(v or 0)}
		exec(compile(ast.Module(body=[node], type_ignores=[]), str(MASTER), "exec"),ns)
		doc=ns["EmployeeMaster"]()
		self.assertEqual([f for f,_ in doc._get_missing_mandatory_fields()], ["first_name", "custom_employee_code"])
		doc.create_user_automatically=1
		self.assertIn("personal_email", [f for f,_ in doc._get_missing_mandatory_fields()])

	def test_linked_recruitment_still_checks_onboarding_completion(self):
		calls=[]
		frappe=SimpleNamespace(get_all=lambda *a,**k:[SimpleNamespace(name="ONB-1")],
			get_doc=lambda *a:SimpleNamespace(validate_employee_creation=lambda:calls.append("validate"), db_set=lambda *a:calls.append(a)))
		validate=load_function(MASTER,"validate_onboarding_process",frappe=frappe)
		validate(SimpleNamespace(job_applicant=None))
		self.assertEqual(calls,[])
		validate(SimpleNamespace(job_applicant="CAND-1",name="EMP-1"))
		self.assertEqual(calls,["validate",("employee","EMP-1")])

	def test_roster_required_metadata_does_not_require_candidate_or_account_email(self):
		check=load_function(API,"_employee_roster_mandatory_field_errors",
			EMPLOYEE_INTERNAL_FIELDNAMES=set(), EMPLOYEE_FALLBACK_DATE_OF_BIRTH="1905-01-01",
			_is_blank_value=lambda v:v in (None,""), _=lambda s:s,
			_field_error=lambda row, field, message, *_:{"fieldname":field["fieldname"],"message":message})
		meta={f:{"reqd":1} for f in ("job_applicant","personal_email","first_name")}
		self.assertEqual(check({"first_name":"归档员工"},"insert","insert",2,{},meta),[])
		self.assertEqual(check({},"insert","insert",2,{},meta)[0]["fieldname"],"first_name")

	def test_server_contract_reminders(self):
		spec=importlib.util.spec_from_file_location("contract", ROOT/"hrms/utils/personnel_contract_reminders.py")
		module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
		warning=module.contract_expiry_warning
		for end, expected in [("2026-11-15",True),("2026-11-16",False),("2026-09-14",True),("",False),("2026-02-30",False)]:
			self.assertEqual(warning({"status":"Active","contract_end_date":end},"2026-09-15"),expected)
		for state in [{"status":"Left"},{"status":"Active","custom_work_nature":"离职"}]:
			self.assertFalse(warning({**state,"contract_end_date":"2026-09-01"},"2026-09-15"))
		self.assertTrue(warning({"contract_end_date":"2026-03-31"},"2026-01-31"))

if __name__=="__main__": unittest.main()
