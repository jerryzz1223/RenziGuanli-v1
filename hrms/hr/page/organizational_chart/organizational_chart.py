import json
from collections import defaultdict
from pathlib import Path

import frappe
from frappe import _
from frappe.query_builder.functions import Count
from frappe.utils import cint, cstr


HYBRID_MANAGER_KEYWORDS = ("课长", "组长", "主管", "总监", "副总", "经理", "班长", "代理")
YONGXIN_Q2_ORG_TEMPLATE = Path(__file__).with_name("yongxin_q2_org_structure.json")
YONGXIN_COMPANY_NAME = "永新"

HYBRID_ROSTER_FIELD_MAP = {
	"工号": "custom_employee_code",
	"员工编号": "custom_employee_code",
	"姓名": "employee_name",
	"公司": "company",
	"分支机构": "branch",
	"分公司": "branch",
	"部门": "department",
	"现职务": "designation",
	"职位": "designation",
	"职务": "designation",
	"岗位": "designation",
	"职级": "grade",
	"员工等级": "grade",
	"上级主管": "reports_to",
	"直接上级": "reports_to",
	"汇报对象": "reports_to",
	"在职状态": "status",
	"员工状态": "status",
	"联系电话": "cell_number",
}

DEPARTMENT_QUICK_EDIT_FIELDS = {
	"department_name",
	"company",
	"parent_department",
	"is_group",
	"disabled",
	"leave_block_list",
	"payroll_cost_center",
	"hrms_org_level",
	"hrms_org_role",
	"hrms_org_manager",
	"hrms_org_proxy",
	"hrms_planned_headcount",
	"hrms_actual_headcount",
	"hrms_vacancy_count",
	"hrms_recruitment_plan",
}


def _normalize_yongxin_company(company: str | None = None):
	if company and company != "All Companies":
		return company
	if frappe.db.exists("Company", YONGXIN_COMPANY_NAME):
		return YONGXIN_COMPANY_NAME
	return frappe.defaults.get_user_default("Company") or frappe.db.get_value("Company", {}, "name")


@frappe.whitelist()
def get_children(parent: str | None = None, company: str | None = None, exclude_node: str | None = None):
	filters = [["status", "=", "Active"]]
	if company and company != "All Companies":
		filters.append(["company", "=", company])

	if parent and company and parent != company:
		filters.append(["reports_to", "=", parent])
	else:
		filters.append(["reports_to", "=", ""])

	if exclude_node:
		filters.append(["name", "!=", exclude_node])

	employees = frappe.get_all(
		"Employee",
		fields=[
			"employee_name as name",
			"name as id",
			"lft",
			"rgt",
			"reports_to",
			"image",
			"designation as title",
		],
		filters=filters,
		order_by="name",
	)

	for employee in employees:
		employee.connections = get_connections(employee.id, employee.lft, employee.rgt)
		employee.expandable = bool(employee.connections)

	return employees


def get_connections(employee: str, lft: int, rgt: int) -> int:
	Employee = frappe.qb.DocType("Employee")
	query = (
		frappe.qb.from_(Employee)
		.select(Count(Employee.name))
		.where((Employee.lft > lft) & (Employee.rgt < rgt) & (Employee.status == "Active"))
	).run()

	return query[0][0]


@frappe.whitelist()
def get_employee_roster_field_map():
	return HYBRID_ROSTER_FIELD_MAP


@frappe.whitelist()
def get_yongxin_q2_org_template_preview():
	seed = _load_yongxin_q2_org_template()
	return {
		"title": seed.get("title"),
		"source_document": seed.get("source_document"),
		"source_sheet": seed.get("source_sheet"),
		"department_count": _count_seed_nodes(seed.get("department_tree") or []),
		"chart_node_count": _count_seed_nodes([seed.get("chart_tree")]) if seed.get("chart_tree") else 0,
		"position_count": len(seed.get("position_templates") or []),
		"staffing_summary_count": len(seed.get("staffing_summary") or []),
	}


