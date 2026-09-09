"""Department scopes from explicit chart merges, never from employee names."""


def department_scopes(graph, departments):
	labels = {}
	for department in departments:
		labels.setdefault(department.get("department_name"), []).append(department.get("name"))
	result = {}
	for key, node in graph.items():
		department = node["config"].get("department")
		allowed, seen, cursor = set(filter(None, [department])), set(), key
		while cursor in graph and cursor not in seen:
			seen.add(cursor)
			current = graph[cursor]
			cfg = current["config"]
			# A different real department is a boundary, even within the same tree.
			if cfg.get("department") and department and cfg["department"] != department:
				break
			for label in cfg.get("roster_department_alias_labels", []):
				matches = labels.get(label, [])
				if len(matches) == 1:
					allowed.add(matches[0])
			cursor = current.get("parent")
		result[key] = allowed
	return result
