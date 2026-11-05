"""Regression cases from the full-attendance policy supplied on 2026-10-30."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from tests.test_attendance_leave_policy import calculate_full_attendance, _full_attendance_bonus, _legacy_monthly_values
from tests.test_attendance_first_signed_version import load_processing_api


class FullAttendancePolicyTests(unittest.TestCase):
    def test_actual_leave_boundaries_even_when_paid_attendance_is_full(self):
        for hours, award in ((0, 200), (0.1, 150), (0.5, 150), (0.51, 150),
                             (16, 150), (16.01, 100), (32, 100),
                             (32.01, 50), (48, 50), (48.01, 0), (56, 0)):
            with self.subTest(hours=hours):
                result = calculate_full_attendance(dict(
                    standard_hours=160, actual_attendance_hours=160,
                    personal_leave_hours=hours))
                self.assertEqual(result['award'], award)

    def test_lateness_is_separate_from_leave_tiers(self):
        for leave, late, expected in ((0, 1, 190), (0, 2, 180), (0.5, 1, 140),
                                      (16, 1, 140), (32, 1, 90), (48, 1, 40),
                                      (49, 1, 0), (0, 25, 0)):
            with self.subTest(leave=leave, late=late):
                self.assertEqual(calculate_full_attendance(dict(
                    personal_leave_hours=leave, late_count=late))['award'], expected)

    def test_leave_exemptions_and_actual_paid_leave_hours(self):
        for key in ('annual_leave_hours', 'rest_arrangement_hours', 'rest_leave_hours', 'reunion_leave_hours'):
            with self.subTest(key=key):
                self.assertEqual(calculate_full_attendance({key: 56})['award'], 200)
        for key in ('sick_leave_hours', 'work_injury_hours', 'work_injury_leave_hours',
                    'bereavement_leave_hours', 'marriage_leave_hours',
                    'public_leave_hours', 'maternity_leave_hours'):
            with self.subTest(key=key):
                self.assertEqual(calculate_full_attendance({key: 32})['award'], 100)
                self.assertEqual(calculate_full_attendance({key: 49})['award'], 0)

    def test_mixed_leaves_are_combined_and_overtime_does_not_restore_bonus(self):
        self.assertEqual(calculate_full_attendance(dict(personal_leave_hours=16,
            sick_leave_hours=16, annual_leave_hours=40, rest_arrangement_hours=40,
            workday_overtime_hours=80, restday_overtime_hours=80))['award'], 100)

    def test_synthetic_late_leave_does_not_double_deduct(self):
        result = calculate_full_attendance(dict(personal_leave_hours=16.5,
            leave_hours=16.5, late_personal_leave_hours=0.5, late_count=1))
        self.assertEqual(result['absence_basis'], 16)
        self.assertEqual(result['award'], 140)

    def test_unexplained_absence_remains_deductible_but_lateness_is_not_leave(self):
        self.assertEqual(calculate_full_attendance(dict(standard_hours=160,
            actual_attendance_hours=104))['award'], 0)
        self.assertEqual(calculate_full_attendance(dict(standard_hours=160,
            actual_attendance_hours=159.5, late_count=1))['award'], 190)
        self.assertEqual(calculate_full_attendance(dict(standard_hours=160,
            actual_attendance_hours=143.5, personal_leave_hours=16, late_count=1))['award'], 140)

    def test_payroll_does_not_repeat_leave_and_late_deductions(self):
        from tests import test_termination_payroll_integration as payroll_fixture
        for version, locked_award, deduction, expected_bonus, expected_deduction in (
                ('处理终稿:v2', 140, 10, 140, 0), ('lock-v1', None, 60, 150, 10)):
            with self.subTest(version=version):
                fixture = payroll_fixture.TerminationPayrollIntegrationTest()
                fixture.setUp()
                fixture.rows[:] = [fixture.rows[1]]
                fixture.rows[0].update(standard_hours=160, actual_attendance_hours=144,
                                       personal_leave_hours=16, full_attendance_deduction=deduction)
                fixture.ns['_full_attendance_bonus'] = _full_attendance_bonus()
                fixture.ns['_payroll_calculation_rules'] = lambda *args: {'ATTENDANCE_FULL_ATTENDANCE_BONUS': {}}
                amounts = {'normal': {'全勤奖': locked_award}} if locked_award is not None else {}
                fixture.ns['_variable_totals'] = lambda *args: (amounts, {}, {})
                fixture.ns['generate_payroll_input_records']('ACME', '2026-07', version)
                self.assertEqual(fixture.saved[0].full_attendance_bonus, expected_bonus)
                self.assertEqual(fixture.saved[0].attendance_full_deduction, expected_deduction)
                self.assertEqual(expected_bonus - expected_deduction, 140)

    def test_payroll_uses_same_leave_tiers_for_dict_and_document(self):
        calculate = _full_attendance_bonus()
        # An old persisted 0.5=190 threshold must not revive the incorrect rule.
        old_rule = {'parameters': {'thresholds': [[0, 200], [0.5, 190], [16, 150], [32, 100], [48, 50]]}}
        for data in (dict(personal_leave_hours=0.5), SimpleNamespace(personal_leave_hours=0.5)):
            self.assertEqual(calculate(data, old_rule), (150, 0.5))

    def test_legacy_monthly_deduction_includes_leave_and_lateness(self):
        values = dict.fromkeys(('standard_hours', 'actual_attendance_hours', 'sick_leave_hours',
            'annual_leave_hours', 'work_injury_leave_hours', 'reunion_leave_hours',
            'bereavement_leave_hours', 'marriage_leave_hours', 'personal_leave_hours',
            'rest_leave_hours', 'overtime_1_5_hours', 'overtime_2_hours', 'overtime_3_hours',
            'large_night_shift_count', 'small_night_shift_count', 'absent_hours', 'red_apples'), 0)
        values.update(standard_hours=160, actual_attendance_hours=144, personal_leave_hours=16, late_count=1)
        self.assertEqual(_legacy_monthly_values()(values)['full_attendance_deduction'], 60)

    def test_old_locked_final_requires_regeneration_before_payroll(self):
        api = load_processing_api()
        with patch.object(api, '_require_processing_manager'),              patch.object(api, '_require_company', side_effect=lambda x: x),              patch.object(api, '_require_month', side_effect=lambda x: x),              patch.object(api, '_latest_batch'),              patch.object(api, 'get_locked_final_outputs', return_value={
                 'locked_snapshot_version': 'old', 'layout_version': api.MONTHLY_FINAL_LAYOUT_VERSION - 1}):
            result = api.get_monthly_final_preview('TEST', '2026-10', 'finance')
        self.assertFalse(result['available'])
        self.assertTrue(result['stale'])

    def test_final_generation_uses_policy_and_keeps_audited_overrides(self):
        api = load_processing_api()
        batch = SimpleNamespace(company='TEST', attendance_month='2026-10')
        def record(code, **values):
            return dict(employee_code=code, eligible_for_downstream=True,
                processed_value=dict(employee_code=code, standard_hours=160,
                                     actual_attendance_hours=160, **values))
        records = [record('A', personal_leave_hours=49), record('B', late_count=1),
                   record('C', personal_leave_hours=32),
                   record('D', personal_leave_hours=49, signed_final_override=1, full_attendance_award=123),
                   record('E', personal_leave_hours=49, full_attendance_award=88)]
        records[-1]['review_history'] = [dict(field_name='__web_monthly_final__', new_value={'full_attendance_award': 88})]
        with patch.object(api, '_all_final_source_rows', return_value=records), \
             patch.object(api, '_attendance_row_has_report_dates', return_value=True), \
             patch.object(api, '_employee_directory', return_value=[]):
            result = {r['employee_code']: r['full_attendance_award'] for r in api._monthly_final_rows({'attendance_draft': batch})}
        self.assertEqual(result, {'A': 0, 'B': 190, 'C': 100, 'D': 123, 'E': 88})


if __name__ == '__main__':
    unittest.main()
