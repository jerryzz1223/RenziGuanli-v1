"""Continuously reconcile organization scaffolding from the active employee roster.

Employee records are read-only here. Manual placement is an explicit override;
name, parent and staffing plan are never rewritten on existing chart nodes.
"""
import json
from collections import defaultdict

import frappe
from frappe.utils import cint

SYNC_FIELDS = ("primary_employee", "proxy_employee", "assigned_employees")


def enabled_companies():
	from hrms.api.organization_package import version_options
	companies = set(frappe.conf.get("organization_roster_auto_sync_companies") or [])
	for version in frappe.get_all("Organization Structure Version", filters={"status": ["!=", "已归档"]}, fields=["name", "company", "source_reference"]):
		if version.source_reference == f"manual_organization_chart:{version.company}":
			options = version_options(version.name)
			if "roster_auto_sync_enabled" in options:
				if options["roster_auto_sync_enabled"]: companies.add(version.company)
				else: companies.discard(version.company)
	return sorted(companies)


def roster_changed(doc, method=None):
	before = doc.get_doc_before_save() if method != "after_delete" else None
	if before and not any(doc.has_value_changed(key) for key in ("company", "department", "designation", "status", "employee_name")):
		return
	companies = {doc.company, before.company if before else None}
	for company in companies & set(enabled_companies()):
		# One task per company, after the entire import transaction has committed.
		queued = frappe.flags.setdefault("organization_roster_queued", set())
		if company in queued:
			continue
		queued.add(company)
		frappe.enqueue("hrms.api.organization_roster_sync.run_sync", company=company,
			enqueue_after_commit=True, queue="short", timeout=300)


def scheduled_sync():
	for company in enabled_companies():
		try:
			run_sync(company)
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(title="组织花名册自动更新失败")


def run_sync(company):
	if company not in enabled_companies():
		return {"enabled": False}
	previous_user = frappe.session.user
	try:
		frappe.set_user("Administrator")
		# This entry point runs as a standalone job, never in an Employee save.
		frappe.db.commit()
		result = reconcile(company)
		if result["changed"]:
			frappe.publish_realtime("organization_roster_updated", {"company": company}, after_commit=True)
		return result
	finally:
		frappe.set_user(previous_user)


@frappe.whitelist(methods=["POST"])
def sync_current_organization(company: str):
	"""Opening the page catches direct SQL imports too; never elevate the caller."""
	if company not in enabled_companies():
		return {"enabled": False}
	frappe.get_doc("Company", company).check_permission("read")
	if not all(frappe.has_permission("Organization Node", action) for action in ("create", "write")):
		return {"enabled": True, "background_only": True}
	if "System Manager" not in frappe.get_roles():
		# A department-limited HR account must never reconcile the whole company
		# from its partial Employee result set. Let the configured worker do it.
		frappe.enqueue("hrms.api.organization_roster_sync.run_sync", company=company,
			enqueue_after_commit=True, queue="short", timeout=300)
		return {"enabled": True, "background_only": True}
	# End the permission-check read snapshot before taking the synchronization lock.
	frappe.db.commit()
	return reconcile(company)


