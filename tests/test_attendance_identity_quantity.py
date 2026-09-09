"""Regressions for event-date identity and unit/total approval validation."""
import importlib.util
import sys
import unittest
from pathlib import Path


def load(name):
    spec = importlib.util.spec_from_file_location('attendance_regression_' + name, Path(__file__).parents[1] / 'hrms/api/attendance_processors' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


apple, punch = load('apple_tree'), load('missed_punch')


def employees():
    return [
        dict(employee_code='old', employee_name='张三', department='品管课', employment_status='Left', date_of_joining='2020-01-01', relieving_date='2026-02-05'),
        dict(employee_code='new', employee_name='张三', department='品管课', employment_status='Active', date_of_joining='2026-03-10', relieving_date=''),
    ]


def apple_row(**changes):
    row = {'数据id': 'id', '审批编号': 'approval', '奖/惩日期': '2026-08-03', '创建时间': '2026-09-02 08:00', '受奖/惩人': '张三', '受奖/惩人部门': '品管课', '奖/惩项目': '品管课/绿苹果/保养。2颗', '绿苹果': '2', '红苹果': '', '备注': '', '创建人': '主管', '审批结果': '审批通过', '审批状态': '已结束'}
    row.update(changes)
    return row


def punch_row(**changes):
    row = {'数据id': 'id', '审批编号': 'approval', '补卡时间': '2026-08-03 08:00', '创建时间': '2026-09-02 08:00', '创建人': '张三', '创建人部门': '品管课', '补卡类型': '忘刷卡补卡', '补卡理由': '忘记打卡', '审批结果': '审批通过', '审批状态': '已结束'}
    row.update(changes)
    return row


class IdentityTests(unittest.TestCase):
    def run_both(self, directory, event='2026-08-03', **changes):
        a = apple.normalize_apple_tree_rows([apple_row(**{'奖/惩日期': event, **changes})], employees=directory, rules=apple.AppleTreeRules(target_month=event[:7]), source_file='original.xlsx')[0]
        pchanges = {'工号': changes['工号']} if '工号' in changes else {}
        b = punch.process_missed_punch_rows([punch_row(**{'补卡时间': event + ' 08:00', **pchanges})], employee_directory=directory, attendance_month=event[:7], source_file='original.xlsx', source_sheet='补卡')['processed_rows'][0]
        return a, b

    def test_event_date_resolves_old_and_new_ids(self):
        for day, expected in [('2026-08-03', 'new'), ('2026-02-05', 'old'), ('2026-03-10', 'new')]:
            with self.subTest(day=day):
                a, b = self.run_both(employees(), day)
                self.assertEqual(a['工号'], expected)
                self.assertEqual(b['employee_code'], expected)
                self.assertTrue(a['include_in_downstream'])
                self.assertTrue(b['eligible_for_downstream'])

    def test_real_overlap_stays_ambiguous(self):
        directory = employees(); directory[0]['relieving_date'] = '2026-09-01'
        a, b = self.run_both(directory)
        self.assertIn('EMPLOYEE_NAME_AMBIGUOUS', a['exception_codes'])
        self.assertIn('EMPLOYEE_AMBIGUOUS', b['exception_codes'])
        self.assertFalse(a['include_in_downstream']); self.assertFalse(b['eligible_for_downstream'])

    def test_unknown_dates_do_not_eliminate_other_candidate(self):
        for value in ['', '无记录']:
            directory = employees(); directory[0]['relieving_date'] = value
            a, b = self.run_both(directory)
            self.assertIn('EMPLOYEE_NAME_AMBIGUOUS', a['exception_codes'])
            self.assertIn('EMPLOYEE_AMBIGUOUS', b['exception_codes'])

    def test_gap_does_not_choose_current_employee(self):
        a, b = self.run_both(employees(), '2026-02-20')
        self.assertFalse(a['include_in_downstream']); self.assertFalse(b['eligible_for_downstream'])

    def test_explicit_code_is_not_remapped(self):
        a, b = self.run_both(employees(), 工号='old')
        self.assertEqual(a['工号'], 'old'); self.assertEqual(b['employee_code'], 'old')
        self.assertIn('FORMER_EMPLOYEE_REQUIRES_CONFIRMATION', a['exception_codes'])
        self.assertIn('FORMER_EMPLOYEE_REQUIRES_CONFIRMATION', b['exception_codes'])

    def test_active_employee_before_joining_is_blocked(self):
        a, b = self.run_both([employees()[1]], '2026-02-20')
        self.assertIn('FORMER_EMPLOYEE_REQUIRES_CONFIRMATION', a['exception_codes'])
        self.assertIn('FORMER_EMPLOYEE_REQUIRES_CONFIRMATION', b['exception_codes'])

    def test_invalid_leaving_date_is_not_historical_proof(self):
        directory = [employees()[0]]; directory[0]['relieving_date'] = '无记录'
        a, b = self.run_both(directory)
        self.assertFalse(a['include_in_downstream']); self.assertFalse(b['eligible_for_downstream'])

    def test_department_mapping_preserves_source_and_does_not_approve_pending(self):
        raw = punch_row(**{'创建人部门': 'IPQC2', '审批状态': '审批中'})
        result = punch.process_missed_punch_rows([raw], employee_directory=employees(), department_mapping={'IPQC2': '品管课'}, attendance_month='2026-08', source_file='original.xlsx', source_sheet='补卡')['processed_rows'][0]
        self.assertEqual(result['employee_code'], 'new')
        self.assertEqual(result['source_department'], 'IPQC2')
        self.assertEqual(result['department'], '品管课')
        self.assertNotIn('DEPARTMENT_CONFLICT', result['exception_codes'])
        self.assertIn('APPROVAL_NOT_ENDED', result['exception_codes'])
        self.assertFalse(result['eligible_for_downstream'])

    def test_unknown_department_stays_in_review(self):
        result = punch.process_missed_punch_rows([punch_row(**{'创建人部门': '不明组'})], employee_directory=employees(), attendance_month='2026-08', source_file='original.xlsx', source_sheet='补卡')['processed_rows'][0]
        self.assertIn('DEPARTMENT_CONFLICT', result['exception_codes'])


class QuantityTests(unittest.TestCase):
    daily = '人资组/绿苹果/带教期间每天奖励绿苹果2颗，按实际带教天数计算。带教合计不超过15天。2颗'
    hourly = '药水课/绿苹果/延班按照0.5H计算，每0.5H奖1颗，以此类推'

    def record(self, project, remark, amount, **changes):
        return apple.normalize_apple_tree_rows([apple_row(**{'奖/惩项目': project, '备注': remark, '绿苹果': str(amount), **changes})], employees=employees(), rules=apple.AppleTreeRules(target_month='2026-08'), source_file='original.xlsx')[0]

    def test_daily_total_and_audit_evidence(self):
        for days, amount in [(5, 10), (10, 20)]:
            row = self.record(self.daily, f'带新员工李四{days}天', amount)
            self.assertTrue(row['include_in_downstream'])
            self.assertEqual(row['有效苹果数'], amount)
            self.assertEqual(row['processed_value']['数量校验']['expected_amount'], amount)
            self.assertEqual(row['original_data']['绿苹果'], str(amount))

    def test_wrong_daily_total_remains_blocked(self):
        row = self.record(self.daily, '带新员工李四5天', 2)
        self.assertIn('AMOUNT_TEXT_CONFLICT', row['exception_codes'])
        self.assertEqual(row['有效苹果数'], 2)
        self.assertFalse(row['include_in_downstream'])

    def test_explicit_hours_support_numeric_and_chinese(self):
        for remark in ['延班两个小时测废水', '延班2小时测废水']:
            self.assertTrue(self.record(self.hourly, remark, 4)['include_in_downstream'])

    def test_missing_quantity_is_not_false_fixed_amount_conflict(self):
        row = self.record(self.hourly, '开缸分析', 4)
        self.assertIn('AMOUNT_CALCULATION_REQUIRED', row['exception_codes'])
        self.assertNotIn('AMOUNT_TEXT_CONFLICT', row['exception_codes'])
        self.assertFalse(row['include_in_downstream'])

    def test_proration_and_rounding_are_not_invented(self):
        row = self.record('品管课/绿苹果/看三条线12小时。3颗', '一人看3线（6H）', 2)
        self.assertIn('AMOUNT_CALCULATION_REQUIRED', row['exception_codes'])
        self.assertEqual(row['有效苹果数'], 2)

    def test_mixed_duration_and_days_over_cap_require_confirmation(self):
        for remark in ['带教5天另带教3天', '带新员工李四16天']:
            self.assertIn('AMOUNT_CALCULATION_REQUIRED', self.record(self.daily, remark, 32)['exception_codes'])
        self.assertIn('AMOUNT_CALCULATION_REQUIRED', self.record(self.daily, '带教16天', 2)['exception_codes'])

    def test_fixed_award_still_checks_amount(self):
        row = self.record('品管课/绿苹果/保养。2颗', '完成保养', 5)
        self.assertIn('AMOUNT_TEXT_CONFLICT', row['exception_codes'])

    def test_quantity_and_identity_fixes_never_approve_pending(self):
        row = self.record(self.daily, '带教5天', 10, 审批结果='--', 审批状态='审批中')
        self.assertEqual(row['工号'], 'new')
        self.assertNotIn('AMOUNT_TEXT_CONFLICT', row['exception_codes'])
        self.assertIn('APPROVAL_NOT_PASSED', row['exception_codes'])
        self.assertFalse(row['include_in_downstream'])


if __name__ == '__main__':
    unittest.main()