@frappe.whitelist()
def import_yongxin_q2_org_structure(company: str | None = None, dry_run: int | str = 0):
	"""Seed Department parent hierarchy and Designation reporting logic from 1.2组织架构.xlsx."""

	if not frappe.has_permission("Department", "create") and not frappe.has_permission("Department", "write"):
		frappe.throw(_("没有权限导入组织架构。"))
	company = _normalize_yongxin_company(company)
	if not company:
		frappe.throw(_("请先创建或选择公司。"))
	if not frappe.db.exists("Company", company):
		frappe.throw(_("公司 {0} 不存在。").format(company))

	seed = _load_yongxin_q2_org_template()
	preview = get_yongxin_q2_org_template_preview()
	if cint(dry_run):
		preview.update({"company": company, "dry_run": True})
		return preview

	result = {
		"company": company,
		"title": seed.get("title"),
		"created_departments": [],
		"updated_departments": [],
		"created_designations": [],
		"updated_designations": [],
	}
	source_to_department = {}
	seen_department_labels = defaultdict(int)

	for node in seed.get("department_tree") or []:
		_import_department_node(
			node=node,
			company=company,
			parent_department=None,
			result=result,
			source_to_department=source_to_department,
			seen_department_labels=seen_department_labels,
		)

	_apply_staffing_summary(seed.get("staffing_summary") or [], company, result)
	_import_position_templates(seed.get("position_templates") or [], company, source_to_department, result)
	frappe.db.commit()
	return result


@frappe.whitelist()
def get_hybrid_tree(company: str | None = None):
	company = _normalize_yongxin_company(company)
	if _company_has_imported_org_template(company):
		return _get_yongxin_template_tree(company)

	departments = _get_departments(company)
	employees = _get_active_employees(company)
	staffing = _get_department_staffing(company)

	employees_by_department = defaultdict(list)
	missing_department_count = 0
	for employee in employees:
		department = employee.get("department")
		if department:
			employees_by_department[department].append(employee)
		else:
			missing_department_count += 1

	department_children = defaultdict(list)
	root_departments = []
	department_by_name = {department.name: department for department in departments}
	for department in departments:
		parent = department.get("parent_department")
		if parent and parent in department_by_name:
			department_children[parent].append(department)
		else:
			root_departments.append(department)

	missing_manager_count = sum(
		1
		for department in departments
		if not _get_department_managers(employees_by_department.get(department.name, []))
		and not department.get("hrms_org_manager")
	)
	staffing_summary = _summarize_staffing(root_departments, staffing)
	reported_current_headcount = staffing_summary["current_headcount"]
	current_headcount = len(employees) or reported_current_headcount

	root_node = {
		"node_id": f"company:{company or 'all'}",
		"id": f"company:{company or 'all'}",
		"node_type": "company",
		"name": _get_company_label(company),
		"title": "公司",
		"planned_headcount": staffing_summary["planned_headcount"],
		"current_headcount": current_headcount,
		"vacancy_count": staffing_summary["vacancy_count"],
		"missing_department_count": missing_department_count,
		"missing_manager_count": missing_manager_count,
		"children": [
			_build_department_node(department, employees_by_department, department_children, staffing)
			for department in root_departments
		],
	}
	root_node["connections"] = len(root_node["children"])
	root_node["expandable"] = bool(root_node["children"])

	return {
		"root": root_node,
		"summary": {
			"planned_headcount": root_node["planned_headcount"],
			"current_headcount": root_node["current_headcount"],
			"vacancy_count": root_node["vacancy_count"],
			"department_count": len(departments),
			"missing_department_count": missing_department_count,
			"missing_manager_count": missing_manager_count,
		},
		"field_map": HYBRID_ROSTER_FIELD_MAP,
	}


@frappe.whitelist()
def get_hybrid_node_detail(
	node_id: str | None = None,
	node_type: str | None = None,
	company: str | None = None,
	search: str | None = None,
):
	company = _normalize_yongxin_company(company)
	node_id = node_id or ""
	node_type = node_type or _node_type_from_id(node_id)
	search = (search or "").strip()

	if not node_id.startswith("department:"):
		template_detail = _get_template_node_detail(node_id, node_type, company, search)
		if template_detail:
			return template_detail

	if node_type == "company":
		employees = _get_node_employees(company=company, search=search)
		return {
			"node_type": "company",
			"node_id": node_id,
			"title": _get_company_label(company),
			"subtitle": "公司组织总览",
			"metrics": _company_metrics(company),
			"employees": employees[:100],
			"actions": {"can_add_department": frappe.has_permission("Department", "create")},
		}

	department = _node_value(node_id)
	if node_type in {"department", "employee_group"}:
		department_doc = frappe._dict()
		if department and frappe.db.exists("Department", department):
			department_doc = frappe.get_cached_doc("Department", department)
		employees = _get_node_employees(department=department, company=company, search=search)
		staffing = _get_department_staffing(company).get(department, {})
		current_headcount = len(employees) or staffing.get("current_headcount", 0)
		return {
			"node_type": node_type,
			"node_id": node_id,
			"department": department,
			"title": getattr(department_doc, "department_name", None) or department or "未分配部门",
			"subtitle": _department_subtitle(department_doc),
			"metrics": {
				"planned_headcount": staffing.get("planned_headcount", 0),
				"current_headcount": current_headcount,
				"vacancy_count": staffing.get("vacancy_count", max((staffing.get("planned_headcount", 0) or 0) - current_headcount, 0)),
				"employee_count": current_headcount,
			},
			"employees": employees[:100],
			"actions": {
				"can_add_department": frappe.has_permission("Department", "create"),
				"can_edit_department": bool(department) and frappe.has_permission("Department", "write", department),
				"can_delete_department": bool(department) and frappe.has_permission("Department", "delete", department),
			},
		}

	employee = _node_value(node_id)
	if node_type == "manager" and employee and frappe.db.exists("Employee", employee):
		doc = frappe.get_cached_doc("Employee", employee)
		reports = _get_node_employees(manager=employee, company=company, search=search)
		return {
			"node_type": "manager",
			"node_id": node_id,
			"employee": employee,
			"title": doc.employee_name or employee,
			"subtitle": doc.designation or "管理人员",
			"metrics": {
				"direct_report_count": len(reports),
				"employee_count": len(reports) + 1,
				"planned_headcount": 0,
				"current_headcount": len(reports) + 1,
				"vacancy_count": 0,
			},
			"employees": [_employee_row(doc)] + reports[:99],
			"actions": {"can_open_employee": frappe.has_permission("Employee", "read", employee)},
		}

	return {
		"node_type": node_type,
		"node_id": node_id,
		"title": "未找到节点",
		"subtitle": "请刷新组织架构图",
		"metrics": {},
		"employees": [],
		"actions": {},
	}


