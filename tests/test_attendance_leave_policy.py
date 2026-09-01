import ast
import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).parents[1]
DRAFT_PATH = ROOT / "hrms" / "api" / "attendance_processors" / "attendance_draft.py"
ATTENDANCE_IMPORT_PATH = ROOT / "hrms" / "api" / "attendance_import.py"
PAYROLL_INPUT_PATH = ROOT / "hrms" / "api" / "payroll_input.py"


def _draft_processor():
	spec = importlib.util.spec_from_file_location("attendance_leave_policy_draft", DRAFT_PATH)
	module = importlib.util.module_from_spec(spec)
	spec.loader.exec_module(module)
	return module


def _full_attendance_bonus():
	tree = ast.parse(PAYROLL_INPUT_PATH.read_text())
	function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_full_attendance_bonus")
	namespace = {"flt": lambda value: float(value or 0)}
	exec(compile(ast.Module(body=[function], type_ignores=[]), str(PAYROLL_INPUT_PATH), "exec"), namespace)
	return namespace["_full_attendance_bonus"]


def _legacy_monthly_values():
	tree = ast.parse(ATTENDANCE_IMPORT_PATH.read_text())
	function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_calculate_monthly_values")
	namespace = {"LARGE_NIGHT_SHIFT_ALLOWANCE": 45, "SMALL_NIGHT_SHIFT_ALLOWANCE": 24, "APPLE_UNIT_AMOUNT": 5}
	exec(compile(ast.Module(body=[function], type_ignores=[]), str(ATTENDANCE_IMPORT_PATH), "exec"), namespace)
	return namespace["_calculate_monthly_values"]


class AttendanceLeavePolicyTest(unittest.TestCase):
	def test_reunion_leave_days_are_normalized_to_paid_hours_and_prevent_absence(self):
		processor = _draft_processor()
		result = processor.process_attendance_draft_rows(
			[{
				"姓名": "张三", "工号": "E-001", "日期": "26-06-01", "实际部门": "工程课",
				"标准工时": 8, "实际出勤（小时）": 0, "请假/团圆假(天)": 1, "source_row": 3,
			}],
			attendance_month="2026-06",
		)
		row = result["processed_rows"][0]["processed_value"]
		self.assertEqual(row["reunion_leave_hours"], 8)
		self.assertEqual(row["absence_hours"], 0)

	def test_reunion_leave_does_not_reduce_full_attendance_bonus(self):
		bonus, absence_basis = _full_attendance_bonus()(
			SimpleNamespace(standard_hours=8, actual_attendance_hours=0, rest_leave_hours=0, reunion_leave_hours=8, sick_leave_hours=0),
			{"parameters": {"thresholds": [[0, 200]]}},
		)
		self.assertEqual(absence_basis, 0)
		self.assertEqual(bonus, 200)

	def test_reunion_leave_is_paid_in_legacy_monthly_final_too(self):
		calculated = _legacy_monthly_values()({
			"standard_hours": 8, "actual_attendance_hours": 0, "reunion_leave_hours": 8,
			"sick_leave_hours": 0, "annual_leave_hours": 0, "work_injury_leave_hours": 0,
			"bereavement_leave_hours": 0, "marriage_leave_hours": 0, "personal_leave_hours": 0,
			"rest_leave_hours": 0, "overtime_1_5_hours": 0, "overtime_2_hours": 0,
			"overtime_3_hours": 0, "large_night_shift_count": 0, "small_night_shift_count": 0,
			"absent_hours": 0, "red_apples": 0,
		})
		self.assertEqual(calculated["adjusted_working_hours"], 8)
		self.assertEqual(calculated["full_attendance_deduction"], 0)


if __name__ == "__main__":
	unittest.main()
