"""Run the production dashboard against SQL aggregates, without a Frappe site."""
import ast
from collections import defaultdict
from pathlib import Path
import re
import sqlite3
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

SOURCE = Path(__file__).resolve().parents[1] / 'hrms/api/payroll_input.py'
FIELDS = ('base_salary', 'function_allowance', 'certificate_skill_allowance',
          'overtime_pay_total', 'bonus_total', 'gross_pay', 'net_pay',
          'company_cost_total', 'social_security_company', 'housing_fund_company')


class DashboardTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.execute('CREATE TABLE settlement (name TEXT, company TEXT, payroll_month TEXT, '
                        'attendance_lock_version TEXT, department TEXT, calculation_status TEXT, '
                        + ', '.join(f'{f} REAL' for f in FIELDS) + ')')
        self.queries = []
        def get_all(doctype, **kw):
            self.assertEqual(doctype, 'settlement')
            self.queries.append(kw)
            filters = kw['filters']
            query = ('SELECT ' + ', '.join(kw['fields']) + ' FROM settlement WHERE '
                     + ' AND '.join(f'{key} = ?' for key in filters)
                     + ' GROUP BY ' + kw['group_by'])
            return [dict(row) for row in self.db.execute(query, list(filters.values()))]
        self.lock = Mock(side_effect=lambda company, month: 'v2')
        ns = dict(re=re, frappe=SimpleNamespace(get_all=get_all), defaultdict=defaultdict,
                  flt=lambda v: float(v or 0), _require_company=lambda c: c,
                  _payroll_dashboard_lock_version=self.lock, PAYROLL_SETTLEMENT_DOCTYPE='settlement')
        tree = ast.parse(SOURCE.read_text())
        funcs = [n for n in tree.body if isinstance(n, ast.FunctionDef)
                 and n.name in {'get_payroll_home_dashboard', '_previous_payroll_month'}]
        for n in funcs:
            n.decorator_list = []
        exec(compile(ast.Module(body=funcs, type_ignores=[]), str(SOURCE), 'exec'), ns)
        self.dashboard = ns['get_payroll_home_dashboard']

    def insert(self, name, month='2026-08', company='ACME', lock='v2', department='A',
               status='已确认', amount=100):
        values = [name, company, month, lock, department, status] + [amount for _ in FIELDS]
        self.db.execute('INSERT INTO settlement VALUES (' + ','.join('?' for _ in values) + ')', values)

    def test_sql_totals_match_individual_records_and_isolate_scope(self):
        for i in range(1200):
            self.insert(str(i), department=str(i % 7), status='已确认' if i % 2 else '已试算', amount=10.25)
        self.insert('previous', month='2026-07', amount=100)
        self.insert('other-company', company='OTHER', amount=999999)
        self.insert('old-lock', lock='v1', amount=999999)
        data = self.dashboard('ACME', '2026-08')
        total = 1200 * 10.25
        self.assertEqual(data['summary']['headcount'], 1200)
        self.assertEqual(data['summary']['confirmed_count'], 600)
        self.assertEqual(data['summary']['confirmation_rate'], 50)
        for field in FIELDS:
            self.assertEqual(data['summary'][field], total)
        self.assertEqual(data['summary']['average_net_pay'], 10.25)
        self.assertEqual(sum(d['headcount'] for d in data['departments']), 1200)
        self.assertEqual(data['departments'][-1]['department'], '其他部门')
        self.assertEqual(data['previous_summary']['net_pay'], 100)
        self.assertEqual(data['metrics']['net_pay']['change_percent'], 12200)
        self.assertEqual(data['attendance_lock_version'], 'v2')
        self.assertEqual(len(self.queries), 2)
        self.assertTrue(all(q['limit_page_length'] == 0 for q in self.queries))
        self.assertLess(len(self.db.execute('SELECT department, calculation_status FROM settlement '
                                           "WHERE company='ACME' GROUP BY department, calculation_status").fetchall()), 20)

    def test_no_current_lock_never_sums_historical_runs(self):
        self.insert('old', lock='v1')
        self.lock.return_value = ''
        self.lock.side_effect = None
        data = self.dashboard('ACME', '2026-08')
        self.assertEqual(data['summary']['headcount'], 0)
        self.assertFalse(data['metrics']['net_pay']['comparison_available'])
        self.assertEqual(self.queries, [])

    def test_explicit_lock_and_missing_previous_month(self):
        self.insert('old', lock='v1', department=None, amount=12.34)
        data = self.dashboard('ACME', '2026-08', 'v1')
        self.assertEqual(data['summary']['net_pay'], 12.34)
        self.assertEqual(data['departments'][0]['department'], '未维护部门')
        self.assertFalse(data['metrics']['net_pay']['comparison_available'])
        self.lock.assert_called_once_with('ACME', '2026-07')

    def test_zero_previous_pay_does_not_divide_by_zero(self):
        self.insert('current')
        self.insert('prev', month='2026-07', amount=0)
        metric = self.dashboard('ACME', '2026-08')['metrics']['net_pay']
        self.assertTrue(metric['comparison_available'])
        self.assertEqual(metric['change_percent'], 0)


class DashboardLockTests(unittest.TestCase):
    def test_metadata_only_resolution_and_legacy_fallback(self):
        tree = ast.parse(SOURCE.read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                        and n.name == '_payroll_dashboard_lock_version')
        metadata = Mock(return_value={'locked_snapshot_version': 'snapshot-2'})
        api = SimpleNamespace(attendance_processing_center=SimpleNamespace(get_locked_final_outputs=metadata))
        db = SimpleNamespace(get_value=Mock(return_value='legacy-1'))
        ns = dict(frappe=SimpleNamespace(db=db), PROCESSING_ATTENDANCE_LOCK_PREFIX='final:')
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), 'exec'), ns)
        with patch.dict(sys.modules, {'hrms.api': api}):
            resolve = ns['_payroll_dashboard_lock_version']
            self.assertEqual(resolve('ACME', '2026-08'), 'final:snapshot-2')
            db.get_value.assert_not_called()
            metadata.return_value = {}
            self.assertEqual(resolve('ACME', '2026-08'), 'legacy-1')
            metadata.side_effect = PermissionError('no attendance permission')
            self.assertEqual(resolve('ACME', '2026-08'), 'legacy-1')
            db.get_value.assert_called_with('HRMS Attendance Month Lock',
                {'company': 'ACME', 'attendance_month': '2026-08', 'status': '已锁定'}, 'active_version')
            metadata.reset_mock()
            self.assertEqual(resolve('ACME', ''), '')
            metadata.assert_not_called()


if __name__ == '__main__':
    unittest.main()