@frappe.whitelist()
def update_department_fields(department: str, values: str | dict):
	if not department or not frappe.db.exists("Department", department):
		frappe.throw(_("部门不存在。"))

	doc = frappe.get_doc("Department", department)
	doc.check_permission("write")
	values = frappe.parse_json(values) if isinstance(values, str) else (values or {})
	meta = frappe.get_meta("Department")
	updated = {}

	for fieldname, value in values.items():
		if fieldname not in DEPARTMENT_QUICK_EDIT_FIELDS or not meta.has_field(fieldname):
			continue
		if fieldname == "parent_department" and value == doc.name:
			frappe.throw(_("上级部门不能选择当前部门。"))
		doc.set(fieldname, value)
		updated[fieldname] = value

	if updated:
		doc.save(ignore_permissions=False)

	return {
		"name": doc.name,
		"department_name": doc.get("department_name"),
		"updated": updated,
	}


@frappe.whitelist()
def delete_departments(departments: str | list):
	departments = frappe.parse_json(departments) if isinstance(departments, str) else (departments or [])
	departments = [department for department in departments if department]
	result = {"deleted": [], "failed": []}

	for department in departments:
		try:
			_validate_department_delete(department)
			frappe.delete_doc("Department", department, ignore_permissions=False)
			result["deleted"].append(department)
		except Exception as exc:
			result["failed"].append({"name": department, "message": frappe.utils.cstr(exc)})

	result["deleted_count"] = len(result["deleted"])
	result["failed_count"] = len(result["failed"])
	return result


def _load_yongxin_q2_org_template():
	if not YONGXIN_Q2_ORG_TEMPLATE.exists():
		frappe.throw(_("未找到组织架构模板文件。"))
	return json.loads(YONGXIN_Q2_ORG_TEMPLATE.read_text(encoding="utf-8"))


def _count_seed_nodes(nodes):
	return sum(1 + _count_seed_nodes(node.get("children") or []) for node in nodes if node)


def _company_has_imported_org_template(company=None):
	if not company or not frappe.get_meta("Department").has_field("hrms_org_source_cell"):
		return False
	return bool(
		frappe.db.exists(
			"Department",
			{
				"company": company,
				"hrms_org_source_cell": ["in", _template_department_source_cells()],
			},
		)
	)


def _template_department_source_cells():
	seed = _load_yongxin_q2_org_template()
	cells = []

	def collect(node):
		if not node:
			return
		if node.get("node_type") in {"division", "department", "team"} and node.get("source_cell"):
			cells.append(node.get("source_cell"))
		for child in node.get("children") or []:
			collect(child)

	collect(seed.get("chart_tree"))
	return cells


def _get_yongxin_template_tree(company=None):
	seed = _load_yongxin_q2_org_template()
	departments = _get_departments(company)
	departments_by_source = {
		department.get("hrms_org_source_cell"): department
		for department in departments
		if department.get("hrms_org_source_cell")
	}
	employees = _get_active_employees(company)
	employees_by_department = defaultdict(list)
	for employee in employees:
		if employee.get("department"):
			employees_by_department[employee.get("department")].append(employee)

	root = _build_template_tree_node(seed.get("chart_tree"), departments_by_source, employees_by_department)
	summary = {
		"planned_headcount": root.get("planned_headcount", 0),
		"current_headcount": root.get("current_headcount", 0),
		"vacancy_count": root.get("vacancy_count", 0),
		"department_count": _count_template_nodes_by_type(root, {"division", "department", "team"}),
		"missing_department_count": 0,
		"missing_manager_count": _count_template_missing_managers(root),
	}
	return {
		"root": root,
		"summary": summary,
		"field_map": HYBRID_ROSTER_FIELD_MAP,
		"source_document": seed.get("source_document"),
		"source_sheet": seed.get("source_sheet"),
	}


