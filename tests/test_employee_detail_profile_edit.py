"""Verify profile-write boundaries without requiring a running Frappe site."""
import ast
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

class Field(dict):
    def __getattr__(self, name):
        return self.get(name)

class ProfileEditTests(unittest.TestCase):
    def setUp(self):
        def reject(message, exception=ValueError):
            raise exception(message)
        self.fields = {name: Field(fieldtype=kind) for name, kind in (
            ('cell_number', 'Data'), ('custom_work_nature', 'Select'),
            ('custom_employee_code', 'Data'), ('custom_is_confirmed', 'Select'),
            ('status', 'Select'), ('private_note', 'Data'))}
        self.fields['computed'] = Field(fieldtype='Data', read_only=1)
        self.fields['restricted'] = Field(fieldtype='Data', permlevel=1)
        self.changed = {}
        self.saved = []
        self.permissions = []
        self.doc = SimpleNamespace(modified='2026-11-02 12:00:00',
            check_permission=self.permissions.append, set=self.changed.__setitem__,
            save=lambda: self.saved.append(True))
        self.allowed = True
        self.frappe = SimpleNamespace(throw=reject, PermissionError=PermissionError,
            get_doc=lambda *args: self.doc, whitelist=lambda: lambda fn: fn)
        tree = ast.parse((ROOT / 'hrms/api/employee_field_template.py').read_text())
        names = {'EMPLOYEE_PROFILE_PROCESS_FIELDS', 'EMPLOYEE_PROFILE_FIXED_FIELDS', 'EMPLOYEE_PROFILE_EDIT_TYPES'}
        nodes = []
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in node.targets):
                nodes.append(node)
            elif isinstance(node, ast.FunctionDef) and node.name in {'_employee_profile_field_editable', 'save_employee_detail_profile'}:
                nodes.append(node)
        self.ns = dict(frappe=self.frappe, _=lambda s: s, EMPLOYEE_DOCTYPE='Employee',
            _parse_json=lambda s, default: json.loads(s),
            _can_edit_employee_detail=lambda: self.allowed,
            _save_profile_records=lambda doc, records: None,
            _get_employee_meta_field_map=lambda: self.fields,
            _get_employee_detail_sections=lambda doc: [{'fields': [{'fieldname': name} for name in self.fields if name != 'private_note']}],
            get_employee_detail=lambda employee: {'header': {'name': employee}, 'modified': 'new'})
        exec(compile(ast.Module(body=nodes, type_ignores=[]), '<profile>', 'exec'), self.ns)

    def save(self, values, modified='2026-11-02 12:00:00'):
        return self.ns['save_employee_detail_profile']('E1', json.dumps(values), modified)

    def test_regular_data_save_checks_permissions_and_returns_fresh_detail(self):
        result = self.save({'cell_number': '123'})
        self.assertEqual(self.permissions, ['write'])
        self.assertEqual(self.changed, {'cell_number': '123'})
        self.assertEqual(self.saved, [True])
        self.assertEqual(result['modified'], 'new')

    def test_process_fixed_readonly_hidden_and_restricted_fields_rejected_atomically(self):
        for name in set(self.fields) - {'cell_number'} | {'unknown'}:
            with self.subTest(name=name), self.assertRaises(PermissionError):
                self.save({'cell_number': '123', name: 'changed'})
            self.assertEqual(self.changed, {})
            self.assertEqual(self.saved, [])

    def test_stale_or_missing_timestamp_never_overwrites_newer_data(self):
        for timestamp in ('old', ''):
            with self.assertRaisesRegex(ValueError, '刷新'):
                self.save({'cell_number': '123'}, timestamp)
        self.assertEqual(self.saved, [])

    def test_non_admin_and_malformed_payload_rejected(self):
        self.allowed = False
        with self.assertRaises(PermissionError): self.save({'cell_number': '123'})
        self.allowed = True
        with self.assertRaises(ValueError): self.save(['cell_number'])
        self.assertEqual(self.saved, [])

