import json
from collections import Counter, defaultdict
from html import escape
from zipfile import BadZipFile

import frappe
from frappe import _

from hrms.hr.employee_relationship_importer import (
	RELATIONSHIP_CATEGORIES,
	parse_employee_relationship_workbook,
	preview_token,
	source_pair_key,
	summarize_source_conflicts,
	text,
	workbook_digest,
)


DOCTYPENAME = "HRMS Employee Relationship"


def _employee_fields():
	return ["name", "employee_name", "custom_employee_code", "company", "department", "designation", "status"]


def _employee_snapshot(employee):
	return frappe.db.get_value("Employee", employee, _employee_fields(), as_dict=True)


def _require_relationship_permission(permission_type):
	frappe.has_permission(DOCTYPENAME, permission_type, throw=True)


def _relationship_value(value):
	value = str(value or "").strip()
	if value not in RELATIONSHIP_CATEGORIES:
		frappe.throw(_("请选择有效的员工关系大类：{0}").format("、".join(RELATIONSHIP_CATEGORIES)))
	return value


def _file(file_url):
	name = frappe.db.get_value("File", {"file_url": file_url}, "name")
	if not name:
		frappe.throw(_("未找到上传文件：{0}").format(file_url))
	doc = frappe.get_doc("File", name)
	doc.check_permission("read")
	content = doc.get_content()
	if isinstance(content, str):
		content = content.encode()
	return doc, content


def _company(company):
	company = str(company or "").strip()
	if not company or not frappe.db.exists("Company", company):
		frappe.throw(_("请选择有效公司。"))
	if not frappe.has_permission("Company", "read", company):
		frappe.throw(_("无权使用该公司的员工关系数据。"), frappe.PermissionError)
	return company


def _department_display(value):
	value = text(value)
	if not value:
		return ""
	department_name = frappe.db.get_value("Department", value, "department_name")
	return text(department_name or value).split(" - ", 1)[0].strip()


def _employee_directory(company):
	frappe.has_permission("Employee", "read", throw=True)
	if not frappe.get_meta("Employee").has_field("custom_employee_code"):
		frappe.throw(_("员工主档尚未配置公司工号字段，不能导入员工关系。"))
	rows = frappe.get_list(
		"Employee",
		filters={"company": company},
		fields=_employee_fields(),
		order_by="employee_name asc, custom_employee_code asc",
		limit_page_length=0,
	)
	for row in rows:
		row["employee_code"] = text(row.get("custom_employee_code"))
		row["department_display"] = _department_display(row.get("department"))
	return rows


def _source_identities(rows):
	identities = {}
	counts = Counter()
	for row in rows:
		for side in ("a", "b"):
			key = row[f"employee_{side}_identity"]
			counts[key] += 1
			identities.setdefault(
				key,
				{
					"identity_key": key,
					"employee_name": row[f"employee_{side}_name"],
					"source_department": row[f"employee_{side}_department"],
					"source_code": row[f"employee_{side}_code"],
				},
			)
	for key, item in identities.items():
		item["record_count"] = counts[key]
	return list(identities.values())


def _identity_preview(rows, employees):
	by_code = defaultdict(list)
	by_name = defaultdict(list)
	for employee in employees:
		by_code[employee.get("employee_code")].append(employee)
		by_name[text(employee.get("employee_name"))].append(employee)
	items = []
	for item in _source_identities(rows):
		name_matches = by_name.get(item["employee_name"], [])
		if item["source_code"]:
			matches = by_code.get(item["source_code"], [])
			proposed = matches[0] if len(matches) == 1 and text(matches[0].get("employee_name")) == item["employee_name"] else None
			status = "matched" if proposed else "code_mismatch"
		else:
			exact = [row for row in name_matches if row.get("department_display") == item["source_department"]]
			proposed = exact[0] if len(exact) == 1 and exact[0].get("employee_code") else None
			if proposed:
				status = "matched"
			elif len(exact) == 1:
				status = "missing_code"
			elif len(exact) > 1:
				status = "ambiguous"
			elif name_matches:
				status = "department_mismatch"
			else:
				status = "unmatched"
		items.append(
			{
				**item,
				"status": status,
				"employee_code": proposed.get("employee_code") if proposed else item["source_code"],
				"candidates": [
					{
						"employee_code": row.get("employee_code"),
						"employee_name": row.get("employee_name"),
						"department": row.get("department_display"),
						"status": row.get("status"),
					}
					for row in name_matches
				],
			}
		)
	return items