def _build_template_tree_node(node, departments_by_source, employees_by_department):
	node = frappe._dict(node or {})
	source_cell = node.get("source_cell")
	department = departments_by_source.get(source_cell)
	children = [
		_build_template_tree_node(child, departments_by_source, employees_by_department)
		for child in node.get("children") or []
	]
	result = {
		"node_id": node.get("node_id") or f"{node.get('node_type')}:{source_cell}",
		"id": node.get("id") or f"{node.get('node_type')}:{source_cell}",
		"node_type": node.get("node_type") or "template",
		"template_node_type": node.get("node_type"),
		"name": node.get("name"),
		"title": node.get("title") or _template_manager_label(node),
		"role": node.get("role"),
		"manager_names": "、".join(node.get("manager_names") or []),
		"proxy_names": "、".join(node.get("proxy_names") or []),
		"lines": node.get("lines") or [],
		"employee_names": node.get("employee_names") or [],
		"source_cell": source_cell,
		"planned_headcount": node.get("planned_headcount") or 0,
		"current_headcount": node.get("current_headcount") or 0,
		"vacancy_count": node.get("vacancy_count") or 0,
		"children": children,
	}

	if department:
		result.update(
			{
				"node_id": f"department:{department.name}",
				"id": f"department:{department.name}",
				"node_type": "department",
				"template_node_type": node.get("node_type"),
				"name": department.get("department_name") or node.get("name"),
				"title": _department_manager_label(department) or node.get("title") or _template_manager_label(node),
				"department": department.name,
				"role": department.get("hrms_org_role") or node.get("role"),
				"manager_names": department.get("hrms_org_manager") or "、".join(node.get("manager_names") or []),
				"proxy_names": department.get("hrms_org_proxy") or "、".join(node.get("proxy_names") or []),
				"planned_headcount": cint(department.get("hrms_planned_headcount")) or node.get("planned_headcount") or 0,
				"current_headcount": cint(department.get("hrms_actual_headcount")) or node.get("current_headcount") or 0,
				"vacancy_count": cint(department.get("hrms_vacancy_count")) or node.get("vacancy_count") or 0,
				"recruitment_plan": department.get("hrms_recruitment_plan"),
			}
		)

	result["connections"] = len(children)
	result["expandable"] = bool(children)
	return result


def _template_manager_label(node):
	role = node.get("role") or ""
	manager = "、".join(node.get("manager_names") or [])
	return "：".join(part for part in [role, manager] if part)


def _count_template_nodes_by_type(node, node_types):
	return (1 if node.get("template_node_type") in node_types else 0) + sum(
		_count_template_nodes_by_type(child, node_types) for child in node.get("children") or []
	)


def _count_template_missing_managers(node):
	missing = 0
	if node.get("template_node_type") in {"division", "department", "team"} and not node.get("manager_names"):
		missing = 1
	return missing + sum(_count_template_missing_managers(child) for child in node.get("children") or [])


def _get_template_node_detail(node_id, node_type, company=None, search=None):
	if not _company_has_imported_org_template(company):
		return None
	seed = _load_yongxin_q2_org_template()
	node = _find_template_node(seed.get("chart_tree"), node_id, node_type)
	if not node:
		return None
	employee_names = _template_employee_names(node)
	employees = _get_employees_by_names(employee_names, company=company, search=search)
	return {
		"node_type": node.get("node_type"),
		"node_id": node_id,
		"title": node.get("name"),
		"subtitle": " · ".join(
			part
			for part in [
				node.get("source_cell") and _("来源单元格：{0}").format(node.get("source_cell")),
				_template_manager_label(node),
				node.get("proxy_names") and _("代理人：{0}").format("、".join(node.get("proxy_names") or [])),
			]
			if part
		),
		"metrics": {
			"planned_headcount": node.get("planned_headcount") or 0,
			"current_headcount": node.get("current_headcount") or len(employee_names),
			"vacancy_count": node.get("vacancy_count") or 0,
			"employee_count": len(employee_names),
		},
		"employees": employees,
		"template_lines": node.get("lines") or node.get("employee_names") or [],
		"actions": {"can_add_department": frappe.has_permission("Department", "create")},
	}


