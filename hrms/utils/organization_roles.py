"""Chart roles are presentation metadata, never Employee master-data updates."""
import re

ROSTER_UNIT_KINDS = {"室", "课", "组", "线"}


def chart_assigned_employees(config):
	"""Legacy unit selections are not role holders or a downstream candidate pool."""
	return [] if config.get("node_kind") in ROSTER_UNIT_KINDS and not config.get("roster_subset") else config.get("assigned_employees", [])


def whole_department(config):
	return config.get("node_kind") in ROSTER_UNIT_KINDS and not config.get("roster_subset")


def base_role(title):
	return re.sub(r"[（(](?:代|代理|兼|兼任)[）)]", "", title or "").strip()


def display_role(title, designation="", mode="正式"):
	"""A different primary job is not evidence of acting or substitution."""
	if re.search(r"[（(](?:代|代理|兼|兼任)[）)]", title or ""):
		return title
	if mode == "代理": return f"{title}（代理）" if title else "代理任职"
	if mode == "自动" and title and base_role(designation) == title and re.search(r"[（(](?:代|代理)[）)]", designation or ""):
		return f"{title}（代）"
	return title or "任职人"


def role_lines(config, people):
	"""Keep a local title even when vacant; resolve automatic acting per holder."""
	title = config.get("role_title") or config.get("designation") or ""
	mode = config.get("assignment_mode") or "正式"  # preserve legacy nodes
	lines = []
	primary = config.get("primary_employee") or config.get("responsible_person")
	if config.get("node_kind") in {"管理层", "分管"}:
		primary = config.get("manager_employee")
	elif config.get("node_kind") == "员工":
		primary = config.get("employee")
	holders = list(dict.fromkeys(filter(None, [primary, *chart_assigned_employees(config)])))
	for key in holders:
		person = people.get(key)
		if not person:
			continue
		label = display_role(title, person.get("designation") or "", mode)
		lines.append(f"{label}：{person.get('employee_name') or key}")
	if title and not holders:
		lines.append(f"{title}：空缺")
	proxy = people.get(config.get("proxy_employee"))
	if proxy:
		lines.append(f"{title + '·' if title else ''}代理人：{proxy.get('employee_name') or proxy.get('name')}")
	return lines


ASSIGNMENT_TYPES = {"待确认", "正式", "代理任职", "兼任", "代理人"}


def binding_assignment_type(binding, designation=""):
	"""A source mention alone never confirms the employee's unique formal post."""
	if binding.get("assignment_type") in ASSIGNMENT_TYPES:
		return "待确认" if binding["assignment_type"] == "正式" and not binding.get("manual_confirmed") else binding["assignment_type"]
	if binding.get("slot") == "proxy": return "代理人"
	role = display_role(binding.get("role"), designation, "正式" if binding.get("manual_confirmed") else "自动")
	if re.search(r"[（(](?:兼|兼任)[）)]", role): return "兼任"
	if re.search(r"[（(](?:代|代理)[）)]", role): return "代理任职"
	return "正式" if binding.get("manual_confirmed") else "待确认"


def confirmed_formal_bindings(config):
	return [b for b in config.get("template_bindings", []) if b.get("employee") and b.get("manual_confirmed") and binding_assignment_type(b) == "正式"]
