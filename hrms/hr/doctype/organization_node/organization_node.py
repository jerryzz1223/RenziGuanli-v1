import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cstr


class OrganizationNode(Document):
	def validate(self):
		self.node_code = cstr(self.node_code).strip()
		self.source_cell = cstr(self.source_cell).strip()
		if self.parent_node == self.name:
			frappe.throw(_("上级节点不能是当前节点。"))
		if self.parent_node and _would_create_node_loop(self.name, self.parent_node):
			frappe.throw(_("上级节点不能是当前节点的下级。"))


def _would_create_node_loop(node_name, parent_name):
	seen = {node_name}
	while parent_name:
		if parent_name in seen:
			return True
		seen.add(parent_name)
		parent_name = frappe.db.get_value("Organization Node", parent_name, "parent_node")
	return False

