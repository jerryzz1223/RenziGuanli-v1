"""Chart roles are presentation metadata, never Employee master-data updates."""


def role_lines(config, people):
	"""Keep a local title even when vacant; resolve automatic acting per holder."""
	title = config.get("role_title") or config.get("designation") or ""
	mode = config.get("assignment_mode") or "正式"  # preserve legacy nodes
	lines = []
	primary = config.get("primary_employee") or config.get("responsible_person")
	if config.get("node_kind") == "分管":
		primary = config.get("manager_employee")
	elif config.get("node_kind") == "员工":
		primary = config.get("employee")
	holders = list(dict.fromkeys(filter(None, [primary, *config.get("assigned_employees", [])])))
	for key in holders:
		person = people.get(key)
		if not person:
			continue
		acting = mode == "代理" or (mode == "自动" and bool(title) and title != (person.get("designation") or ""))
		label = f"{title}（代理）" if acting and title else "代理人" if acting else title or "任职人"
		lines.append(f"{label}：{person.get('employee_name') or key}")
	if title and not holders:
		lines.append(f"{title}：空缺")
	proxy = people.get(config.get("proxy_employee"))
	if proxy:
		lines.append(f"{title + '·' if title else ''}代理人：{proxy.get('employee_name') or proxy.get('name')}")
	return lines
