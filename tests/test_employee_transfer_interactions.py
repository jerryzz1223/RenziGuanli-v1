"""Exercise transfer validation without writing employee records or requiring a site."""
import ast
from datetime import date
from pathlib import Path
from types import SimpleNamespace
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'hrms/hr/doctype/employee_transfer/employee_transfer.py'

class Record(SimpleNamespace):
    def get(self, key):
        return getattr(self, key, None)

class TransferInteractions(unittest.TestCase):
    def setUp(self):
        self.employee = Record(name='E1', company='C1', department='D1', designation='P1', grade='G1',
                               reports_to='M0', custom_is_confirmed='否', employment_type='Probation')
        self.fields = {
            name: Record(fieldtype='Link', options=doctype) for name, doctype in
            [('department', 'Department'), ('designation', 'Designation'), ('grade', 'Employee Grade'), ('reports_to', 'Employee')]
        }
        self.fields['custom_is_confirmed'] = Record(fieldtype='Select', options='是\n否')
        self.fields['employment_type'] = Record(fieldtype='Link', options='Employment Type')
        self.department_positions = {('P1', 'D2'), ('P2', 'D1')}
        self.manager = Record(status='Active', company='C1')
        self.permissions = []
        self.employee.check_permission = lambda permission: self.permissions.append(permission)
        def exists(doctype, value):
            if isinstance(value, dict):
                if doctype == 'Employee':
                    return (value.get('designation'), value.get('department')) in self.department_positions
                return False
            return value != 'missing'
        def get_value(doctype, name, field, **kwargs):
            return 'C1' if doctype == 'Department' else self.manager
        def throw(message, *args):
            raise ValueError(message)
        self.frappe = Record(get_doc=lambda *a: self.employee,
                             get_meta=lambda doctype: Record(get_field=self.fields.get, has_field=lambda _: False),
                             db=Record(exists=exists, get_value=get_value), throw=throw,
                             DocstatusTransitionError=ValueError)
        ns = dict(frappe=self.frappe, _=lambda text: text, Document=object, getdate=lambda value: date.fromisoformat(value), nowdate=lambda: "2026-10-30",
                  cstr=lambda value: '' if value is None else str(value),
                  _get_work_nature=lambda employee: '在职 · 试用期',
                  WORK_NATURE_OPTIONS=('在职 · 正式', '在职 · 试用期', '退休返聘', '待离职', '离职'))
        tree = ast.parse(SOURCE.read_text())
        nodes = []
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in {'TRANSFER_PROPERTY_FIELDS', 'TRANSFER_LINK_LABEL_FIELDS'} for target in node.targets):
                nodes.append(node)
            if isinstance(node, ast.ClassDef) and node.name == 'EmployeeTransfer':
                nodes.append(node)
            if isinstance(node, ast.FunctionDef) and node.name in {'_resolve_transfer_link_value', '_designation_belongs_to_department', 'get_transfer_field_property'}:
                node.decorator_list = []
                nodes.append(node)
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), ns)
        self.ns = ns
        self.doc = ns['EmployeeTransfer']()
        self.doc.employee = 'E1'
        self.doc.company = 'C1'
        self.doc.docstatus = 0
        self.doc.transfer_details = []

    def row(self, fieldname, new, current=None):
        return Record(fieldname=fieldname, property=fieldname, new=new, current=current)

    def validate(self, *rows):
        self.doc.transfer_details = list(rows)
        self.doc.validate_transfer_details()

    def test_department_change_allows_same_position_in_target_department(self):
        self.validate(self.row('department', 'D2'), self.row('designation', 'P1'))

    def test_same_position_without_department_change_is_rejected(self):
        with self.assertRaisesRegex(ValueError, '不能相同'):
            self.validate(self.row('designation', 'P1'))

    def test_wrong_department_position_is_rejected(self):
        with self.assertRaisesRegex(ValueError, '不属于目标部门'):
            self.validate(self.row('department', 'D2'), self.row('designation', 'P2'))

    def test_position_only_uses_current_department(self):
        self.validate(self.row('designation', 'P2'))

    def test_department_requires_position(self):
        with self.assertRaisesRegex(ValueError, '同时选择新岗位'):
            self.validate(self.row('department', 'D2'))

    def test_target_department_must_belong_to_company(self):
        self.frappe.db.get_value = lambda *args, **kwargs: 'C2'
        with self.assertRaisesRegex(ValueError, '不属于公司'):
            self.validate(self.row('department', 'D2'), self.row('designation', 'P1'))

    def test_manager_must_be_other_active_company_employee(self):
        for target, manager, error in [('E1', self.manager, '员工本人'), ('M1', Record(status='Left', company='C1'), '本公司在职'), ('M1', Record(status='Active', company='C2'), '本公司在职')]:
            with self.subTest(target=target, manager=manager):
                self.manager = manager
                with self.assertRaisesRegex(ValueError, error):
                    self.validate(self.row('reports_to', target))
        self.manager = Record(status='Active', company='C1')
        self.validate(self.row('reports_to', 'M1'))

    def test_select_values_and_work_nature_conflict(self):
        with self.assertRaisesRegex(ValueError, '有效的'):
            self.validate(self.row('custom_is_confirmed', 'random'))
        # Set an old state different from the proposed confirmation, so the conflict guard is reached.
        self.employee.custom_is_confirmed = '是'
        with self.assertRaisesRegex(ValueError, '不一致'):
            self.validate(self.row('employment_type', '在职 · 正式'), self.row('custom_is_confirmed', '否'))
        self.employee.custom_is_confirmed = '否'
        self.validate(self.row('employment_type', '在职 · 正式'), self.row('custom_is_confirmed', '是'))

    def test_submit_detects_changed_employee_snapshot(self):
        self.doc.docstatus = 1
        with self.assertRaisesRegex(ValueError, '重新核对'):
            self.validate(self.row('grade', 'G2', current='old-grade'))
        self.validate(self.row('grade', 'G2', current='G1'))

    def test_work_nature_endpoint_returns_business_value_and_checks_read(self):
        value = self.ns['get_transfer_field_property']('E1', 'employment_type')
        self.assertEqual(value['value'], '在职 · 试用期')
        self.assertEqual(self.permissions, ['read'])
        with self.assertRaisesRegex(ValueError, '不支持'):
            self.ns['get_transfer_field_property']('E1', 'salary')

    def test_future_date_can_be_saved_but_cannot_be_submitted(self):
        self.doc.transfer_date = '2026-10-31'
        self.validate(self.row('grade', 'G2'))
        with self.assertRaisesRegex(ValueError, '生效日期未到'):
            self.doc.before_submit()
        self.doc.transfer_date = '2026-10-30'
        self.doc.before_submit()
        self.doc.transfer_date = None
        with self.assertRaisesRegex(ValueError, '生效日期'):
            self.doc.before_submit()

    def test_duplicate_and_empty_values_are_rejected(self):
        with self.assertRaisesRegex(ValueError, '不能重复'):
            self.validate(self.row('grade', 'G2'), self.row('grade', 'G3'))
        with self.assertRaisesRegex(ValueError, '请填写'):
            self.validate(self.row('grade', ''))

if __name__ == '__main__':
    unittest.main()