def _find_template_node(node, node_id, node_type=None):
	if not node:
		return None
	if node.get("node_id") == node_id or node.get("id") == node_id:
		return node
	if ":" in node_id and node.get("source_cell") == node_id.split(":", 1)[1]:
		return node
	for child in node.get("children") or []:
		found = _find_template_node(child, node_id, node_type)
		if found:
			return found
	return None


def _template_employee_names(node):
	names = []
	for value in (node.get("employee_names") or []):
		value = cstr(value).strip()
		if value:
			names.append(value)
	for child in node.get("children") or []:
		names.extend(_template_employee_names(child))
	return names


def _get_employees_by_names(names, company=None, search=None):
	clean_names = [name for name in names if name and not name.startswith("TBA")]
	if search:
		clean_names = [name for name in clean_names if search in name]
	if not clean_names:
		return []
	filters = {"employee_name": ["in", clean_names]}
	if company:
		filters["company"] = company
	fields = _get_meta_fields(
		"Employee",
		[
			"name",
			"employee_name",
			"custom_employee_code",
			"employee_number",
			"department",
			"designation",
			"grade",
			"reports_to",
			"branch",
			"cell_number",
			"image",
		],
	)
	rows = frappe.get_all("Employee", fields=fields, filters=filters, limit_page_length=500)
	by_name = {row.employee_name: row for row in rows}
	return [
		_employee_row(by_name[name])
		if name in by_name
		else {
			"name": name,
			"employee_name": name,
			"employee_code": "",
			"department": "",
			"designation": "组织图人员",
			"grade": "",
			"reports_to": "",
			"branch": "",
			"cell_number": "",
			"image": "",
		}
		for name in clean_names
	]


def _import_department_node(
	node,
	company,
	parent_department,
	result,
	source_to_department,
	seen_department_labels,
):
	department = _upsert_department_from_node(node, company, parent_department, result, seen_department_labels)
	source_to_department[node.get("source_cell")] = department
	for child in node.get("children") or []:
		_import_department_node(
			node=child,
			company=company,
			parent_department=department,
			result=result,
			source_to_department=source_to_department,
			seen_department_labels=seen_department_labels,
		)


def _upsert_department_from_node(node, company, parent_department, result, seen_department_labels):
	source_cell = node.get("source_cell")
	department = _find_department_by_source(company, source_cell)
	department_name = _department_display_name(node, parent_department, seen_department_labels)
	created = False

	if department:
		doc = frappe.get_doc("Department", department)
	else:
		department = frappe.db.get_value("Department", {"department_name": department_name, "company": company}, "name")
		if department and _would_create_department_loop(department, parent_department):
			department_name = _source_scoped_department_name(department_name, node)
			department = frappe.db.get_value("Department", {"department_name": department_name, "company": company}, "name")
		if department:
			doc = frappe.get_doc("Department", department)
		else:
			doc = frappe.new_doc("Department")
			created = True

	doc.department_name = department_name
	doc.company = company
	if frappe.get_meta("Department").has_field("parent_department"):
		doc.parent_department = parent_department
	if frappe.get_meta("Department").has_field("is_group"):
		doc.is_group = 1 if node.get("children") else 0
	_set_if_exists(doc, "hrms_org_level", node.get("level"))
	_set_if_exists(doc, "hrms_org_role", node.get("role"))
	_set_if_exists(doc, "hrms_org_manager", "、".join(node.get("manager_names") or []))
	_set_if_exists(doc, "hrms_org_proxy", "、".join(node.get("proxy_names") or []))
	_set_if_exists(doc, "hrms_planned_headcount", cint(node.get("planned_headcount")))
	_set_if_exists(doc, "hrms_actual_headcount", cint(node.get("actual_headcount")))
	_set_if_exists(doc, "hrms_vacancy_count", cint(node.get("vacancy_count")))
	_set_if_exists(doc, "hrms_org_source_cell", source_cell)
	doc.save(ignore_permissions=False)

	result["created_departments" if created else "updated_departments"].append(doc.name)
	return doc.name


def _source_scoped_department_name(department_name, node):
	source_cell = cstr(node.get("source_cell")).strip()
	manager = "、".join(name for name in (node.get("manager_names") or []) if name and not name.startswith("TBA"))
	suffix = manager or source_cell
	return f"{department_name}（{suffix}）" if suffix else department_name


def _would_create_department_loop(department, parent_department):
	if not department or not parent_department or department == parent_department:
		return bool(department and parent_department and department == parent_department)
	bounds = frappe.db.get_value("Department", department, ["lft", "rgt"], as_dict=True)
	parent_bounds = frappe.db.get_value("Department", parent_department, ["lft", "rgt"], as_dict=True)
	if not bounds or not parent_bounds:
		return False
	return parent_bounds.lft > bounds.lft and parent_bounds.rgt < bounds.rgt


