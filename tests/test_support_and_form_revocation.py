"""Exercise mutation and visibility boundaries without requiring a live Frappe site."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Row(dict):
    def __getattr__(self, name):
        return self.get(name)

    def check_permission(self, permission):
        if permission in self.get('denied', []):
            raise PermissionError(permission)

    def db_set(self, values):
        self.update(values)


def functions(path, names, env):
    tree = ast.parse((ROOT / path).read_text())
    selected = [node for node in tree.body if getattr(node, 'name', None) in names]
    for node in selected:
        if isinstance(node, ast.FunctionDef):
            node.decorator_list = []
    exec(compile(ast.Module(body=selected, type_ignores=[]), path, 'exec'), env)
    return SimpleNamespace(**{name: env[name] for name in names})


def fail(message, error=ValueError):
    raise error(message)


class RevocationTests(unittest.TestCase):
    def setUp(self):
        self.file = Row(name='FILE-1', attached_to_doctype='Employee', attached_to_name='EMP-1',
                        attached_to_field='hrms_material_employee_talk_form', owner='hr',
                        file_name='proof.pdf', file_url='/private/files/proof.pdf', creation='2026-10-01')
        self.employee = Row(name='EMP-1', employee_name='Test', custom_employee_code='123', status='Active')
        self.frappe = SimpleNamespace(
            throw=fail, session=SimpleNamespace(user='hr'),
            db=SimpleNamespace(has_column=lambda *a: True, sql=lambda *a: None),
            utils=SimpleNamespace(now=lambda: '2026-10-28 10:00:00'),
            get_doc=lambda dt, name: self.file if dt == 'File' else self.employee,
            get_list=self.get_list, get_all=lambda *a, **k: [])
        self.api = functions('hrms/api/employee_form_entry.py',
            ['revoke_employee_form_entry', 'list_employee_form_entries', 'get_employee_form_entry_summaries'],
            dict(frappe=self.frappe, _=lambda s:s, _require_employee_form_entry_access=lambda:None,
                 _form_entry_type=lambda t: {'material_type': t}, EMPLOYEE_MATERIAL_FIELD_PREFIX='hrms_material_',
                 REVOKED_MATERIAL_PREFIX='hrms_revoked_', EMPLOYEE_ATTACHMENT_TITLE_FIELD='title',
                 REVOCATION_FIELDS=['custom_hrms_revocation_reason', 'custom_hrms_revoked_by', 'custom_hrms_revoked_at'],
                 _employee_attachment_title_field_available=lambda:False,
                 _employee_search_filters=lambda c:{},
                 EMPLOYEE_FORM_ENTRY_TYPES={'talk': {'material_type':'employee_talk_form'}}))

    def get_list(self, doctype, filters, **kwargs):
        if doctype == 'Employee':
            return [self.employee]
        accepted = filters['attached_to_field'][1]
        return [self.file] if self.file.attached_to_field in accepted else []

    def revoke(self, reason='录入错误', kind='employee_talk_form'):
        return self.api.revoke_employee_form_entry('FILE-1', kind, reason)

    def test_three_form_types_keep_record_and_remove_latest_summary(self):
        for kind in ['employee_talk_form', 'employee_transfer_application', 'reward_punishment_report']:
            self.file['attached_to_field'] = 'hrms_material_' + kind
            self.revoke(kind=kind)
            rows = self.api.list_employee_form_entries(kind)
            self.assertEqual(rows[0]['entry_status'], '已撤销')
            self.assertEqual(rows[0]['revocation_reason'], '录入错误')
            self.assertEqual(rows[0]['file_url'], '/private/files/proof.pdf')
        self.file['attached_to_field'] = 'hrms_revoked_employee_talk_form'
        self.assertIsNone(self.api.get_employee_form_entry_summaries('EMP-1')['talk'])

    def test_reason_required_and_bounded(self):
        for reason in ['', '  ', 'x' * 1001]:
            with self.assertRaises(ValueError): self.revoke(reason)
        self.assertEqual(self.file.attached_to_field, 'hrms_material_employee_talk_form')

    def test_permissions_and_wrong_type_do_not_mutate(self):
        self.employee['denied'] = ['write']
        with self.assertRaises(PermissionError): self.revoke()
        self.employee['denied'] = []
        with self.assertRaises(ValueError): self.revoke(kind='reward_punishment_report')
        self.assertNotIn('custom_hrms_revocation_reason', self.file)

    def test_repeated_request_preserves_original_evidence(self):
        self.revoke('first')
        self.revoke('second')
        self.assertEqual(self.file.custom_hrms_revocation_reason, 'first')

    def test_employee_archive_omits_revoked_but_keeps_legacy_and_active(self):
        files = [Row(self.file, attached_to_field=field) for field in [
            'employee_talk_form', 'hrms_material_employee_talk_form', 'hrms_revoked_employee_talk_form']]
        self.frappe.get_all = lambda dt, **k: files if dt == 'File' else []
        api = functions('hrms/api/employee_field_template.py', ['_get_employee_materials'],
            dict(frappe=self.frappe, EMPLOYEE_DOCTYPE='Employee', EMPLOYEE_MATERIAL_FIELD_PREFIX='hrms_material_',
                 _get_employee_material_type_map=lambda:{'talk':{'fieldname':'hrms_material_employee_talk_form'}},
                 _employee_attachment_title_field_available=lambda:False,
                 _employee_file_payload=lambda row, **k: row.attached_to_field,
                 EMPLOYEE_MATERIAL_GROUPS=[{'label':'forms', 'description':'', 'types':[('talk','Talk')]}]))
        material = api._get_employee_materials(self.employee)[0]['types'][0]
        self.assertEqual(material['current_file'], 'employee_talk_form')
        self.assertEqual(material['history_files'], ['hrms_material_employee_talk_form'])


class SupportTests(unittest.TestCase):
    def setUp(self):
        self.filters = []
        self.frappe = SimpleNamespace(throw=fail, db=SimpleNamespace(exists=self.exists))
        self.api = functions('hrms/hr/doctype/cross_department_support_capability/cross_department_support_capability.py',
            ['_find_duplicate_capability', 'delete_support_capability'], dict(frappe=self.frappe, cstr=str))

    def exists(self, doctype, filters):
        self.filters.append(filters)
        return filters['employee'] == 'EMP-1' and filters['support_designation'] == 'IPQC' and filters.get('name') != ['!=', 'SELF']

    def test_identity_different_role_and_edit_self(self):
        self.assertTrue(self.api._find_duplicate_capability('EMP-1','IPQC'))
        self.assertFalse(self.api._find_duplicate_capability('EMP-2','IPQC'))
        self.assertFalse(self.api._find_duplicate_capability('EMP-1','QE'))
        self.assertFalse(self.api._find_duplicate_capability('EMP-1','IPQC','SELF'))
        self.assertNotIn('support_department', self.filters[0])

    def test_document_validation_rejects_duplicates_but_allows_different_role(self):
        class Document(Row):
            def __getattr__(self, name):
                return self.get(name)
            def __setattr__(self, name, value):
                self[name] = value
            def is_new(self):
                return not self.name
        self.frappe.db.sql = lambda *a: None
        api = functions('hrms/hr/doctype/cross_department_support_capability/cross_department_support_capability.py',
            ['CrossDepartmentSupportCapability'], dict(Document=Document, frappe=self.frappe,
                cstr=lambda value:str(value or ''), _=lambda s:s,
                _find_duplicate_capability=self.api._find_duplicate_capability,
                CAPABILITY_REQUIRED_FIELD_LABELS={'employee':'员工','support_department':'部门','support_designation':'岗位'}))
        doc = api.CrossDepartmentSupportCapability(employee='EMP-1', support_department='Dept',
            support_designation=' IPQC ', qualification_status='有效', is_active=1)
        with self.assertRaises(ValueError): doc.validate()
        doc.support_designation = 'QE'
        doc.validate()
        doc.support_designation = 'IPQC'
        doc.name = 'SELF'
        doc.validate()

    def test_delete_enforces_document_permission(self):
        doc = Row(name='CAP-1', denied=['delete'])
        deleted = []
        self.frappe.get_doc = lambda *a:doc
        self.frappe.delete_doc = lambda *a:deleted.append(a)
        with self.assertRaises(PermissionError): self.api.delete_support_capability('CAP-1')
        self.assertEqual(deleted, [])
        doc['denied'] = []
        self.api.delete_support_capability('CAP-1')
        self.assertEqual(deleted, [('Cross Department Support Capability','CAP-1')])


if __name__ == '__main__':
    unittest.main()
