from __future__ import annotations

import importlib.util
import sys
import types
from io import BytesIO
from pathlib import Path
import unittest
from unittest.mock import patch
from xml.etree import ElementTree
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
	def test_configured_export_and_print_are_independent(self):
		from openpyxl import Workbook

		settings = types.ModuleType("hrms.utils.export_watermark_settings")
		options = {"export": False, "print": False, "text": "测试水印", "opacity": 12}
		settings.get_export_watermark_options = lambda key: options.copy()
		with patch.dict(sys.modules, {"hrms.utils.export_watermark_settings": settings}):
			plain = BytesIO()
			WATERMARK.save_workbook_with_logo_watermark(Workbook(), plain, export_key="roster")
			with ZipFile(BytesIO(plain.getvalue())) as archive:
				self.assertNotIn(WATERMARK._WATERMARK_MEDIA_PATH, archive.namelist())
				self.assertNotIn(b"picture", archive.read("xl/worksheets/sheet1.xml"))

			options.update(export=True, print=False)
			screen_only = BytesIO()
			WATERMARK.save_workbook_with_logo_watermark(Workbook(), screen_only, export_key="roster")
			with ZipFile(BytesIO(screen_only.getvalue())) as archive:
				self.assertIn(WATERMARK._WATERMARK_MEDIA_PATH, archive.namelist())
				self.assertNotIn(b"<headerFooter>", archive.read("xl/worksheets/sheet1.xml"))

			options.update(export=True, print=True)
			marked = BytesIO()
			WATERMARK.save_workbook_with_logo_watermark(Workbook(), marked, export_key="roster")
			with ZipFile(BytesIO(marked.getvalue())) as archive:
				self.assertIn(WATERMARK._WATERMARK_MEDIA_PATH, archive.namelist())
				sheet = archive.read("xl/worksheets/sheet1.xml")
				self.assertIn(b"picture", sheet)
				header = ElementTree.fromstring(sheet).find(f"{{{WATERMARK._SPREADSHEET_NAMESPACE}}}headerFooter/{{{WATERMARK._SPREADSHEET_NAMESPACE}}}oddHeader")
				self.assertIn("测试水印", header.text)

	def test_print_header_escapes_excel_format_character(self):
		from openpyxl import Workbook

		settings = types.ModuleType("hrms.utils.export_watermark_settings")
		settings.get_export_watermark_options = lambda key: {"export": False, "print": True, "text": "A&B", "opacity": 20}
		with patch.dict(sys.modules, {"hrms.utils.export_watermark_settings": settings}):
			output = BytesIO()
			WATERMARK.save_workbook_with_logo_watermark(Workbook(), output, export_key="roster")
			with ZipFile(BytesIO(output.getvalue())) as archive:
				sheet = archive.read("xl/worksheets/sheet1.xml")
				self.assertIn(b"A&amp;&amp;B", sheet)

	def test_print_watermark_covers_all_page_types_and_preserves_report_content(self):
		from openpyxl import Workbook, load_workbook

		book = Workbook()
		book.create_sheet("第二张表")
		for sheet in book:
			sheet.append(["员工编号", "工时"])
			sheet.append(["TEST-001", 8])
			sheet.print_title_rows = "1:1"
			sheet.print_area = "A1:B2"
			sheet.HeaderFooter.differentFirst = True
			sheet.HeaderFooter.differentOddEven = True
			sheet.oddHeader.left.text = "原有报表名称"
			sheet.oddHeader.center.text = "原有公司名称"
			sheet.oddHeader.center.size = 10
			sheet.oddFooter.right.text = "第 &P 页"
			sheet.page_margins.top = 0
			sheet.page_margins.header = 0
		settings = types.ModuleType("hrms.utils.export_watermark_settings")
		settings.get_export_watermark_options = lambda key: {"export": True, "print": True, "text": "A&B 测试水印", "opacity": 20}
		output = BytesIO()
		with patch.dict(sys.modules, {"hrms.utils.export_watermark_settings": settings}):
			WATERMARK.save_workbook_with_logo_watermark(book, output, export_key="roster")
		with ZipFile(BytesIO(output.getvalue())) as archive:
			for number in (1, 2):
				root = ElementTree.fromstring(archive.read(f"xl/worksheets/sheet{number}.xml"))
				for tag in ("oddHeader", "evenHeader", "firstHeader"):
					header = root.find(f"{{{WATERMARK._SPREADSHEET_NAMESPACE}}}headerFooter/{{{WATERMARK._SPREADSHEET_NAMESPACE}}}{tag}")
					self.assertIn("A&&B 测试水印", header.text)
					if tag == "oddHeader":
						self.assertIn("&C&10 原有公司名称_x000a_&18&KD7D7D7A&&B 测试水印", header.text)
		output.seek(0)
		for sheet in load_workbook(output):
			self.assertEqual(sheet["B2"].value, 8)
			self.assertEqual(sheet.print_title_rows, "$1:$1")
			self.assertIn("$A$1:$B$2", str(sheet.print_area))
			self.assertEqual(sheet.oddHeader.left.text, "原有报表名称")
			self.assertTrue(sheet.oddHeader.center.text.startswith("原有公司名称\n"))
			self.assertEqual(sheet.oddFooter.right.text, "第 &P 页")
			self.assertTrue(sheet.HeaderFooter.differentFirst)
			self.assertTrue(sheet.HeaderFooter.differentOddEven)
			self.assertFalse(sheet.HeaderFooter.scaleWithDoc)
			self.assertGreaterEqual(sheet.page_margins.header, 0.3)
			self.assertGreaterEqual(sheet.page_margins.top - sheet.page_margins.header, 0.8)

	def test_legacy_logo_export_also_has_print_watermark(self):
		from openpyxl import Workbook, load_workbook

		output = BytesIO()
		WATERMARK.save_workbook_with_logo_watermark(Workbook(), output)
		output.seek(0)
		book = load_workbook(output)
		for header in (book.active.oddHeader, book.active.evenHeader, book.active.firstHeader):
			self.assertEqual(header.center.text, "永新电子（常熟）有限公司")

	def test_background_relationship_is_valid_with_header_comments(self):
		namespace = WATERMARK._DOCUMENT_RELATIONSHIPS_NAMESPACE
		content = (
			f'<worksheet xmlns="{WATERMARK._SPREADSHEET_NAMESPACE}"><sheetData/>'
			f'<legacyDrawing xmlns:r="{namespace}" r:id="rId1"/></worksheet>'
		).encode()
		root = ElementTree.fromstring(WATERMARK._add_background_picture(content, "rId2"))
		picture = root.find(f"{{{WATERMARK._SPREADSHEET_NAMESPACE}}}picture")
		self.assertEqual(picture.attrib[f"{{{namespace}}}id"], "rId2")
		self.assertEqual(root.find(f"{{{WATERMARK._SPREADSHEET_NAMESPACE}}}legacyDrawing").attrib[f"{{{namespace}}}id"], "rId1")

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

	def test_export_watermark_uses_next_available_single_quoted_relationship_id(self):
		relationships, relationship_id = WATERMARK._add_image_relationship(
			b"<Relationships><Relationship Id='rId12'/></Relationships>"
		)

		self.assertEqual(relationship_id, "rId13")
		self.assertIn(b'Id="rId13"', relationships)