def _department_display_name(node, parent_department, seen_department_labels):
	label = cstr(node.get("label")).strip()
	source_cell = cstr(node.get("source_cell")).strip()
	key = (parent_department or "", label)
	seen_department_labels[key] += 1
	if seen_department_labels[key] <= 1:
		return label

	manager = "、".join(name for name in (node.get("manager_names") or []) if name and not name.startswith("TBA"))
	if manager:
		return f"{label}（{manager}）"
	return f"{label}（{source_cell}）" if source_cell else f"{label}-{seen_department_labels[key]}"


def _find_department_by_source(company, source_cell):
	if not source_cell or not frappe.get_meta("Department").has_field("hrms_org_source_cell"):
		return None
	return frappe.db.get_value(
		"Department",
		{"company": company, "hrms_org_source_cell": source_cell},
		"name",
	)


def _apply_staffing_summary(rows, company, result):
	meta = frappe.get_meta("Department")
	if not meta.has_field("hrms_recruitment_plan"):
		return
	for row in rows:
		department_name = cstr(row.get("department")).strip()
		if not department_name:
			continue
		departments = frappe.get_all(
			"Department",
			filters={"company": company, "department_name": ["like", f"{department_name}%"]},
			fields=["name"],
			limit_page_length=20,
		)
		for department in departments:
			doc = frappe.get_doc("Department", department.name)
			_set_if_exists(doc, "hrms_planned_headcount", cint(row.get("planned_headcount")))
			_set_if_exists(doc, "hrms_actual_headcount", cint(row.get("actual_headcount")))
			_set_if_exists(doc, "hrms_vacancy_count", cint(row.get("vacancy_count")))
			_set_if_exists(doc, "hrms_recruitment_plan", row.get("recruitment_plan"))
			doc.save(ignore_permissions=False)
			if department.name not in result["updated_departments"]:
				result["updated_departments"].append(department.name)


def _import_position_templates(rows, company, source_to_department, result):
	for row in rows:
		department = _find_department_by_label(company, row.get("department"))
		parent_designation = _ensure_designation(row.get("parent_designation"), company, department, None, result)
		_ensure_designation(
			row.get("designation"),
			company,
			department,
			parent_designation,
			result,
			source_cell=row.get("source_cell"),
		)


def _find_department_by_label(company, label):
	label = cstr(label).strip()
	if not label:
		return None
	return frappe.db.get_value("Department", {"company": company, "department_name": label}, "name") or frappe.db.get_value(
		"Department",
		{"company": company, "department_name": ["like", f"{label}%"]},
		"name",
	)


def _ensure_designation(designation, company, department, parent_designation, result, source_cell=None):
	designation = cstr(designation).strip()
	if not designation:
		return None
	existing = frappe.db.exists("Designation", designation) or frappe.db.get_value(
		"Designation", {"designation_name": designation}, "name"
	)
	created = False
	if existing:
		doc = frappe.get_doc("Designation", existing)
	else:
		doc = frappe.new_doc("Designation")
		doc.designation_name = designation
		created = True
	_set_if_exists(doc, "hrms_parent_designation", parent_designation)
	_set_if_exists(doc, "hrms_source_department", department)
	_set_if_exists(doc, "hrms_org_source_cell", source_cell)
	doc.save(ignore_permissions=False)
	result["created_designations" if created else "updated_designations"].append(doc.name)
	return doc.name


def _set_if_exists(doc, fieldname, value):
	if frappe.get_meta(doc.doctype).has_field(fieldname):
		doc.set(fieldname, value)


def _get_meta_fields(doctype, requested):
	meta = frappe.get_meta(doctype)
	return [field for field in requested if field == "name" or meta.has_field(field)]


def _validate_department_delete(department):
	if not frappe.db.exists("Department", department):
		frappe.throw(_("部门 {0} 不存在。").format(department))
	if not frappe.has_permission("Department", "delete", department):
		frappe.throw(_("没有权限删除部门 {0}。").format(department))
	child = frappe.db.get_value("Department", {"parent_department": department}, "name")
	if child:
		frappe.throw(_("部门 {0} 下仍有子部门 {1}，请先调整层级。").format(department, child))
	employee = frappe.db.get_value("Employee", {"department": department, "status": "Active"}, "name")
	if employee:
		frappe.throw(_("部门 {0} 下仍有关联在职员工 {1}，请先转移员工。").format(department, employee))


