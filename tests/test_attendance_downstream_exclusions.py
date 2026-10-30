"""Settlement, first-signature and auditable exclusion contract."""
import copy
import io
import types
import unittest
from unittest.mock import patch
from openpyxl import load_workbook
from tests.test_attendance_first_signed_version import load_processing_api


class DownstreamExclusionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.api = load_processing_api()

    def record(self, codes=None, excluded=False):
        codes = codes or ['WORKDAY_OUTSIDE_SHIFT_UNAPPROVED']
        details = [dict(source_file='A.xlsx', source_sheet='每日统计', source_row=day,
                        attendance_date=f'2026-08-{day:02d}', standard_hours=8,
                        actual_attendance_hours=8, workday_overtime_hours=2,
                        deep_night_shifts=1) for day in (10, 11)]
        values = dict(employee_code='E1', employee_name='张三', standard_hours=16,
                      actual_attendance_hours=16, workday_overtime_hours=4,
                      deep_night_shifts=2, source_row_count=2, attendance_details=details,
                      exception_lines=[dict(details[0], exception_codes=codes)])
        row = dict(record_id='R1', source_type='attendance_draft', employee_code='E1', employee_name='张三',
                   attendance_month='2026-08', review_status='待审核', eligible_for_downstream=False,
                   exception_codes=codes, processed_value=values, review_history=[],
                   original_value={'rows': [dict(姓名='张三', 工号='E1', 日期=d['attendance_date'],
                       source_file=d['source_file'], source_sheet=d['source_sheet'], source_row=d['source_row'],
                       标准工时=8, **{'实际出勤（小时）': 8, '工作日加班（小时）': 2}) for d in details]})
        if excluded:
            key = self.api._daily_line_key(details[0])
            values['_excluded_attendance_daily_keys'] = [key]
            row.update(review_status='已通过', eligible_for_downstream=True,
                       reviewer='reviewer@example.com', reviewed_on='2026-10-30T12:00:00', review_note='核实当天不结算')
            row['review_history'] = [dict(field_name='__daily_exclusion__:' + key,
                reason='核实当天不结算', reviewer='reviewer@example.com', reviewed_on='2026-10-30T12:00:00')]
        return row

    def batch(self, kind='attendance_draft'):
        return types.SimpleNamespace(name=kind, source_type=kind, company='TEST', attendance_month='2026-08', source_checksum=kind)

    def quality(self, row):
        inputs = [dict(source_type='attendance_draft', label='考勤初稿', ready=True, status='已就绪')]
        with patch.object(self.api, '_all_final_source_rows', return_value=[row]):
            return self.api._final_input_quality(inputs, {'attendance_draft': self.batch()})

    def test_overtime_only_is_ready_without_changing_review_or_base_hours(self):
        api = self.api
        for code in api.WORKDAY_OVERTIME_ONLY_EXCEPTIONS:
            row = self.record([code]); before = copy.deepcopy(row)
            checks = self.quality(row)
            self.assertTrue(checks[0]['ready'])
            self.assertEqual(checks[0]['issues'], [])
            self.assertEqual(checks[0]['exclusions'][0]['scope'], '仅工作日加班')
            self.assertEqual(row, before)
            values = api._attendance_downstream_values(row, exclude_pending_dates=True)
            self.assertEqual((values['standard_hours'], values['actual_attendance_hours'], values['workday_overtime_hours']), (16, 16, 2))

    def test_missing_card_mixed_unknown_and_non_daily_still_block(self):
        for codes in (['CLOCK_IN_MISSING'], ['UNKNOWN'],
                      ['WORKDAY_OUTSIDE_SHIFT_UNAPPROVED', 'ATTENDANCE_HOURS_MISMATCH'],
                      ['WORKDAY_OUTSIDE_SHIFT_UNAPPROVED', 'EMPLOYEE_NOT_FOUND']):
            with self.subTest(codes=codes):
                self.assertFalse(self.quality(self.record(codes))[0]['ready'])

    def test_old_date_only_warning_maps_to_unique_source_date(self):
        row = self.record()
        row['processed_value']['exception_lines'] = [dict(attendance_date='2026-08-10', exception_codes=row['exception_codes'])]
        result = self.api._attendance_downstream_values(row, exclude_pending_dates=True)
        self.assertEqual(result['actual_attendance_hours'], 16)
        self.assertEqual(result['workday_overtime_hours'], 2)

    def test_legacy_warning_without_codes_remains_blocking_and_is_not_paid(self):
        row = self.record()
        row['exception_codes'] = []
        row['processed_value']['exception_lines'][0]['exception_codes'] = []
        self.assertFalse(self.quality(row)[0]['ready'])
        values = self.api._attendance_downstream_values(row, exclude_pending_dates=True)
        self.assertEqual(values['actual_attendance_hours'], 8)
        self.assertEqual(values['standard_hours'], 16)
        self.assertEqual(self.api._pending_workday_overtime_keys(row, row['processed_value']), set())

    def test_explicit_day_excludes_standard_and_facts_without_new_absence(self):
        row = self.record(excluded=True); before = copy.deepcopy(row)
        values = self.api._attendance_downstream_values(row, exclude_pending_dates=True)
        self.assertEqual((values['standard_hours'], values['actual_attendance_hours'], values['workday_overtime_hours'], values['deep_night_shifts']), (8, 8, 2, 1))
        self.assertEqual(self.api._final_calculation(values)['adjusted_one_absence'], 0)
        self.assertEqual(len(values['attendance_details']), 1)
        self.assertTrue(self.quality(row)[0]['ready'])
        self.assertEqual(row, before)

    def test_first_final_finance_payroll_and_daily_projection_agree(self):
        api = self.api
        for excluded in (False, True):
            with self.subTest(excluded=excluded):
                row = self.record(excluded=excluded)
                with patch.object(api, '_result_rows', return_value=[row]), patch.object(api, '_employee_directory', return_value=[]):
                    final = api._monthly_final_rows({'attendance_draft': self.batch()})[0]
                    first = api._monthly_first_signed_rows({'attendance_draft': self.batch()})[0]
                    daily = api._monthly_first_signed_daily_rows({'attendance_draft': self.batch()})
                actual = 8 if excluded else 16
                self.assertEqual((first['actual_attendance_hours'], final['actual_attendance_hours']), (actual, actual))
                self.assertEqual(first['standard_hours'], actual)
                self.assertEqual(sum(float(d[12]) for d in daily), actual)
                self.assertEqual(sum(float(d[11]) for d in daily), actual)
                self.assertEqual(sum(float(d[14]) for d in daily), final['workday_overtime_hours'])
                self.assertEqual(api._payroll_settlement_values(final)['adjusted_working_hours'], actual)
                self.assertEqual(api._finance_final_preview_rows([final])[0]['actual_attendance_hours'], actual)
                self.assertIn('不计入', first['review_note'])
                self.assertIn('排除' if excluded else '保留', daily[0][-1])

    def test_special_grid_cannot_reintroduce_explicitly_excluded_date(self):
        api = self.api
        row = self.record(excluded=True)
        special = dict(source_type='special_hours', employee_code='E1', eligible_for_downstream=True,
                       processed_value={'special_hours': 5, 'special_hours_days': [{'day': 10, 'hours': 3}, {'day': 11, 'hours': 2}]})
        with patch.object(api, '_result_rows', side_effect=lambda batch, *_a, **_k: [row] if batch.source_type == 'attendance_draft' else [special]), patch.object(api, '_employee_directory', return_value=[]), patch.object(api, '_company_statutory_holidays', return_value=set()):
            result = api._monthly_final_rows({'attendance_draft': self.batch(), 'special_hours': self.batch('special_hours')})[0]
        self.assertEqual(result['special_hours_days'], [{'day': 11, 'hours': 2}])
        self.assertEqual(result['special_hours'], 2)

    def test_ledger_uses_company_scope_and_paginates_without_writes(self):
        api = self.api
        row = self.record(excluded=True)
        with patch.object(api, '_require_processing_manager') as permission, patch.object(api, '_require_company', side_effect=lambda v: v), patch.object(api, '_require_month', side_effect=lambda v: v), patch.object(api, '_latest_batch', return_value=self.batch()) as latest, patch.object(api, '_all_final_source_rows', return_value=[row]):
            result = api.list_attendance_downstream_exclusions('TEST', '2026-08', 0, 1)
            beyond = api.list_attendance_downstream_exclusions('TEST', '2026-08', 1, 1)
        permission.assert_called()
        latest.assert_called_with('TEST', '2026-08', 'attendance_draft')
        self.assertEqual(result['total_count'], 1)
        self.assertFalse(result['has_more'])
        self.assertEqual(beyond['items'], [])
        event = result['items'][0]
        self.assertEqual((event['excluded_standard_hours'], event['excluded_actual_hours']), (8, 8))
        self.assertEqual(event['reason'], '核实当天不结算')
        self.assertEqual(event['operator'], 'reviewer@example.com')
        self.assertEqual(event['occurred_on'], '2026-10-30T12:00:00')

    def test_excluded_missing_card_date_does_not_block_another_overtime_only_date(self):
        row = self.record(['CLOCK_IN_MISSING'], excluded=True)
        other = dict(row['processed_value']['attendance_details'][1], exception_codes=['WORKDAY_OUTSIDE_SHIFT_UNAPPROVED'])
        row['processed_value']['exception_lines'].append(other)
        row['exception_codes'].append('WORKDAY_OUTSIDE_SHIFT_UNAPPROVED')
        row['review_status'] = '待审核'
        self.assertTrue(self.quality(row)[0]['ready'])

    def test_actual_generation_allows_overtime_or_explicit_exclusion_and_still_requires_approval(self):
        api = self.api
        from frappe.utils import file_manager
        from contextlib import ExitStack
        for excluded in (False, True):
            with self.subTest(excluded=excluded), ExitStack() as stack:
                row = self.record(excluded=excluded)
                checks = self.quality(row)
                batches = {'attendance_draft': self.batch()}
                replacements = {
                    '_require_processing_manager': None,
                    '_require_company': lambda value: value, '_require_month': lambda value: value,
                    'get_processing_batch': {'finalization_inputs': checks},
                    '_final_snapshot_batches': batches, '_first_signed_snapshot_batches': batches,
                    '_processing_state_hash': 'checked', '_processing_meta': {},
                    '_employee_directory': [], '_result_rows': [row],
                    '_attendance_final_excel_config_hash': 'config', '_save_batch_notes': None,
                }
                for name, value in replacements.items():
                    stack.enter_context(patch.object(api, name, side_effect=value) if callable(value) else patch.object(api, name, return_value=value))
                stack.enter_context(patch.object(api.frappe, 'db', types.SimpleNamespace(commit=lambda: None)))
                approval = stack.enter_context(patch.object(api, '_monthly_final_approval_state', return_value={'approved_for_current_snapshot': False}))
                save = stack.enter_context(patch.object(file_manager, 'save_file', side_effect=lambda name, *_a, **_k: types.SimpleNamespace(file_url='/private/files/' + name, file_name=name)))
                blocked = api.generate_monthly_final_files('TEST', '2026-08')
                self.assertTrue(blocked['blocked'])
                save.assert_not_called()
                approval.return_value = {'approved_for_current_snapshot': True}
                result = api.generate_monthly_final_files('TEST', '2026-08')
                self.assertFalse(result['blocked'])
                self.assertEqual(save.call_count, 3)
                for call in save.call_args_list:
                    book = load_workbook(io.BytesIO(call.args[1]))
                    self.assertIn('不计入下游记录', book.sheetnames)
                self.assertEqual(result['first_signed_outputs']['source_quality'][0]['exclusions'][0]['scope'], '当天全部考勤' if excluded else '仅工作日加班')

    def test_all_generated_files_contain_frozen_exclusion_ledger(self):
        api = self.api
        row = self.record(excluded=True)
        with patch.object(api, '_result_rows', return_value=[row]), patch.object(api, '_employee_directory', return_value=[]):
            rows = api._monthly_first_signed_rows({'attendance_draft': self.batch()})
            daily = api._monthly_first_signed_daily_rows({'attendance_draft': self.batch()})
        rows[0]['_source_quality'] = self.quality(row)
        from frappe.utils import file_manager
        for name in ('_save_monthly_first_signed_confirmation_file', '_save_monthly_signed_confirmation_file', '_save_monthly_finance_confirmation_file'):
            with self.subTest(generator=name), patch.object(file_manager, 'save_file') as save:
                save.return_value = types.SimpleNamespace(file_url='test', file_name='test.xlsx')
                args = ('2026-08', rows, daily) if 'first_signed' in name else ('2026-08', rows)
                getattr(api, name)(*args)
                book = load_workbook(io.BytesIO(save.call_args.args[1]))
                self.assertIn('不计入下游记录', book.sheetnames)
                sheet = book['不计入下游记录']
                self.assertEqual([sheet.cell(2, col).value for col in (1, 3, 5, 6, 9, 10)], ['E1', '2026-08-10', 8, 8, '核实当天不结算', 'reviewer@example.com'])


if __name__ == '__main__':
    unittest.main()
