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
        helpers = [
            next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name)
            for name in ('_get_probation_age_days', '_is_mature_probation_employee', '_get_probation_card_label')
        ]
        function.decorator_list = []
        cards = next(node.value for node in tree.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'EMPLOYEE_ROSTER_STATUS_CARDS' for target in node.targets))
        self.calls = []
        def get_list(doctype, **kwargs):
            self.calls.append((doctype, kwargs))
            return [
                *({'custom_work_nature': '在职·正式', 'date_of_joining': '2020-01-01'} for _ in range(197)),
                {'custom_work_nature': '在职·试用期', 'date_of_joining': '2026-09-15', 'final_confirmation_date': ''},
                {'custom_work_nature': '在职·试用期', 'date_of_joining': '2026-09-08', 'final_confirmation_date': '2026-09-20'},
                {'custom_work_nature': '在职·试用期', 'date_of_joining': '2026-09-01', 'final_confirmation_date': '2026-09-20'},
                {'custom_work_nature': '在职·试用期', 'date_of_joining': '2026-09-01', 'final_confirmation_date': '2026-09-15'},
                *({'custom_work_nature': '离职', 'date_of_joining': '2020-01-01'} for _ in range(16)),
                {'custom_work_nature': '', 'date_of_joining': '2020-01-01'},
            ]
        namespace = {
            'EMPLOYEE_DOCTYPE': 'Employee',
            'EMPLOYEE_ROSTER_STATUS_CARDS': ast.literal_eval(cards),
            '_build_employee_roster_filters': lambda filters: dict(filters),
            # The source function now enforces the normal personnel-view gate.
            # This isolated fixture exercises the authorised aggregation path.
            'has_hrms_capability': lambda capability: capability == 'personnel_view',
            'frappe': SimpleNamespace(
                get_list=get_list,
                utils=SimpleNamespace(
                    cint=lambda value: int(value or 0),
                    getdate=lambda value: __import__('datetime').date.fromisoformat(str(value)),
                    nowdate=lambda: '2026-09-15',
                ),
            ),
        }
        exec(compile(ast.Module(body=[*helpers, function], type_ignores=[]), str(SOURCE), 'exec'), namespace)
        self.summary = namespace['get_employee_roster_summary']

    def test_one_permission_aware_grouped_query_preserves_scope(self):
        result = self.summary({'company': 'A', 'department': 'QA', 'custom_work_nature': '离职'}, include_all=1)
        self.assertEqual(len(self.calls), 1)
        doctype, kwargs = self.calls[0]
        self.assertEqual(doctype, 'Employee')
        self.assertEqual(kwargs['filters'], {'company': 'A', 'department': 'QA'})
        self.assertNotIn('ignore_permissions', kwargs)
        self.assertEqual(kwargs['limit_page_length'], 0)
        self.assertEqual(kwargs['fields'], ['custom_work_nature', 'date_of_joining', 'final_confirmation_date'])
        self.assertEqual([card['count'] for card in result], [202, 197, 1, 1, 1, 0, 0, 16])

    def test_existing_callers_keep_five_cards(self):
        self.assertEqual(len(self.summary({'company': 'B'})), 7)
        self.assertEqual(self.calls[0][1]['filters']['company'], 'B')


if __name__ == '__main__':
    unittest.main()
