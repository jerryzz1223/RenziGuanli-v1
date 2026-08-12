# Copyright (c) 2021, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt


import frappe
from frappe import _


def _get_node_value(node, key: str):
	if isinstance(node, dict):
		return node.get(key)
	return getattr(node, key, None)


@frappe.whitelist()
def get_all_nodes(method: str, company: str):
	"""Recursively gets all data from nodes"""
	method = frappe.get_attr(method)

	if method not in frappe.whitelisted:
		frappe.throw(_("Not Permitted"), frappe.PermissionError)

	root_nodes = method(company=company) or []
	result = []
	nodes_to_expand = []
	queued_ids = set()
	expanded_ids = set()

	def queue_expandable_nodes(data):
		for node in data:
			node_id = _get_node_value(node, "id")
			if not _get_node_value(node, "expandable") or not node_id:
				continue
			if node_id in expanded_ids or node_id in queued_ids:
				continue
			nodes_to_expand.append({"id": node_id, "name": _get_node_value(node, "name")})
			queued_ids.add(node_id)

	for root in root_nodes:
		root_id = _get_node_value(root, "id")
		root_name = _get_node_value(root, "name")
		if not root_id or root_id in expanded_ids:
			continue
		data = method(root_id, company) or []
		result.append(dict(parent=root_id, parent_name=root_name, data=data))
		expanded_ids.add(root_id)
		queue_expandable_nodes(data)

	while nodes_to_expand:
		parent = nodes_to_expand.pop(0)
		queued_ids.discard(parent.get("id"))
		if parent.get("id") in expanded_ids:
			continue
		data = method(parent.get("id"), company) or []
		result.append(dict(parent=parent.get("id"), parent_name=parent.get("name"), data=data))
		expanded_ids.add(parent.get("id"))
		queue_expandable_nodes(data)

	return result
