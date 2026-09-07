import json

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cstr


class OrganizationNode(Document):
	def validate(self):
		self.node_code = cstr(self.node_code).strip()
		self.source_cell = cstr(self.source_cell).strip()
		self.display_name = cstr(self.display_name).strip()
		self._validate_manual_node_type()
		if self.parent_node == self.name:
			frappe.throw(_("上级节点不能是当前节点。"))
		if self.parent_node and _would_create_node_loop(self.name, self.parent_node):
			frappe.throw(_("上级节点不能是当前节点的下级。"))
		if self.parent_node:
			self._validate_parent_type()

	def _validate_manual_node_type(self):
		config = _manual_node_config(self.get("source_text"))
		node_kind = config.get("node_kind")
		if node_kind and node_kind not in {"分管", "室", "课", "组", "线", "岗位", "员工"}:
			frappe.throw(_("组织节点类型只能是分管、室、课、组、线、岗位或员工。"))
		if not self.display_name:
			frappe.throw(_("请填写显示名称。"))
		if node_kind == "员工" and not config.get("employee") and not config.get("framework"):
			frappe.throw(_("员工节点必须选择员工档案。"))
		if node_kind == "分管" and not config.get("manager_name") and not config.get("framework"):
			frappe.throw(_("请填写分管人的显示名称。"))

	def _validate_parent_type(self):
		parent = frappe.db.get_value("Organization Node", self.parent_node, ["node_type", "source_text"], as_dict=True)
		parent_type = _manual_node_config(parent.get("source_text")).get("node_kind") if parent else None
		node_kind = _manual_node_config(self.get("source_text")).get("node_kind")
		if not node_kind:
			return
		from hrms.hr.page.organizational_chart.organizational_chart import MANUAL_ORGANIZATION_CHILD_KINDS
		allowed_parents = {kind: {parent for parent, children in MANUAL_ORGANIZATION_CHILD_KINDS.items() if kind in children} for kind in MANUAL_ORGANIZATION_CHILD_KINDS if kind}
		if parent_type not in allowed_parents[node_kind]:
			frappe.throw(
				_("{0}节点只能放在{1}下。").format(
					node_kind, "、".join(sorted(parent or "公司" for parent in allowed_parents[node_kind]))
				)
			)


def _manual_node_config(source_text):
	try:
		value = json.loads(cstr(source_text))
		return value if isinstance(value, dict) and value.get("manual_organization") else {}
	except (TypeError, ValueError):
		return {}


def _would_create_node_loop(node_name, parent_name):
	seen = {node_name}
	while parent_name:
		if parent_name in seen:
			return True
		seen.add(parent_name)
		parent_name = frappe.db.get_value("Organization Node", parent_name, "parent_node")
	return False