class WorkNatureGuardTests(unittest.TestCase):
    def setUp(self):
        def reject(message, exception=ValueError): raise exception(message)
        frappe = SimpleNamespace(throw=reject, PermissionError=PermissionError, _=lambda s: s)
        self.patch = patch.dict(sys.modules, {'frappe': frappe})
        self.patch.start()
        self.addCleanup(self.patch.stop)
        spec = importlib.util.spec_from_file_location('profile_status_test', ROOT / 'hrms/utils/employee_status_updates.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.old = {'custom_work_nature': '在职·试用期', 'employment_type': 'Full-time', 'status': 'Active', 'custom_is_confirmed': '否'}
        self.values = dict(self.old)
        self.doc = SimpleNamespace(is_new=lambda: False, flags=SimpleNamespace(), get=self.values.get,
            get_doc_before_save=lambda: SimpleNamespace(get=self.old.get))
        self.doc.save = lambda: self.module.validate_employee_work_nature_change(self.doc)

    def test_each_direct_source_or_derived_status_change_is_rejected(self):
        for field in self.old:
            self.values.update(self.old)
            self.values[field] = 'changed'
            with self.subTest(field=field), self.assertRaises(PermissionError): self.doc.save()

    def test_normal_profile_edits_and_new_employee_are_allowed(self):
        self.values['cell_number'] = '123'
        self.doc.save()
        self.doc.is_new = lambda: True
        self.values['custom_work_nature'] = '在职·正式'
        self.doc.save()

    def test_workflows_allow_changes_and_context_cannot_leak(self):
        self.values['custom_work_nature'] = '在职·正式'
        for source in ('confirmation', 'transfer', 'separation', 'roster_import'):
            self.module.save_employee_status_update(self.doc, source)
            with self.assertRaises(PermissionError): self.doc.save()
        with self.assertRaises(RuntimeError):
            with self.module.employee_status_update(self.doc, 'transfer'):
                self.doc.save()
                raise RuntimeError('failed')
        self.assertIsNone(self.module._status_write.get())
        with self.assertRaises(PermissionError): self.doc.save()

    def test_real_promotion_and_transfer_handlers_preserve_scoped_workflow_writes(self):
        # Execute the actual handlers, including a nested history save during cancellation.
        for doctype, class_name in [('employee_promotion', 'EmployeePromotion'), ('employee_transfer', 'EmployeeTransfer')]:
            tree = ast.parse((ROOT / f'hrms/hr/doctype/{doctype}/{doctype}.py').read_text())
            cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == class_name)
            methods = [node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name in {'on_submit', 'on_cancel'}]
            test_cls = ast.ClassDef(name='Handler', bases=[], keywords=[], body=methods, decorator_list=[])
            ast.fix_missing_locations(test_cls)
            employee = self.doc
            employee.meta = SimpleNamespace(has_field=lambda field: False)
            def history(employee, details, **kwargs):
                self.values['custom_is_confirmed'] = '是'
                employee.save()
                return employee
            namespace = dict(frappe=SimpleNamespace(get_doc=lambda *args: employee),
                employee_status_update=self.module.employee_status_update,
                update_employee_work_history=history,
                CONFIRMATION_REJECTED='rejected', CONFIRMATION_PASSED='passed')
            exec(compile(ast.Module(body=[test_cls], type_ignores=[]), '<handlers>', 'exec'), namespace)
            handler = namespace['Handler']()
            handler.employee = 'E1'
            handler.custom_confirmation_result = 'passed'
            handler.promotion_details = []
            handler.promotion_date = handler.transfer_date = '2026-11-02'
            handler.revised_ctc = 0
            handler.apply_work_nature_changes = lambda employee, **kwargs: self.values.update(custom_work_nature='在职·正式')
            handler.work_history_details = lambda: []
            handler.on_submit()
            handler.on_cancel()
            self.assertIsNone(self.module._status_write.get())
            with self.assertRaises(PermissionError): employee.save()

    def test_trust_is_bound_to_the_employee_object(self):
        other = SimpleNamespace()
        self.values['status'] = 'Left'
        with self.module.employee_status_update(other, 'separation'):
            with self.assertRaises(PermissionError): self.doc.save()


class ProfileRecordTests(unittest.TestCase):
    def setUp(self):
        def reject(message, exception=ValueError): raise exception(message)
        self.saved = []
        self.changed = {}
        self.stored = SimpleNamespace(records_json='{"家庭成员": [{"value_0": "existing"}]}', save=lambda: self.saved.append(True))
        self.doc = SimpleNamespace(name='E1', set=self.changed.__setitem__, get=lambda field: [])
        self.blocks = {'联系信息': [{'label': '家庭成员', 'record_editor': {'fields': [{'fieldname': 'value_0', 'label': '姓名', 'reqd': 1}], 'rows': [{'value_0': 'existing'}]}}]}
        tree = ast.parse((ROOT / 'hrms/api/employee_field_template.py').read_text())
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_save_profile_records')
        self.ns = dict(frappe=SimpleNamespace(throw=reject, PermissionError=PermissionError, db=SimpleNamespace(exists=lambda *args: True)),
            _=lambda s: s, json=json, EMPLOYEE_PROFILE_SUPPLEMENT='Employee Profile Supplement',
            _get_employee_related_records=lambda doc: self.blocks,
            _profile_supplement=lambda doc: self.stored, _parse_json=lambda s, default: json.loads(s))
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<records>', 'exec'), self.ns)

    def save(self, records): self.ns['_save_profile_records'](self.doc, records)

    def test_add_edit_and_delete_records_persist(self):
        self.save({'家庭成员': [{'value_0': 'updated'}, {'value_0': 'new'}]})
        self.assertEqual(json.loads(self.stored.records_json)['家庭成员'], [{'value_0': 'updated'}, {'value_0': 'new'}])
        self.save({'家庭成员': []})
        self.assertEqual(json.loads(self.stored.records_json)['家庭成员'], [])
        self.assertEqual(len(self.saved), 2)

    def test_foreign_fields_rows_workflow_blocks_and_required_values_rejected(self):
        for payload in ({'任职记录': []}, {'家庭成员': [{'status': 'Active'}]}, {'家庭成员': [{'name': 'foreign', 'value_0': 'x'}]}, {'家庭成员': [{}]}, {'家庭成员': [{'value_0': {}}]}, {'家庭成员': 'bad'}):
            with self.subTest(payload=payload), self.assertRaises((ValueError, PermissionError)):
                self.save(payload)
            self.assertEqual(self.saved, [])

    def test_child_updates_keep_unexposed_fields(self):
        row = Field(name='row1', qualification='old', protected='keep')
        original = SimpleNamespace(name='row1', as_dict=lambda: dict(row))
        self.doc.get = lambda field: [original]
        self.blocks = {'个人信息': [{'label': '教育经历', 'record_editor': {'child': 'education', 'fields': [{'fieldname': 'qualification'}], 'rows': [{'name': 'row1', 'qualification': 'old'}]}}]}
        self.save({'教育经历': [{'name': 'row1', 'qualification': 'new'}]})
        self.assertEqual(self.changed['education'][0]['protected'], 'keep')
        self.assertEqual(self.changed['education'][0]['qualification'], 'new')
        self.assertEqual(self.saved, [])

if __name__ == '__main__': unittest.main()