def _preview(file_url, company):
	file_doc, content = _file(file_url)
	try:
		parsed = parse_employee_relationship_workbook(content)
	except (ValueError, OSError, BadZipFile) as error:
		frappe.throw(_("人员关系表无法读取：{0}").format(escape(str(error))))
	digest = workbook_digest(content)
	identities = _identity_preview(parsed["rows"], _employee_directory(company))
	source_conflicts, source_duplicate_count = summarize_source_conflicts(parsed["rows"])
	row_errors = sum(bool(row["errors"]) for row in parsed["rows"])
	unresolved = sum(item["status"] != "matched" for item in identities)
	return {
		"company": company,
		"file": {"file_url": file_doc.file_url, "file_name": file_doc.file_name, "sha256": digest},
		"sheet_names": parsed["sheet_names"],
		"row_count": len(parsed["rows"]),
		"row_error_count": row_errors,
		"unresolved_identity_count": unresolved,
		"source_conflicts": source_conflicts,
		"source_duplicate_count": source_duplicate_count,
		"identities": identities,
		"sample_rows": parsed["rows"][:20],
		"error_rows": [row for row in parsed["rows"] if row["errors"]][:50],
		"plan_token": preview_token(company, digest, parsed["rows"]),
		"_rows": parsed["rows"],
	}


@frappe.whitelist()
def preview_employee_relationship_import(file_url: str, company: str):
	_require_relationship_permission("create")
	company = _company(company)
	preview = _preview(file_url, company)
	preview.pop("_rows", None)
	return preview


def _identity_selection(identity_map, preview):
	identity_map = _json_mapping(identity_map, _("员工工号映射"))
	employees = _employee_directory(preview["company"])
	by_code = defaultdict(list)
	for employee in employees:
		by_code[employee.get("employee_code")].append(employee)
	selected = {}
	errors = []
	for item in preview["identities"]:
		code = text(identity_map.get(item["identity_key"]) or item.get("employee_code"))
		if not code:
			errors.append(_("{0}（{1}）未指定公司工号").format(item["employee_name"], item["source_department"]))
			continue
		matches = by_code.get(code, [])
		if len(matches) != 1:
			errors.append(_("公司工号 {0} 在当前公司中未唯一匹配员工").format(code))
			continue
		employee = matches[0]
		if text(employee.get("employee_name")) != item["employee_name"]:
			errors.append(
				_("公司工号 {0} 对应姓名 {1}，与来源姓名 {2} 不一致").format(
					code, employee.get("employee_name"), item["employee_name"]
				)
			)
			continue
		selected[item["identity_key"]] = employee
	if errors:
		frappe.throw(_("员工身份映射未通过：<br>{0}").format("<br>".join(escape(item) for item in errors[:50])))
	return selected


def _canonical_pair(first, second):
	return tuple(sorted((first.name, second.name)))


def _existing_relationships():
	rows = frappe.get_list(
		DOCTYPENAME,
		fields=["name", "employee_a", "employee_b", "relationship"],
		limit_page_length=0,
	)
	return {tuple(sorted((row.employee_a, row.employee_b))): row for row in rows}


def _build_import_plan(rows, selected, existing, conflict_map=None):
	conflict_map = conflict_map or {}
	plan = []
	grouped = defaultdict(list)
	errors = []
	for row in rows:
		if row["errors"]:
			errors.extend(f"{row['source_sheet']} 第 {row['source_row']} 行：{error}" for error in row["errors"])
			continue
		resolved_relationship = text(conflict_map.get(source_pair_key(row)) or row["relationship"])
		if resolved_relationship not in RELATIONSHIP_CATEGORIES:
			errors.append(f"{row['source_sheet']} 第 {row['source_row']} 行：未选择有效的冲突处理关系大类")
			continue
		row = {**row, "relationship": resolved_relationship}
		first = selected[row["employee_a_identity"]]
		second = selected[row["employee_b_identity"]]
		if first.name == second.name:
			errors.append(f"{row['source_sheet']} 第 {row['source_row']} 行：双方工号指向同一员工")
			continue
		grouped[_canonical_pair(first, second)].append((row, first, second))
	for pair, items in grouped.items():
		categories = {item[0]["relationship"] for item in items}
		if len(categories) > 1:
			references = "、".join(f"{row['source_sheet']} 第 {row['source_row']} 行={row['relationship']}" for row, _, _ in items)
			errors.append(f"同一员工对存在多个关系大类：{references}")
			continue
		row, first, second = items[0]
		existing_row = existing.get(pair)
		if existing_row and existing_row.relationship != row["relationship"]:
			errors.append(
				f"{row['source_sheet']} 第 {row['source_row']} 行：系统已有关系“{existing_row.relationship}”，来源为“{row['relationship']}”"
			)
			continue
		plan.append(
			{
				"action": "skip_existing" if existing_row else "create",
				"row": row,
				"first": first,
				"second": second,
				"duplicate_source_count": max(0, len(items) - 1),
			}
		)
	return plan, errors


