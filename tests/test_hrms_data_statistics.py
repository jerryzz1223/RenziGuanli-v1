import ast
import unittest
from collections import OrderedDict
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace


SOURCE = Path(__file__).resolve().parents[1] / "hrms/api/data_statistics.py"


def load_month_range():
	tree = ast.parse(SOURCE.read_text())
	function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_statistics_month_range")
	namespace = {"date": date, "datetime": datetime, "re": __import__("re")}
	exec(compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), "exec"), namespace)
	return namespace["_statistics_month_range"]


def load_within_statistics_month():
	tree = ast.parse(SOURCE.read_text())
	function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_within_statistics_month")
	namespace = {"datetime": datetime}
	exec(compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), "exec"), namespace)
	return namespace["_within_statistics_month"]


def load_creation_events():
	tree = ast.parse(SOURCE.read_text())
	function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_creation_events")
	namespace = {
		"datetime": datetime,
		"OrderedDict": OrderedDict,
		"IMPORT_SESSION_GAP": __import__("datetime").timedelta(minutes=10),
	}
	exec(compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), "exec"), namespace)
	return namespace["_creation_events"]


def load_collapse_import_sessions():
	tree = ast.parse(SOURCE.read_text())
	function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_collapse_import_sessions")
	namespace = {
		"datetime": datetime,
		"IMPORT_SESSION_GAP": __import__("datetime").timedelta(minutes=10),
		"IMPORT_MODIFICATION_THRESHOLD": 10,
	}
	exec(compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), "exec"), namespace)
	return namespace["_collapse_import_sessions"]


class DataStatisticsMonthRangeTest(unittest.TestCase):
	def test_defaults_to_current_month(self):
		month, start, end = load_month_range()(today=date(2026, 9, 14))
		self.assertEqual((month, start, end), ("2026-09", datetime(2026, 9, 1), datetime(2026, 10, 1)))

	def test_december_rolls_into_next_year(self):
		month, start, end = load_month_range()(month="2026-12")
		self.assertEqual((month, start, end), ("2026-12", datetime(2026, 12, 1), datetime(2027, 1, 1)))

	def test_rejects_invalid_month(self):
		for value in ("2026-00", "2026-13", "2026-9", "invalid"):
			with self.subTest(value=value), self.assertRaises(ValueError):
				load_month_range()(month=value)

	def test_operator_event_month_boundary(self):
		within_month = load_within_statistics_month()
		start = datetime(2026, 9, 1)
		end = datetime(2026, 10, 1)
		self.assertTrue(within_month("2026-09-01 00:00:00", start, end))
		self.assertTrue(within_month(datetime(2026, 9, 30, 23, 59, 59), start, end))
		self.assertFalse(within_month("2026-10-01 00:00:00", start, end))
		self.assertFalse(within_month("not-a-date", start, end))

	def test_import_batch_rows_count_as_one_operation(self):
		rows = [
			SimpleNamespace(name=f"ROW-{index}", owner="operator@example.com", creation=datetime(2026, 9, 9, 11, 46, index), import_batch="BATCH-1", get=lambda key, batch="BATCH-1": batch if key == "import_batch" else None)
			for index in range(3)
		]
		events = load_creation_events()(rows, "import_batch", "HRMS Attendance Import Batch")
		self.assertEqual(len(events), 1)
		self.assertEqual(events[0]["record_count"], 3)
		self.assertEqual(events[0]["batch_name"], "BATCH-1")

	def test_old_unbatched_rows_merge_within_import_session(self):
		def row(name, minute):
			return SimpleNamespace(name=name, owner="Administrator", creation=datetime(2026, 9, 9, 7, minute), get=lambda _key: None)

		events = load_creation_events()([row("EMP-1", 20), row("EMP-2", 21), row("EMP-3", 40)])
		self.assertEqual([event["record_count"] for event in events], [2, 1])

	def test_bulk_versions_join_the_same_import_operation(self):
		events = [{"operator": "Administrator", "operated_at": "2026-09-09 07:21:37", "operation_type": "imported", "record_count": 398, "record_names": ["EMP-1"], "_record_names_all": [f"EMP-{index}" for index in range(398)]}]
		events.extend(
			{"operator": "Administrator", "operated_at": f"2026-09-09 07:1{5 + index % 2}:00", "operation_type": "modified", "record_name": f"OLD-{index}"}
			for index in range(20)
		)
		collapsed = load_collapse_import_sessions()(events)
		self.assertEqual(len(collapsed), 1)
		self.assertEqual(collapsed[0]["operation_type"], "imported")
		self.assertEqual(collapsed[0]["record_count"], 418)

	def test_single_manual_modification_stays_a_modification(self):
		event = {"operator": "Administrator", "operated_at": "2026-09-12 12:13:37", "operation_type": "modified", "record_name": "EMP-1"}
		self.assertEqual(load_collapse_import_sessions()([event]), [event])


if __name__ == "__main__":
	unittest.main()