def _get_departments(company=None):
	filters = {}
	if company:
		filters["company"] = company
	fields = _get_meta_fields(
		"Department",
		[
			"name",
			"department_name",
			"parent_department",
			"company",
			"is_group",
			"lft",
			"rgt",
			"hrms_org_level",
			"hrms_org_role",
			"hrms_org_manager",
			"hrms_org_proxy",
			"hrms_planned_headcount",
			"hrms_actual_headcount",
			"hrms_vacancy_count",
			"hrms_recruitment_plan",
			"hrms_org_source_cell",
		],
	)
	return frappe.get_all("Department", fields=fields, filters=filters, order_by="lft asc, department_name asc")


def _get_active_employees(company=None):
	filters = {"status": "Active"}
	if company:
		filters["company"] = company
	fields = _get_meta_fields(
		"Employee",
		[
			"name",
			"employee_name",
			"custom_employee_code",
			"employee_number",
			"company",
			"branch",
			"department",
			"designation",
			"grade",
			"reports_to",
			"image",
			"cell_number",
			"status",
		],
	)
	return frappe.get_all("Employee", fields=fields, filters=filters, order_by="department asc, designation asc, employee_name asc")


def _get_company_label(company=None):
	if not company:
		return "全部公司"
	return frappe.db.get_value("Company", company, "company_name") or company


def _company_metrics(company=None):
	departments = _get_departments(company)
	employees = _get_active_employees(company)
	staffing = _get_department_staffing(company)
	department_by_name = {department.name: department for department in departments}
	root_departments = [
		department
		for department in departments
		if not department.get("parent_department") or department.get("parent_department") not in department_by_name
	]
	staffing_summary = _summarize_staffing(root_departments, staffing)
	return {
		"planned_headcount": staffing_summary["planned_headcount"],
		"current_headcount": len(employees) or staffing_summary["current_headcount"],
		"vacancy_count": staffing_summary["vacancy_count"],
		"department_count": len(departments),
	}


def _summarize_staffing(root_departments, staffing):
	roots_with_counts = [department for department in root_departments if staffing.get(department.name, {}).get("planned_headcount")]
	source_departments = roots_with_counts or [frappe._dict({"name": name}) for name in staffing]
	return {
		"planned_headcount": sum(staffing.get(department.name, {}).get("planned_headcount", 0) for department in source_departments),
		"current_headcount": sum(staffing.get(department.name, {}).get("current_headcount", 0) for department in source_departments),
		"vacancy_count": sum(staffing.get(department.name, {}).get("vacancy_count", 0) for department in source_departments),
	}


def _is_management_designation(designation):
	designation = designation or ""
	return any(keyword in designation for keyword in HYBRID_MANAGER_KEYWORDS)


def _get_department_managers(employees):
	return [employee for employee in employees if _is_management_designation(employee.get("designation"))]


def _get_department_staffing(company=None):
	staffing = defaultdict(lambda: {"planned_headcount": 0, "current_headcount": 0, "vacancy_count": 0})
	for department in _get_departments(company):
		planned = cint(department.get("hrms_planned_headcount"))
		current = cint(department.get("hrms_actual_headcount"))
		vacancy = cint(department.get("hrms_vacancy_count"))
		if planned or current or vacancy:
			staffing[department.name] = {
				"planned_headcount": planned,
				"current_headcount": current,
				"vacancy_count": vacancy if vacancy else max(planned - current, 0),
				"recruitment_plan": department.get("hrms_recruitment_plan"),
			}
	if not frappe.db.exists("DocType", "Staffing Plan"):
		return staffing

	filters = {}
	if company:
		filters["company"] = company
	for plan in frappe.get_all("Staffing Plan", filters=filters, fields=["name", "department"]):
		try:
			doc = frappe.get_doc("Staffing Plan", plan.name)
		except Exception:
			continue
		department = doc.get("department")
		for row in doc.get("staffing_plan_details") or []:
			positions = frappe.utils.cint(row.get("number_of_positions"))
			current = frappe.utils.cint(row.get("current_count"))
			vacancies = frappe.utils.cint(row.get("vacancies"))
			staffing[department]["planned_headcount"] += positions
			staffing[department]["current_headcount"] += current
			staffing[department]["vacancy_count"] += vacancies if vacancies else max(positions - current, 0)
	return staffing