def _json_mapping(value, label):
	if isinstance(value, str):
		try:
			value = json.loads(value)
		except json.JSONDecodeError:
			frappe.throw(_("{0}格式不正确。").format(label))
	if value in (None, ""):
		return {}
	if not isinstance(value, dict):
		frappe.throw(_("{0}格式不正确。").format(label))
	return value


@frappe.whitelist()
def apply_employee_relationship_import(
	file_url: str, company: str, plan_token_value: str, identity_map=None, conflict_map=None
):
	_require_relationship_permission("create")
	company = _company(company)
	preview = _preview(file_url, company)
	if not plan_token_value or plan_token_value != preview["plan_token"]:
		frappe.throw(_("源文件或预览结果已变化，请重新校验后再导入。"))
	selected = _identity_selection(identity_map, preview)
	conflict_map = _json_mapping(conflict_map, _("关系冲突处理"))
	missing_conflicts = [item for item in preview["source_conflicts"] if conflict_map.get(item["pair_key"]) not in RELATIONSHIP_CATEGORIES]
	if missing_conflicts:
		frappe.throw(
			_("以下重复员工对尚未选择最终关系大类：{0}").format(
				"、".join(f"{item['employee_a_name']}—{item['employee_b_name']}" for item in missing_conflicts)
			)
		)
	for employee in selected.values():
		frappe.get_doc("Employee", employee.name).check_permission("read")
	plan, errors = _build_import_plan(preview["_rows"], selected, _existing_relationships(), conflict_map)
	if errors:
		frappe.throw(_("员工关系文件未通过导入校验：<br>{0}").format("<br>".join(escape(item) for item in errors[:50])))
	created = 0
	skipped_existing = 0
	skipped_source_duplicates = 0
	for item in plan:
		skipped_source_duplicates += item["duplicate_source_count"]
		if item["action"] == "skip_existing":
			skipped_existing += 1
			continue
		row = item["row"]
		_insert_relationship(
			item["first"],
			item["second"],
			row["relationship"],
			source={
				"source_file": file_url,
				"source_sheet": row["source_sheet"],
				"source_row": row["source_row"],
				"source_fingerprint": preview["file"]["sha256"],
			},
		)
		created += 1
	return {
		"created": created,
		"skipped_existing": skipped_existing,
		"skipped_source_duplicates": skipped_source_duplicates,
		"total_source_rows": len(preview["_rows"]),
	}


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


def _insert_relationship(first, second, relationship, source=None):
	relationship = _relationship_value(relationship)
	if _business_sort_key(first) > _business_sort_key(second):
		first, second = second, first
	doc = frappe.new_doc(DOCTYPENAME)
	doc.set("employee_a", first.name)
	doc.set("employee_a_name", first.employee_name)
	doc.set("employee_a_code", first.custom_employee_code or "")
	doc.set("employee_b", second.name)
	doc.set("employee_b_name", second.employee_name)
	doc.set("employee_b_code", second.custom_employee_code or "")
	doc.set("relationship", relationship)
	doc.set("company", first.company or second.company)
	for fieldname, value in (source or {}).items():
		if doc.meta.has_field(fieldname):
			doc.set(fieldname, value)
	doc.insert(ignore_mandatory=True)
	return doc


@frappe.whitelist()
def create_employee_relationship(employee_a: str, employee_b: str, relationship: str):
	_require_relationship_permission("create")
	relationship = _relationship_value(relationship)
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
	doc = _insert_relationship(first, second, relationship)
	return {"name": doc.name, "item": _record_payload(doc)}
