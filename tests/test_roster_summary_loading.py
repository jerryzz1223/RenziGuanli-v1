"""Exercise the actual summary function without requiring a live database."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'hrms/api/employee_field_template.py'


class RosterSummaryLoadingTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse(SOURCE.read_text())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'get_employee_roster_summary')
        function.decorator_list = []
        cards = next(node.value for node in tree.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'EMPLOYEE_ROSTER_STATUS_CARDS' for target in node.targets))
        self.calls = []
        def get_list(doctype, **kwargs):
            self.calls.append((doctype, kwargs))
            return [
                {'custom_work_nature': '在职·正式', 'count': 198},
                {'custom_work_nature': '在职·试用期', 'count': 2},
                {'custom_work_nature': '离职', 'count': 16},
                {'custom_work_nature': '', 'count': 1},
            ]
        namespace = {
            'EMPLOYEE_DOCTYPE': 'Employee',
            'EMPLOYEE_ROSTER_STATUS_CARDS': ast.literal_eval(cards),
            '_build_employee_roster_filters': lambda filters: dict(filters),
            'frappe': SimpleNamespace(get_list=get_list, utils=SimpleNamespace(cint=lambda value: int(value or 0))),
        }
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), 'exec'), namespace)
        self.summary = namespace['get_employee_roster_summary']

    def test_one_permission_aware_grouped_query_preserves_scope(self):
        result = self.summary({'company': 'A', 'department': 'QA', 'custom_work_nature': '离职'}, include_all=1)
        self.assertEqual(len(self.calls), 1)
        doctype, kwargs = self.calls[0]
        self.assertEqual(doctype, 'Employee')
        self.assertEqual(kwargs['filters'], {'company': 'A', 'department': 'QA'})
        self.assertNotIn('ignore_permissions', kwargs)
        self.assertEqual(kwargs['group_by'], 'custom_work_nature')
        self.assertEqual(kwargs['limit_page_length'], 0)
        self.assertEqual([card['count'] for card in result], [201, 198, 2, 0, 0, 16])

    def test_existing_callers_keep_five_cards(self):
        self.assertEqual(len(self.summary({'company': 'B'})), 5)
        self.assertEqual(self.calls[0][1]['filters']['company'], 'B')


if __name__ == '__main__':
    unittest.main()
