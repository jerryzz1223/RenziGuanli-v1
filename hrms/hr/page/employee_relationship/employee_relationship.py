import json

import frappe
from frappe import _


DOCTYPENAME = "HRMS Employee Relationship"


def _employee_fields():
	return ["name", "employee_name", "custom_employee_code", "company", "department", "designation", "status"]


def _employee_snapshot(employee):
	return frappe.db.get_value("Employee", employee, _employee_fields(), as_dict=True)


def _require_relationship_permission(permission_type):
	frappe.has_permission(DOCTYPENAME, permission_type, throw=True)


@frappe.whitelist()
def search_employee_relationship_candidates(query: str = "", limit: int = 20):
	"""Search readable employees by name, company code, or Employee name."""
	frappe.has_permission("Employee", "read", throw=True)
	query = str(query or "").strip()
	if not query:
		return []
	try:
		limit = max(1, min(int(limit), 50))
	except (TypeError, ValueError):
		limit = 20
	meta = frappe.get_meta("Employee")
	code_field = "custom_employee_code" if meta.has_field("custom_employee_code") else "name"
	rows = frappe.get_list(
		"Employee",
		fields=_employee_fields(),
		or_filters=[
			{"employee_name": ["like", f"%{query}%"]},
			{code_field: ["like", f"%{query}%"]},
			{"name": ["like", f"%{query}%"]},
		],
		order_by="employee_name asc, custom_employee_code asc",
		limit_page_length=limit,
	)
	return rows


def _record_payload(row):
	submitted_by = row.get("submitted_by") or row.get("owner") or ""
	submitted_on = row.get("submitted_on") or row.get("creation") or ""
	return {
		"name": row.get("name"),
		"employee_a": row.get("employee_a"),
		"employee_a_name": row.get("employee_a_name"),
		"employee_a_code": row.get("employee_a_code"),
		"employee_b": row.get("employee_b"),
		"employee_b_name": row.get("employee_b_name"),
		"employee_b_code": row.get("employee_b_code"),
		"relationship": row.get("relationship"),
		"company": row.get("company"),
		"status": row.get("status") or "已提交",
		"submitted_by": submitted_by,
		"submitted_by_name": frappe.db.get_value("User", submitted_by, "full_name") if submitted_by else "",
		"submitted_on": submitted_on,
		"modified": row.get("modified"),
	}


def _matches_search(row, search):
	if not search:
		return True
	needle = search.casefold()
	return any(
		needle in str(row.get(fieldname) or "").casefold()
		for fieldname in (
			"employee_a_name", "employee_a_code", "employee_b_name", "employee_b_code", "relationship", "company",
			"status", "submitted_by_name", "submitted_on",
		)
	)


def _relationship_filters(value):
	if not value:
		return {}
	try:
		parsed = json.loads(value) if isinstance(value, str) else value
	except (TypeError, ValueError, json.JSONDecodeError):
		frappe.throw(_("员工关系索引格式不正确。"))
	if not isinstance(parsed, dict):
		frappe.throw(_("员工关系索引格式不正确。"))
	allowed = {
		"employee_a", "relationship", "employee_b", "company", "status", "submitted_by_name", "submitted_on"
	}
	return {
		key: str(query or "").strip()
		for key, query in parsed.items()
		if key in allowed and str(query or "").strip()
	}


def _matches_relationship_filters(row, filters):
	for fieldname, query in filters.items():
		if fieldname == "employee_a":
			value = " ".join(str(row.get(key) or "") for key in ("employee_a", "employee_a_name", "employee_a_code"))
		elif fieldname == "employee_b":
			value = " ".join(str(row.get(key) or "") for key in ("employee_b", "employee_b_name", "employee_b_code"))
		else:
			value = row.get(fieldname) or ""
		if query.casefold() not in str(value).casefold():
			return False
	return True


def _relationship_sort_key(row, fieldname):
	if fieldname == "employee_a":
		return f"{row.get('employee_a_name') or ''} {row.get('employee_a_code') or ''}"
	if fieldname == "employee_b":
		return f"{row.get('employee_b_name') or ''} {row.get('employee_b_code') or ''}"
	return row.get(fieldname) or ""


@frappe.whitelist()
def get_employee_relationship_statistics():
	"""Return counts and employee pairs grouped by the manually entered relationship value."""
	_require_relationship_permission("read")
	rows = frappe.get_list(
		DOCTYPENAME,
		fields=[
			"name", "employee_a", "employee_a_name", "employee_a_code",
			"employee_b", "employee_b_name", "employee_b_code", "relationship",
		],
		limit_page_length=0,
	)
	groups = {}
	for row in rows:
		label = " ".join(str(row.get("relationship") or "").split())
		if not label:
			continue
		key = label.casefold()
		if key not in groups:
			groups[key] = {"key": key, "label": label, "count": 0, "pairs": []}
		groups[key]["count"] += 1
		groups[key]["pairs"].append({
			"name": row.get("name"),
			"employee_a": row.get("employee_a"),
			"employee_a_name": row.get("employee_a_name"),
			"employee_a_code": row.get("employee_a_code"),
			"employee_b": row.get("employee_b"),
			"employee_b_name": row.get("employee_b_name"),
			"employee_b_code": row.get("employee_b_code"),
		})
	total = sum(group["count"] for group in groups.values())
	items = sorted(groups.values(), key=lambda group: (-group["count"], group["label"].casefold()))
	for item in items:
		item["percentage"] = round(item["count"] / total * 100, 1) if total else 0
	return {"total": total, "items": items}


