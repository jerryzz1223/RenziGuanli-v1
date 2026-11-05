"""Original workbook layout, date conversion, and rejection boundaries."""
from datetime import date
from io import BytesIO
import importlib.util
from pathlib import Path
import unittest

from openpyxl import Workbook

spec = importlib.util.spec_from_file_location("importer", Path(__file__).resolve().parents[1] / "hrms/hr/interview_register_importer.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def workbook(records):
    book = Workbook()
    sheet = book.active
    sheet.title = "面试人员清单"
    sheet.append([None, None, "人员面试清单"])
    upper, lower = [None], [None]
    for i, (_, label) in enumerate(importer.COLUMNS):
        upper.append("人员基本信息" if i == 3 else None if 3 <= i <= 9 or i == 20 else label)
        lower.append(label if 3 <= i <= 9 or i == 20 else "未报到" if i == 19 else None)
    sheet.append(upper)
    sheet.append(lower)
    for record in records:
        sheet.append([None] + [record.get(key) for key, _ in importer.COLUMNS])
    out = BytesIO()
    book.save(out)
    return out.getvalue()


class ImporterTests(unittest.TestCase):
    def row(self, **changes):
        return dict(registration_month="2603月", source_sequence=9, candidate_name="测试人员",
                    phone=13900000000, interview_date=46108, interview_position="质检", education="专科",
                    source="网上", hired="否", age=37, **changes)

    def test_original_layout_and_values(self):
        result = importer.parse_workbook(workbook([self.row()]))
        self.assertEqual(result["errors"], [])
        row = result["rows"][0]
        self.assertEqual(row["row"], 4)
        self.assertEqual(row["values"]["interview_date"], "2026-03-27")
        self.assertEqual(row["values"]["registration_month"], "2026-03")
        self.assertEqual(row["values"]["phone"], "13900000000")
        self.assertEqual(row["values"]["source_sequence"], "9")
        self.assertEqual(row["values"]["education"], "专科")
        self.assertEqual(row["values"]["arrival_status"], "")

    def test_typed_dates_and_arrival(self):
        row = self.row()
        row.update(interview_date=date(2026, 3, 27), expected_start_date="2026/04/01", hired="是", arrival_status="否")
        values = importer.parse_workbook(workbook([row]))["rows"][0]["values"]
        self.assertEqual(values["arrival_status"], "未报到")
        self.assertEqual(values["expected_start_date"], "2026-04-01")

    def test_invalid_rows_and_empty_workbook(self):
        for changes in ({"phone": ""}, {"interview_date": "not-date"}, {"age": 18.5}, {"hired": "unknown"}, {"candidate_name": "=1+1"}):
            row = self.row()
            row.update(changes)
            result = importer.parse_workbook(workbook([row]))
            self.assertEqual(result["rows"], [])
            self.assertEqual(result["errors"][0]["row"], 4)
        self.assertTrue(importer.parse_workbook(workbook([]))["errors"])

    def test_select_errors_are_editable_and_suggestions_require_opt_in(self):
        content = workbook([self.row()])
        options = {"education": ["", "小学", "初中", "大专", "本科"]}
        preview = importer.parse_workbook(content, select_options=options)
        self.assertEqual(preview["total"], 1)
        self.assertEqual(preview["rows"], [])
        error = preview["errors"][0]
        self.assertEqual((error["field"], error["value"], error["suggestion"]), ("education", "专科", "大专"))
        fixed = importer.parse_workbook(content, [{"row": 4, "field": "education", "value": "大专"}], options)
        self.assertEqual(fixed["errors"], [])
        self.assertEqual(fixed["rows"][0]["values"]["education"], "大专")
        self.assertEqual(fixed["corrections"][0]["original"], "专科")
        self.assertEqual(importer.parse_workbook(content)["rows"][0]["values"]["education"], "专科")

    def test_multiple_errors_and_partial_corrections_preserve_source_rows(self):
        row = self.row()
        row.update(phone="", age="bad", interview_date="bad", gender="unknown")
        content = workbook([row, self.row()])
        preview = importer.parse_workbook(content)
        self.assertEqual(preview["total"], 2)
        self.assertEqual({e["field"] for e in preview["errors"]}, {"phone", "age", "interview_date", "gender"})
        self.assertTrue(all(e["suggestion"] is None for e in preview["errors"]))
        edits = [{"row": 4, "field": field, "value": value} for field, value in
                 [("phone", "13900000001"), ("age", "28"), ("interview_date", "2026-03-28"), ("gender", "女")]]
        fixed = importer.parse_workbook(content, edits)
        self.assertEqual(fixed["errors"], [])
        self.assertEqual([r["row"] for r in fixed["rows"]], [4, 5])
        self.assertEqual(fixed["rows"][0]["values"]["registration_month"], "2026-03")
        self.assertEqual(fixed["rows"][1]["values"]["phone"], "13900000000")

    def test_corrections_cannot_inject_fields_rows_or_formulas(self):
        content = workbook([self.row()])
        for edits in ([{"row": 4, "field": "company", "value": "other"}],
                      [{"row": 5, "field": "phone", "value": "123"}],
                      [{"row": 4, "field": "phone", "value": "123"}] * 2,
                      {"row": 4}):
            with self.assertRaises(ValueError): importer.parse_workbook(content, edits)
        result = importer.parse_workbook(content, [{"row": 4, "field": "phone", "value": "=1+1"}])
        self.assertEqual(result["rows"], [])
        self.assertEqual(result["errors"][0]["field"], "phone")

    def test_unrecognized_headers(self):
        book = Workbook()
        book.active.append(["wrong"])
        content = BytesIO()
        book.save(content)
        with self.assertRaises(ValueError):
            importer.parse_workbook(content.getvalue())


if __name__ == "__main__":
    unittest.main()
