import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cstr


class OrganizationPosition(Document):
	def validate(self):
		self.position_code = cstr(self.position_code).strip()
		self.source_cell = cstr(self.source_cell).strip()
		if self.parent_position == self.name:
			frappe.throw(_("上级岗位节点不能是当前岗位节点。"))
		if self.parent_position and _would_create_position_loop(self.name, self.parent_position):
			frappe.throw(_("上级岗位节点不能是当前岗位节点的下级。"))
		self._validate_grade_tags()

	def _validate_grade_tags(self):
		seen = set()
		for row in self.suggested_grade_tags or []:
			if not row.grade_tag or row.grade_tag in seen:
				frappe.throw(_("建议职级标签不能重复。"))
			seen.add(row.grade_tag)


def _would_create_position_loop(position_name, parent_name):
	seen = {position_name}
	while parent_name:
		if parent_name in seen:
			return True
		seen.add(parent_name)
		parent_name = frappe.db.get_value("Organization Position", parent_name, "parent_position")
	return False
