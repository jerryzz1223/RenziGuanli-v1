# Copyright (c) 2021, Frappe Technologies Pvt. Ltd. and Contributors
# MIT License. See license.txt


import frappe
from frappe import _


@frappe.whitelist()
def get_all_nodes(method: str, company: str):
	"""Recursively gets all data from nodes"""
	method = frappe.get_attr(method)

	if method not in frappe.whitelisted:
		frappe.throw(_("Not Permitted"), frappe.PermissionError)

	root_nodes = method(company=company)
	result = []
	nodes_to_expand = []
	queued_ids = set()
	expanded_ids = set()

	def queue_expandable_nodes(data):
		for node in data:
			node_id = node.get("id")
			if not node.get("expandable") or not node_id:
				continue
			if node_id in expanded_ids or node_id in queued_ids:
				continue
			nodes_to_expand.append({"id": node_id, "name": node.get("name")})
			queued_ids.add(node_id)

	for root in root_nodes:
		if getattr(root, "id", None) in expanded_ids:
			continue
		data = method(root.id, company)
		result.append(dict(parent=root.id, parent_name=root.name, data=data))
		expanded_ids.add(root.id)
		queue_expandable_nodes(data)

	while nodes_to_expand:
		parent = nodes_to_expand.pop(0)
		queued_ids.discard(parent.get("id"))
		if parent.get("id") in expanded_ids:
			continue
		data = method(parent.get("id"), company)
		result.append(dict(parent=parent.get("id"), parent_name=parent.get("name"), data=data))
		expanded_ids.add(parent.get("id"))
		queue_expandable_nodes(data)

	return result
