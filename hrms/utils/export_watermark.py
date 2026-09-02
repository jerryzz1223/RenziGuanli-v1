"""Brand every generated XLSX workbook with the Yongxin logo watermark."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


_OFFICE_DOCUMENT_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
_RELATIONSHIPS_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships"
_SPREADSHEET_NAMESPACE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_DOCUMENT_RELATIONSHIPS_NAMESPACE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_WATERMARK_MEDIA_PATH = "xl/media/hrms-yongxin-watermark.png"


def save_workbook_with_logo_watermark(workbook, output) -> None:
	"""Save an openpyxl workbook with a non-editable sheet-background logo.

	An XLSX background image is the closest spreadsheet equivalent of a watermark:
	it stays behind cells, does not change the workbook's data or layout, and is
	preserved when the downloaded file is opened in Excel or WPS.
	"""
	workbook.save(output)
	output.seek(0)
	watermarked_content = _add_logo_watermark(output.read())
	output.seek(0)
	output.truncate(0)
	output.write(watermarked_content)


def _add_logo_watermark(content: bytes) -> bytes:
	"""Attach the bundled Yongxin mark as a background picture to every sheet."""
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
	logo_path = Path(__file__).resolve().parents[1] / "public" / "images" / "yongxin-brand-watermark.png"
	if not logo_path.is_file():
		return content
	files[_WATERMARK_MEDIA_PATH] = logo_path.read_bytes()
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


def _relationship_ids(content: bytes) -> list[str]:
	import re

	return re.findall(rb'Id="(rId\d+)"', content).copy()  # type: ignore[return-value]


def _add_background_picture(content: bytes, relationship_id: str) -> bytes:
	if b"xmlns:r=" not in content:
		content = content.replace(
			b"<worksheet ",
			f'<worksheet xmlns:r="{_DOCUMENT_RELATIONSHIPS_NAMESPACE}" '.encode(),
			1,
		)
	picture = f'<picture r:id="{relationship_id}"/>'.encode()
	return content.replace(b"</worksheet>", picture + b"</worksheet>", 1)
