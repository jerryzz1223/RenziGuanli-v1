"""Add configured screen and print watermarks to generated XLSX workbooks."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


_OFFICE_DOCUMENT_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
_RELATIONSHIPS_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships"
_SPREADSHEET_NAMESPACE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_DOCUMENT_RELATIONSHIPS_NAMESPACE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_WATERMARK_MEDIA_PATH = "xl/media/hrms-yongxin-watermark.png"


def save_workbook_with_logo_watermark(workbook, output, export_key=None) -> None:
	"""Save a workbook with a configured screen background and optional print header.

	The background remains behind cell values and does not enter print output.
	An enabled print watermark uses the repeating Excel page header.
	"""
	if export_key:
		from hrms.utils.export_watermark_settings import get_export_watermark_options

		options = get_export_watermark_options(export_key)
		if options["print"]:
			shade = round(255 - options["opacity"] * 2)
			color = f"{shade:02X}" * 3
			for sheet in workbook:
				# Excel uses & as a header-format command prefix.
				sheet.oddHeader.center.text = options["text"].replace("&", "&&")
				sheet.oddHeader.center.size = 18
				sheet.oddHeader.center.color = color
		workbook.save(output)
		if not options["export"]:
			return
		image = _render_text_watermark(options["text"], options["opacity"])
	else:
		# Existing callers keep their current logo until assigned an export key.
		workbook.save(output)
		image = None
	output.seek(0)
	watermarked_content = _add_logo_watermark(output.read(), image)
	output.seek(0)
	output.truncate(0)
	output.write(watermarked_content)


def _render_text_watermark(label: str, opacity: int) -> bytes:
	from PIL import Image, ImageDraw, ImageFont

	canvas = Image.new("RGBA", (1200, 500), (255, 255, 255, 0))
	font = None
	for path in (
		"/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
		"/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
		"/usr/share/fonts/truetype/arphic/uming.ttc",
		"/System/Library/Fonts/PingFang.ttc",
		"/System/Library/Fonts/STHeiti Medium.ttc",
		"/System/Library/Fonts/Supplemental/Songti.ttc",
	):
		if Path(path).is_file():
			font = ImageFont.truetype(path, 62)
			break
	if font is None:
		font = ImageFont.load_default()
	draw = ImageDraw.Draw(canvas)
	box = draw.textbbox((0, 0), label, font=font)
	width = box[2] - box[0]
	height = box[3] - box[1]
	draw.text(((1200 - width) / 2, (500 - height) / 2), label, font=font, fill=(90, 90, 90, round(255 * opacity / 100)))
	result = BytesIO()
	canvas.save(result, "PNG")
	return result.getvalue()


def _add_logo_watermark(content: bytes, image: bytes | None = None) -> bytes:
	"""Attach a background picture to every worksheet in an XLSX package."""
	with ZipFile(BytesIO(content)) as source:
		worksheet_paths = [
			info.filename
			for info in source.infolist()
			if info.filename.startswith("xl/worksheets/")
			and info.filename.endswith(".xml")
			and "/_rels/" not in info.filename
		]
		if not worksheet_paths:
			return content

		files = {info.filename: source.read(info.filename) for info in source.infolist()}

	# Keep the desk/navigation logo unchanged.  Exports use a dedicated, pale
	# bitmap so values remain legible when Excel repeats it as a sheet background.
	if image is None:
		logo_path = Path(__file__).resolve().parents[1] / "public" / "images" / "yongxin-brand-watermark.png"
		if not logo_path.is_file():
			return content
		image = logo_path.read_bytes()
	files[_WATERMARK_MEDIA_PATH] = image
	files["[Content_Types].xml"] = _ensure_png_content_type(files["[Content_Types].xml"])

	for worksheet_path in worksheet_paths:
		relationship_path = _worksheet_relationship_path(worksheet_path)
		if b"hrms-yongxin-watermark.png" in files.get(relationship_path, b""):
			continue
		relationships, relationship_id = _add_image_relationship(files.get(relationship_path, b""))
		files[relationship_path] = relationships
		files[worksheet_path] = _add_background_picture(files[worksheet_path], relationship_id)

	output = BytesIO()
	with ZipFile(output, "w", ZIP_DEFLATED) as archive:
		for filename, file_content in files.items():
			archive.writestr(filename, file_content)
	return output.getvalue()


def _worksheet_relationship_path(worksheet_path: str) -> str:
	parent, filename = worksheet_path.rsplit("/", 1)
	return f"{parent}/_rels/{filename}.rels"


def _ensure_png_content_type(content: bytes) -> bytes:
	if b'Extension="png"' in content:
		return content
	marker = b"</Types>"
	default = b'<Default Extension="png" ContentType="image/png"/>'
	return content.replace(marker, default + marker, 1)


def _add_image_relationship(content: bytes) -> tuple[bytes, str]:
	if not content:
		content = (
			b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
			+ f'<Relationships xmlns="{_RELATIONSHIPS_NAMESPACE}"></Relationships>'.encode()
		)
	used_ids = {int(item[3:]) for item in _relationship_ids(content) if item[3:].isdigit()}
	relationship_id = f"rId{max(used_ids, default=0) + 1}"
	relationship = (
		f'<Relationship Id="{relationship_id}" Type="{_OFFICE_DOCUMENT_RELATIONSHIP}" '
		'Target="../media/hrms-yongxin-watermark.png"/>'
	).encode()
	return content.replace(b"</Relationships>", relationship + b"</Relationships>", 1), relationship_id


def _relationship_ids(content: bytes) -> list[bytes]:
	import re

	return re.findall(rb"Id=['\"](rId\d+)['\"]", content)


def _add_background_picture(content: bytes, relationship_id: str) -> bytes:
	# A comment's legacyDrawing may declare xmlns:r only on that element.
	# Declare it on the picture itself so sibling-local namespaces cannot leave
	# the background relationship unbound and make the downloaded XLSX invalid.
	picture = (
		f'<picture r:id="{relationship_id}" xmlns:r="{_DOCUMENT_RELATIONSHIPS_NAMESPACE}"/>'
	).encode()
	return content.replace(b"</worksheet>", picture + b"</worksheet>", 1)
