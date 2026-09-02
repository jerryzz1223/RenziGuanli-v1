from __future__ import annotations

import importlib.util
from io import BytesIO
from pathlib import Path
import unittest
from zipfile import ZIP_DEFLATED, ZipFile


MODULE_PATH = Path(__file__).resolve().parents[1] / "hrms" / "utils" / "export_watermark.py"
SPEC = importlib.util.spec_from_file_location("export_watermark", MODULE_PATH)
WATERMARK = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(WATERMARK)
_add_logo_watermark = WATERMARK._add_logo_watermark


def _minimal_workbook():
	content = BytesIO()
	with ZipFile(content, "w", ZIP_DEFLATED) as archive:
		archive.writestr(
			"[Content_Types].xml",
			'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
		)
		archive.writestr(
			"xl/worksheets/sheet1.xml",
			'<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>',
		)
		archive.writestr(
			"xl/worksheets/sheet2.xml",
			'<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>',
		)
	return content.getvalue()


class TestExportWatermark(unittest.TestCase):
	def test_export_uses_the_pale_watermark_asset(self):
		asset_path = Path(WATERMARK.__file__).resolve().parents[1] / "public" / "images" / "yongxin-brand-watermark.png"
		self.assertTrue(asset_path.is_file())
		self.assertNotEqual(
			asset_path.read_bytes(),
			asset_path.with_name("yongxin-brand-mark.png").read_bytes(),
		)

	def test_export_workbook_has_yongxin_logo_background_on_each_sheet(self):
		watermarked = _add_logo_watermark(_minimal_workbook())
		with ZipFile(BytesIO(watermarked)) as workbook:
			for sheet_number in (1, 2):
				sheet = workbook.read(f"xl/worksheets/sheet{sheet_number}.xml")
				relationships = workbook.read(f"xl/worksheets/_rels/sheet{sheet_number}.xml.rels")
				self.assertIn(b"<picture r:id=", sheet)
				self.assertIn(b"hrms-yongxin-watermark.png", relationships)
			self.assertIn("xl/media/hrms-yongxin-watermark.png", workbook.namelist())

	def test_export_watermark_preserves_a_workbook_that_already_has_one(self):
		once = _add_logo_watermark(_minimal_workbook())
		twice = _add_logo_watermark(once)
		with ZipFile(BytesIO(twice)) as workbook:
			self.assertEqual(workbook.read("xl/worksheets/sheet1.xml").count(b"<picture r:id="), 1)