def _build_department_node(department, employees_by_department, department_children, staffing):
	employees = employees_by_department.get(department.name, [])
	managers = _get_department_managers(employees)
	staffing_row = staffing.get(department.name, {})
	current_headcount = len(employees) or staffing_row.get("current_headcount", 0)
	children = []
	children.extend(_build_management_node(employee) for employee in managers)
	if employees:
		children.append(_build_employee_group_node(department, employees, managers))
	children.extend(
		_build_department_node(child, employees_by_department, department_children, staffing)
		for child in department_children.get(department.name, [])
	)
	node = {
		"node_id": f"department:{department.name}",
		"id": f"department:{department.name}",
		"node_type": "department",
		"name": department.get("department_name") or department.name,
		"title": _manager_label(managers) or _department_manager_label(department) or "负责人未设置",
		"department": department.name,
		"role": department.get("hrms_org_role"),
		"manager_names": department.get("hrms_org_manager"),
		"proxy_names": department.get("hrms_org_proxy"),
		"recruitment_plan": department.get("hrms_recruitment_plan"),
		"planned_headcount": staffing_row.get("planned_headcount", 0),
		"current_headcount": current_headcount,
		"vacancy_count": staffing_row.get(
			"vacancy_count",
			max((staffing_row.get("planned_headcount", 0) or 0) - current_headcount, 0),
		),
		"children": children,
	}
	node["connections"] = len(children)
	node["expandable"] = bool(children)
	return node


def _build_management_node(employee):
	return {
		"node_id": f"manager:{employee.name}",
		"id": f"manager:{employee.name}",
		"node_type": "manager",
		"name": employee.get("employee_name") or employee.name,
		"title": employee.get("designation") or "管理人员",
		"employee": employee.name,
		"department": employee.get("department"),
		"image": employee.get("image"),
		"planned_headcount": 0,
		"current_headcount": 1,
		"vacancy_count": 0,
		"children": [],
		"connections": 0,
		"expandable": False,
	}


def _build_employee_group_node(department, employees, managers):
	manager_names = {employee.name for employee in managers}
	group_count = len([employee for employee in employees if employee.name not in manager_names])
	return {
		"node_id": f"employee_group:{department.name}",
		"id": f"employee_group:{department.name}",
		"node_type": "employee_group",
		"name": department.get("department_name") or department.name,
		"title": f"员工 {group_count} 人",
		"department": department.name,
		"planned_headcount": 0,
		"current_headcount": group_count,
		"vacancy_count": 0,
		"children": [],
		"connections": group_count,
		"expandable": False,
	}


def _manager_label(managers):
	if not managers:
		return ""
	return "、".join((employee.get("employee_name") or employee.name) for employee in managers[:3])


def _department_manager_label(department):
	role = department.get("hrms_org_role") or ""
	manager = department.get("hrms_org_manager") or ""
	return "：".join(part for part in [role, manager] if part)


def _department_subtitle(department_doc):
	if not department_doc:
		return "部门/员工组"
	parts = [
		getattr(department_doc, "parent_department", None),
		getattr(department_doc, "hrms_org_proxy", None)
		and _("代理人：{0}").format(getattr(department_doc, "hrms_org_proxy")),
		getattr(department_doc, "hrms_recruitment_plan", None)
		and _("招聘需求：{0}").format(getattr(department_doc, "hrms_recruitment_plan")),
	]
	return " · ".join(part for part in parts if part) or "部门/员工组"


def _node_type_from_id(node_id):
	if ":" in node_id:
		return node_id.split(":", 1)[0]
	return ""


def _node_value(node_id):
	if ":" in node_id:
		return node_id.split(":", 1)[1]
	return node_id


def _get_node_employees(department=None, manager=None, company=None, search=None):
	filters = {"status": "Active"}
	if company:
		filters["company"] = company
	if department:
		filters["department"] = department
	if manager:
		filters["reports_to"] = manager
	or_filters = None
	if search:
		or_filters = {
			"employee_name": ["like", f"%{search}%"],
			"name": ["like", f"%{search}%"],
			"custom_employee_code": ["like", f"%{search}%"],
		}
	fields = _get_meta_fields(
		"Employee",
		[
			"name",
			"employee_name",
			"custom_employee_code",
			"employee_number",
			"department",
			"designation",
			"grade",
			"reports_to",
			"branch",
			"cell_number",
			"image",
		],
	)
	return [
		_employee_row(employee)
		for employee in frappe.get_all(
			"Employee",
			fields=fields,
			filters=filters,
			or_filters=or_filters,
			order_by="department asc, designation asc, employee_name asc",
			limit_page_length=500,
		)
	]


def _employee_row(employee):
	return {
		"name": employee.get("name"),
		"employee_name": employee.get("employee_name") or employee.get("name"),
		"employee_code": employee.get("custom_employee_code") or employee.get("employee_number"),
		"department": employee.get("department"),
		"designation": employee.get("designation"),
		"grade": employee.get("grade"),
		"reports_to": employee.get("reports_to"),
		"branch": employee.get("branch"),
		"cell_number": employee.get("cell_number"),
		"image": employee.get("image"),
	}