@frappe.whitelist()
def get_employee_relationships(
	search: str = "", employee: str = "", limit: int = 100, filters: str = "", sort_field: str = "submitted_on", sort_order: str = "desc"
):
	_require_relationship_permission("read")
	try:
		limit = max(1, min(int(limit), 500))
	except (TypeError, ValueError):
		limit = 100
	search = str(search or "").strip()
	employee = str(employee or "").strip()
	filters = _relationship_filters(filters)
	sort_fields = {"employee_a", "relationship", "employee_b", "company", "status", "submitted_by_name", "submitted_on"}
	sort_field = sort_field if sort_field in sort_fields else "submitted_on"
	sort_order = "asc" if str(sort_order).lower() == "asc" else "desc"
	base_fields = [
		"name", "employee_a", "employee_a_name", "employee_a_code", "employee_b", "employee_b_name",
		"employee_b_code", "relationship", "company", "owner", "creation", "modified",
	]
	meta = frappe.get_meta(DOCTYPENAME)
	permitted_fields = set(frappe.model.get_permitted_fields(DOCTYPENAME, user=frappe.session.user))
	audit_fields = [
		fieldname
		for fieldname in ("status", "submitted_by", "submitted_on")
		if meta.has_field(fieldname) and fieldname in permitted_fields
	]
	try:
		rows = frappe.get_list(
			DOCTYPENAME,
			fields=base_fields + audit_fields,
			# submitted_on is a read-only audit field and may not be usable for
			# ordering under a restricted role. modified is available to all readers.
			order_by="modified desc",
			limit_page_length=500,
		)
	except frappe.PermissionError:
		# A customised site may report an optional audit field as permitted while
		# still rejecting it at query time. Fall back to standard readable fields.
		rows = frappe.get_list(
			DOCTYPENAME,
			fields=base_fields,
			order_by="modified desc",
			limit_page_length=500,
		)
	records = [_record_payload(row) for row in rows]
	records = [
		row for row in records
		if (not employee or employee in (row.get("employee_a"), row.get("employee_b")))
		and _matches_search(row, search)
		and _matches_relationship_filters(row, filters)
	]
	records.sort(
		key=lambda row: str(_relationship_sort_key(row, sort_field) or "").casefold(),
		reverse=sort_order == "desc",
	)
	records = [row for row in records if str(_relationship_sort_key(row, sort_field) or "").strip()] + [
		row for row in records if not str(_relationship_sort_key(row, sort_field) or "").strip()
	]
	return {
		"items": records[:limit],
		"count": len(records),
		"has_more": len(records) > limit,
		"sort_field": sort_field,
		"sort_order": sort_order,
	}


def _existing_pair(first, second, exclude_name=""):
	filters = {"employee_a": first, "employee_b": second}
	if exclude_name:
		filters["name"] = ["!=", exclude_name]
	if frappe.get_all(DOCTYPENAME, filters=filters, pluck="name", limit_page_length=1):
		return True
	filters = {"employee_a": second, "employee_b": first}
	if exclude_name:
		filters["name"] = ["!=", exclude_name]
	return bool(frappe.get_all(DOCTYPENAME, filters=filters, pluck="name", limit_page_length=1))


def _business_sort_key(employee):
	return (
		str(employee.get("custom_employee_code") or "").casefold(),
		str(employee.get("employee_name") or "").casefold(),
		str(employee.name),
	)


@frappe.whitelist()
def create_employee_relationship(employee_a: str, employee_b: str, relationship: str):
	_require_relationship_permission("create")
	relationship = str(relationship or "").strip()
	if not relationship:
		frappe.throw(_("请输入员工关系。"))
	if len(relationship) > 140:
		frappe.throw(_("员工关系不能超过 140 个字符。"))
	first = _employee_snapshot(str(employee_a or "").strip())
	second = _employee_snapshot(str(employee_b or "").strip())
	if not first or not second:
		frappe.throw(_("请先通过姓名或公司工号选择两名有效员工。"))
	frappe.get_doc("Employee", first.name).check_permission("read")
	frappe.get_doc("Employee", second.name).check_permission("read")
	if first.name == second.name:
		frappe.throw(_("员工关系不能选择同一名员工。"))
	# Store the pair in a stable order, so the same two employees cannot be added twice.
	if _business_sort_key(first) > _business_sort_key(second):
		first, second = second, first
	if _existing_pair(first.name, second.name):
		frappe.throw(_("这两名员工已经建立关系，请直接在员工关系列表中查看。"))
	# The employee identity fields are read-only on the DocType and are generated
	# by this endpoint. Set the complete snapshot before insert so Frappe does not
	# treat those server-managed mandatory fields as empty.
	doc = frappe.new_doc(DOCTYPENAME)
	doc.set("employee_a", first.name)
	doc.set("employee_a_name", first.employee_name)
	doc.set("employee_a_code", first.custom_employee_code or "")
	doc.set("employee_b", second.name)
	doc.set("employee_b_name", second.employee_name)
	doc.set("employee_b_code", second.custom_employee_code or "")
	doc.set("relationship", relationship)
	doc.set("company", first.company or second.company)
	doc.insert(ignore_mandatory=True)
	return {"name": doc.name, "item": _record_payload(doc)}