def reconcile(company):
	from hrms.hr.page.organizational_chart import organizational_chart as chart
	from hrms.api.organization_roster import get_candidates
	frappe.db.sql("select name from tabCompany where name=%s for update", company)
	versions = frappe.db.sql("select name from `tabOrganization Structure Version` where company=%s and source_reference=%s and status!='已归档' for update",
		(company, chart._manual_organization_reference(company)))
	version = versions[0][0] if versions else None
	if not version:
		version = chart._ensure_manual_organization_version(company)
	# Serializes imports, page loads and scheduler tasks through this transaction.
	frappe.db.sql("select name from `tabOrganization Structure Version` where name=%s for update", version)
	manual = chart._get_manual_organization_records(company)
	departments = {d.name: d for d in frappe.get_list("Department", filters={"company": company, "disabled": 0},
		fields=["name", "department_name", "parent_department"], limit_page_length=0)}
	staff = get_candidates(company, allow_company=True)["employees"]
	groups = defaultdict(list)
	by_department = defaultdict(list)
	issues = []
	for employee in staff:
		if employee.department not in departments:
			issues.append({"employee": employee.name, "reason": "待完善部门" if not employee.department else "部门已停用或不属于当前公司，待确认"})
		elif not employee.designation:
			issues.append({"employee": employee.name, "reason": "待完善职位"})
		else:
			groups[(employee.department, employee.designation)].append(employee.name)
		if employee.department in departments:
			by_department[employee.department].append(employee)
	for members in groups.values():
		members.sort()
	units = {}
	positions = defaultdict(list)
	changed = 0
	def update(node, values):
		nonlocal changed
		config = node.manual_config
		if all(config.get(key) == value for key, value in values.items()):
			return
		doc = frappe.get_doc("Organization Node", node.name, for_update=True)
		config = {**chart._manual_node_config(doc.source_text), **values}
		doc.source_text = json.dumps(config, ensure_ascii=False)
		doc.save()
		node.manual_config = config
		changed += 1
	for node in manual["nodes"]:
		kind = chart._manual_node_kind(node)
		if node.manual_config.get("roster_subset"):
			continue
		if kind in chart.ROSTER_UNIT_KINDS:
			department = node.manual_config.get("department")
			if department in units:
				frappe.throw(f"部门 {department} 存在重复节点，请先合并。")
			units[department] = node
		elif kind == "岗位":
			key = (node.manual_config.get("department"), node.manual_config.get("designation"))
			positions[key].append(node)
			if "roster_auto_sync" not in node.manual_config:
				# Adopt only untouched initial allocations. Other custom positions stay manual.
				expected = groups.get(key, [])
				current = sorted(chart.chart_assigned_employees(node.manual_config))
				adopt = bool(node.manual_config.get("roster_initialization")) and current == expected and not node.manual_config.get("primary_employee")
				update(node, {"roster_auto_sync": adopt})
	# A source diagram may place a separately named roster department inside an
	# existing subgroup. Keep that explicit mapping portable using department labels.
	for node in manual["nodes"]:
		for label in node.manual_config.get("roster_department_alias_labels", []):
			matches = [d.name for d in departments.values() if d.department_name == label]
			if len(matches) > 1:
				frappe.throw(f"合并部门名称不唯一：{label}")
			if matches:
				department = matches[0]
				if department in units and units[department].name != node.name:
					frappe.throw(f"合并部门仍有独立组织节点：{label}")
				units[department] = node
	def ensure_unit(name, seen=None):
		nonlocal changed
		if name in units:
			return units[name]
		seen = set(seen or ())
		if name in seen:
			frappe.throw("部门上级关系存在循环。")
		seen.add(name)
		dept = departments[name]
		kind = next((kind for kind in ("室", "课", "组", "线") if dept.department_name.endswith(kind)), None)
		if not kind:
			issues.append({"department": name, "reason": "待确定组织类型"})
			return None
		parent = ensure_unit(dept.parent_department, seen) if dept.parent_department in departments else None
		saved = chart.save_manual_organization_node(kind, display_name=dept.department_name, department=name,
			parent_node=parent.name if parent else None, company=company)
		node = frappe._dict(name=saved["name"], manual_config={})
		update(node, {"roster_auto_sync": True, "roster_generated": True, "reporting_scope_pending": parent is None})
		units[name] = node
		changed += 1
		return node
	for department in departments:
		ensure_unit(department)
	# Explicit manual selections take precedence over the default roster buckets.
	reserved = set()
	staff_by_name = {employee.name: employee for employee in staff}
	from hrms.api.organization_template import reconcile_bindings
	for node in manual["nodes"]:
		config = node.manual_config
		if config.get("assignment_rules_manual"):
			resolved = reconcile_bindings(config, staff)
			valid = [b for b in resolved["template_bindings"] if b.get("employee") and not b.get("issue")]
			primary = set(b["employee"] for b in valid if b.get("slot") == "primary")
			proxy = set(b["employee"] for b in valid if b.get("slot") == "proxy")
			update(node, {**resolved, "assigned_employees": [] if chart.whole_department(config) or config.get("node_kind") in {"管理层", "分管", "员工"} else resolved["assigned_employees"], "primary_employee": next(iter(primary)) if len(primary) == 1 else None,
				"proxy_employee": next(iter(proxy)) if len(proxy) == 1 else None})
			reserved.update(resolved["assigned_employees"])
		elif config.get("roster_subset") and config.get("roster_auto_sync") and config.get("template_bindings") is not None:
			update(node, reconcile_bindings(config, staff))
			reserved.update(node.manual_config.get("assigned_employees", []))
		elif config.get("template_leadership") and config.get("roster_auto_sync"):
			resolved = reconcile_bindings(config, staff)
			update(node, {"template_bindings": resolved["template_bindings"]})
			reserved.update(name for name in resolved["assigned_employees"] if staff_by_name[name].department == config.get("department"))
	for node in manual["nodes"]:
		config = node.manual_config
		if (chart._manual_node_kind(node) in {"岗位", "员工"} or config.get("roster_subset")) and not config.get("roster_auto_sync"):
			members = set(filter(None, [config.get("employee"), config.get("primary_employee"), *chart.chart_assigned_employees(config)]))
			reserved.update(members)
			for member in members:
				person = staff_by_name.get(member)
				if not person or (config.get("department") and person.department != config["department"]):
					issues.append({"employee": member, "reason": "手动任职与花名册归属或在职状态不一致，待确认"})
	for key in set(groups) | set(positions):
		department, designation = key
		if department not in units or department not in departments:
			# Disabled/deleted departments must not leave automatic members behind.
			for node in positions[key]:
				if node.manual_config.get("roster_auto_sync"):
					update(node, {"assigned_employees": [], "primary_employee": None, "proxy_employee": None})
			continue
		members = [name for name in groups.get(key, []) if name not in reserved]
		automatic = [n for n in positions[key] if n.manual_config.get("roster_auto_sync")]
		if len(automatic) > 1:
			issues.append({"department": department, "reason": f"同名岗位 {designation} 有多个节点，新增人员归属需手动确认"})
			# Keep only previously unique placements; never choose a branch by order.
			owners = defaultdict(list)
			for candidate in automatic:
				for name in candidate.manual_config.get("assigned_employees", []): owners[name].append(candidate.name)
			for candidate in automatic:
				update(candidate, {"assigned_employees": [name for name in members if owners[name] == [candidate.name]], "primary_employee": None, "proxy_employee": None})
			continue
		if not automatic and positions[key]:
			if members:
				issues.extend({"employee": name, "reason": "岗位为手动维护，待分配"} for name in members)
			continue
		if not automatic and members:
			saved = chart.save_manual_organization_node("岗位", department=department, designation=designation, display_name=designation,
				role_title=designation, assignment_mode="正式", assigned_employees=members, parent_node=units[department].name, company=company)
			node = frappe._dict(name=saved["name"], manual_config={})
			update(node, {"roster_auto_sync": True, "roster_generated": True})
			positions[key].append(node)
			changed += 1
		elif automatic:
			update(automatic[0], {"assigned_employees": members, "primary_employee": None, "proxy_employee": None})
	for department, node in units.items():
		config = node.manual_config
		if config.get("roster_subset"):
			continue
		if config.get("template_leadership") and config.get("roster_auto_sync"):
			resolved = reconcile_bindings(config, staff)
			bindings = resolved["template_bindings"]
			primary = [b["employee"] for b in bindings if not b.get("issue") and b.get("slot") == "primary"]
			proxy = [b["employee"] for b in bindings if not b.get("issue") and b.get("slot") == "proxy"]
			update(node, {"template_bindings": bindings, "primary_employee": primary[0] if len(primary) == 1 else None,
				"proxy_employee": proxy[0] if len(proxy) == 1 else None})
			continue
		kind = config.get("node_kind")
		title = {"课": "课长", "组": "组长", "线": "线长"}.get(kind)
		if not title:
			continue
		people = by_department.get(department, [])
		primary = [e.name for e in people if e.designation in {title, title + "（代）", title + "(代)"}]
		proxy = []  # Acting in a post does not identify another person's proxy.
		values = {"primary_employee": primary[0] if len(primary) == 1 else None, "proxy_employee": proxy[0] if len(proxy) == 1 else None}
		if "roster_auto_sync" not in config:
			adopt = all(not config.get(key) or config.get(key) == value for key, value in values.items()) and config.get("role_title") in (None, "", title)
			update(node, {"roster_auto_sync": adopt})
		if node.manual_config.get("roster_auto_sync"):
			update(node, {**values, "role_title": title, "assignment_mode": "自动"})
			if len(primary) > 1 or len(proxy) > 1:
				issues.append({"department": department, "reason": "同一负责人职位有多人，正式、代理任职及代理人关系需手动确认"})
	return {"enabled": True, "changed": changed, "active_people": len(staff), "issues": issues}
