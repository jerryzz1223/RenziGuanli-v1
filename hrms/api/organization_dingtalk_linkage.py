"""Pull a bounded DingTalk tree, then explicitly merge into the editable chart.

Employee master records and existing Department hierarchy are never rewritten.
Snapshots live in user-scoped, expiring server cache; applied batches and source
identity live in the chart version's notes and an attached private audit file.
"""
import hashlib
import json
from collections import Counter, deque

import frappe
from frappe.utils import now_datetime

from hrms.api import dingtalk_integration as integration
from hrms.api.organization_package import authorize, chart_module, version_options

TTL = 1800
MAX_DEPARTMENTS = 1500
MAX_DEPTH = 40


def digest(value):
	return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def key(token):
	return "hrms:organization-dingtalk:" + token


def context(company):
	authorize(company)
	company = integration._require_sync_company(company)
	settings = integration._settings_doc()
	corp = str(settings.get("corp_id") or "").strip()
	if not corp:
		frappe.throw("请先在钉钉设置中填写企业 CorpId，以免关联不同企业的同号部门。")
	return {"company": company, "corp_id": corp,
		"connection": digest([corp, settings.get("client_id"), settings.get("app_id")])}


def validate_source(rows):
	"""Return parent-first order; reject empty, partial, duplicate and cyclic trees."""
	if not rows or len(rows) > MAX_DEPARTMENTS:
		raise ValueError("部门来源为空或超过数量上限，请核对授权范围。")
	by_id = {}
	for row in rows:
		identifier = str(row.get("external_id") or "").strip()
		parent = str(row.get("parent_id") or "").strip()
		label = str(row.get("department_name") or "").strip()
		if not identifier.isdigit() or int(identifier) <= 1 or identifier in by_id or not label or len(label) > 140:
			raise ValueError("部门编号重复、无效或名称缺失/过长。")
		by_id[identifier] = {"external_id": identifier, "parent_id": parent, "department_name": label}
	ordered, done = [], {"1"}
	while len(ordered) < len(by_id):
		ready = [row for identifier, row in by_id.items() if identifier not in done and row["parent_id"] in done]
		if not ready:
			raise ValueError("部门来源存在循环或缺失上级，不能应用。")
		ordered.extend(ready)
		done.update(row["external_id"] for row in ready)
	return ordered


def pull_source():
	queue, seen, rows = deque([("1", 0)]), set(), []
	while queue:
		parent, depth = queue.popleft()
		if depth > MAX_DEPTH:
			raise ValueError("部门层级超过读取上限，本次来源不完整。")
		if parent in seen:
			raise ValueError("部门树重复或循环，本次来源不完整。")
		seen.add(parent)
		payload = integration._dingtalk_api_request("POST", integration.DINGTALK_DEPARTMENT_LIST_PATH,
			use_oapi=True, json_body={"dept_id": int(parent), "language": "zh_CN"})
		if not isinstance(payload, dict) or not isinstance(payload.get("result"), list):
			raise ValueError("钉钉未返回有效部门列表，不能视为空部门。")
		items = integration._extract_result_list(payload, "departments", "dept_infos", "deptInfos", "result")
		for item in items:
			row = integration.normalize_dingtalk_department(item)
			if row["parent_id"] and row["parent_id"] != parent:
				raise ValueError("返回部门与请求上级不一致。")
			row["parent_id"] = parent
			rows.append(row)
			if len(rows) > MAX_DEPARTMENTS:
				raise ValueError("部门数量超过读取上限，本次来源不完整。")
			queue.append((row["external_id"], depth + 1))
	return validate_source(rows)


@frappe.whitelist(methods=["POST"])
def queue_pull(company: str):
	ctx = context(company)
	integration._require_api_sync_enabled(company)
	token = frappe.generate_hash(length=40)
	job = {**ctx, "user": frappe.session.user, "status": "queued", "created_at": str(now_datetime())}
	frappe.cache().set_value(key(token), job, expires_in_sec=TTL)
	frappe.enqueue("hrms.api.organization_dingtalk_linkage.run_pull", token=token,
		queue="long", timeout=900, enqueue_after_commit=True)
	return {"token": token, "status": "queued"}


def run_pull(token):
	job = frappe.cache().get_value(key(token))
	if not job or job["status"] != "queued":
		return
	previous_user = frappe.session.user
	try:
		frappe.set_user(job["user"])
		if context(job["company"]) != {field: job[field] for field in ("company", "corp_id", "connection")}:
			raise ValueError("钉钉连接已改变，请重新拉取。")
		integration._require_api_sync_enabled(job["company"])
		job.update(status="running")
		frappe.cache().set_value(key(token), job, expires_in_sec=TTL)
		rows = pull_source()
		job.update(status="ready", rows=rows, pulled_at=str(now_datetime()), snapshot_hash=digest(rows))
	except Exception:
		frappe.log_error(title="钉钉组织来源读取失败")
		job.update(status="failed", error="拉取失败或组织来源不完整。请检查应用权限、授权范围和服务端日志后重试。")
	finally:
		frappe.set_user(previous_user)
	frappe.cache().set_value(key(token), job, expires_in_sec=TTL)


def get_job(company, token):
	ctx = context(company)
	job = frappe.cache().get_value(key(str(token)))
	if not job or job.get("user") != frappe.session.user or any(job.get(field) != value for field, value in ctx.items()):
		frappe.throw("来源已过期、连接已改变或不属于当前用户及公司，请重新拉取。")
	return job


@frappe.whitelist()
def pull_status(company: str, token: str):
	job = get_job(company, token)
	return {field: job.get(field) for field in ("status", "error", "pulled_at")}


@frappe.whitelist()
def setup_rows(company: str, token: str):
	job = get_job(company, token)
	if job["status"] != "ready":
		frappe.throw("来源尚未就绪。")
	current = state(company)
	maps = current["options"].get("dingtalk_department_maps", {})
	return {"rows": [{**row, "target_node": maps.get(row["external_id"], {}).get("node", ""),
		"decision": "保留人工结果"} for row in job["rows"]], "initial": not bool(current["nodes"]),
		"node_names": [n["name"] for n in current["nodes"] if n["confirmation_status"] == "已确认"],
		"pulled_at": job["pulled_at"]}


def state(company, lock=False):
	chart = chart_module()
	if lock:
		# Locking reads see committed changes even if permission checks opened an
		# earlier repeatable-read snapshot. Serialize with manual edits/reconcile.
		versions = frappe.db.sql("select name, notes from `tabOrganization Structure Version` where company=%s and source_reference=%s and status!='已归档' for update",
			(company, chart._manual_organization_reference(company)), as_dict=True)
		if len(versions) > 1:
			frappe.throw("当前公司有多个活动组织版本，请先核对。")
		version = versions[0]["name"] if versions else None
		nodes = frappe.db.sql("select name, display_name, parent_node, source_text, modified, confirmation_status from `tabOrganization Node` where structure_version=%s for update", version, as_dict=True) if version else []
		departments = frappe.db.sql("select name, department_name, modified from tabDepartment where company=%s and disabled=0 for update", company, as_dict=True)
		try:
			options = json.loads(versions[0]["notes"] or "{}") if versions else {}
			if not isinstance(options, dict): options = {}
		except ValueError:
			options = {}
		return {"version": version, "nodes": sorted([dict(n) for n in nodes], key=lambda n: n["name"]),
			"departments": sorted([dict(d) for d in departments], key=lambda d: d["name"]), "options": options}
	manual = chart._get_manual_organization_records(company)
	# Include unconfirmed/hidden nodes in concurrency checks and identity lookup.
	nodes = frappe.get_all("Organization Node", filters={"structure_version": manual["version"]},
		fields=["name", "display_name", "parent_node", "source_text", "modified", "confirmation_status"], limit_page_length=0) if manual["version"] else []
	departments = frappe.get_list("Department", filters={"company": company, "disabled": 0},
		fields=["name", "department_name", "modified"], limit_page_length=0)
	options = version_options(manual["version"]) if manual["version"] else {}
	return {"version": manual["version"], "nodes": sorted([dict(n) for n in nodes], key=lambda n: n["name"]),
		"departments": sorted([dict(d) for d in departments], key=lambda d: d["name"]), "options": options}


def build_plan(snapshot, current, bindings=None, department_bindings=None):
	"""Pure merge plan. The default decision for every row is keep."""
	bindings, department_bindings = bindings or {}, department_bindings or {}
	rows = validate_source(snapshot["rows"])
	ids = {r["external_id"] for r in rows}
	if set(bindings) - ids or set(department_bindings) - ids:
		raise ValueError("映射包含不属于本次来源的部门。")
	nodes = {node["name"]: node for node in current["nodes"]}
	departments = {row["name"]: row for row in current["departments"]}
	maps = current["options"].get("dingtalk_department_maps", {})
	# A chart belongs to one connection. Changing enterprise requires explicit migration.
	connection = current["options"].get("dingtalk_organization_connection")
	if maps and connection != snapshot["connection"]:
		raise ValueError("已有组织映射属于其他钉钉连接，请先完成映射迁移。")
	used = {mapping["node"] for mapping in maps.values()}
	plan, targets = [], []
	for source in rows:
		identifier, label = source["external_id"], source["department_name"]
		mapping = maps.get(identifier)
		if mapping and (mapping["node"] not in nodes or nodes[mapping["node"]]["confirmation_status"] != "已确认"):
			if not bindings.get(identifier):
				raise ValueError("原关联节点已删除或停用，请明确选择新建或其他现有节点。")
			mapping = None
		force_new = bindings.get(identifier) == "__new__"
		target = (mapping or {}).get("node") or (None if force_new else bindings.get(identifier))
		if mapping and bindings.get(identifier) and bindings[identifier] != target:
			raise ValueError("已有编号映射不能直接改绑。")
		candidate_nodes = [n for n in nodes.values() if n["name"] not in used and n["confirmation_status"] == "已确认" and n["display_name"] == label
			and json.loads(n["source_text"] or "{}").get("node_kind") in {"部门", "室", "课", "组", "线"}]
		if not target and not force_new and len(candidate_nodes) == 1:
			target = candidate_nodes[0]["name"]
		node = nodes.get(target) if target else None
		if target and (not node or node["confirmation_status"] != "已确认"):
			raise ValueError("关联节点不存在、未确认或不属于当前公司。")
		if target and not mapping and target in used:
			raise ValueError("同一节点不能关联两个钉钉部门。")
		cfg = json.loads(node["source_text"] or "{}") if node else {}
		if node and (not cfg.get("manual_organization") or cfg.get("node_kind") not in {"部门", "室", "课", "组", "线"} or cfg.get("roster_subset")):
			raise ValueError("请关联完整部门节点，不能关联分管、岗位或部门内分组。")
		department = cfg.get("department") if node else department_bindings.get(identifier)
		if not department:
			matches = [d["name"] for d in departments.values() if d["department_name"] == label]
			department = matches[0] if len(matches) == 1 else None
			if len(matches) > 1:
				raise ValueError("系统有同名部门，请先为钉钉部门 {0} 选择系统部门。".format(identifier))
		if department and department not in departments:
			raise ValueError("关联部门已停用或不属于当前公司。")
		if node and department_bindings.get(identifier) and department_bindings[identifier] != department:
			raise ValueError("已有组织节点的业务部门不能在同步时替换。")
		baseline = (mapping or {}).get("baseline", {})
		local_changed = bool(node and mapping and (node["display_name"] != baseline.get("display_name") or node.get("parent_node") != baseline.get("parent_node")))
		plan.append({**source, "node": target or "", "department": department or "",
			"current_name": node["display_name"] if node else "", "current_parent": node.get("parent_node") if node else "",
			"manual_changes": local_changed, "mapped": bool(mapping),
			"status": "人工调整，默认保留" if local_changed else "已关联，可选择更新" if mapping else "候选节点，采用后建立关联" if node else "待新建",
			"decision": "keep"})
		if target:
			targets.append(target)
	if any(count > 1 for count in Counter(targets).values()):
		raise ValueError("多个钉钉部门指向同一节点，请分别选择节点或选择新建。")
	if any(count > 1 for count in Counter(r["department"] for r in plan if r["department"]).values()):
		raise ValueError("多个钉钉部门关联同一系统部门，请先核对部门映射。")
	if any(count > 1 for count in Counter(r["department_name"] for r in plan if not r["department"]).values()):
		raise ValueError("同名钉钉部门需先创建可区分名称的系统部门，再分别关联。")
	return {"rows": plan, "missing_source": [identifier for identifier in maps if identifier not in ids],
		"initial": not bool(current["nodes"])}


def parse_object(value):
	try:
		value = json.loads(value) if isinstance(value, str) else value
	except ValueError:
		frappe.throw("请选择有效的映射和处理决定。")
	if not isinstance(value, dict):
		frappe.throw("请选择有效的映射和处理决定。")
	return value


@frappe.whitelist(methods=["POST"])
def preview(company: str, token: str, bindings_json="{}", departments_json="{}"):
	job = get_job(company, token)
	if job["status"] != "ready":
		frappe.throw("来源尚未就绪，请等待拉取完成。")
	bindings, departments = parse_object(bindings_json), parse_object(departments_json)
	current = state(company)
	try:
		plan = build_plan(job, current, bindings, departments)
	except ValueError as exc:
		frappe.throw(str(exc))
	fingerprint = digest([job["snapshot_hash"], current, bindings, departments])
	return {**plan, "fingerprint": fingerprint, "pulled_at": job["pulled_at"],
		"scope_notice": "仅包含当前应用授权可见部门；未出现的部门保留。现有员工档案、分管、编制和代理不受同步修改。"}


def validate_final_graph(current, rows, decisions):
	"""Validate the resulting mixed manual/source graph, not just the source tree."""
	by_external = {row["external_id"]: row for row in rows}
	graph = {n["name"]: n.get("parent_node") for n in current["nodes"]}
	def target(row):
		return row["node"] or "new:" + row["external_id"]
	for row in rows:
		if decisions.get(row["external_id"]) != "source":
			continue
		parent = by_external.get(row["parent_id"])
		if parent and not parent["node"] and decisions.get(parent["external_id"]) != "source":
			raise ValueError("采用新部门时，必须同时采用尚未建立的上级部门。")
		graph[target(row)] = target(parent) if parent else None
	for identifier in graph:
		seen, cursor = set(), identifier
		while cursor:
			if cursor in seen:
				raise ValueError("所选同步变化与人工关系组合后形成循环，请调整选择。")
			seen.add(cursor)
			cursor = graph.get(cursor)
	return graph


@frappe.whitelist(methods=["POST"])
def apply(company: str, token: str, fingerprint: str, decisions_json: str, reason: str,
	bindings_json="{}", departments_json="{}"):
	job = get_job(company, token)
	if job["status"] != "ready":
		frappe.throw("来源尚未就绪。")
	if not str(reason or "").strip():
		frappe.throw("请填写本次建立或同步的原因。")
	bindings, departments, decisions = map(parse_object, (bindings_json, departments_json, decisions_json))
	frappe.db.sql("select name from tabCompany where name=%s for update", company)
	current = state(company, lock=True)
	options = current["options"]
	for batch in options.get("dingtalk_organization_batches", []):
		if batch["token"] == token:
			return {"duplicate": True, "changed": batch["changed"], "audit_file": batch["audit_file"]}
	if fingerprint != digest([job["snapshot_hash"], current, bindings, departments]):
		frappe.throw("组织或部门已被修改，本次预览已过期。请重新预览后选择。")
	try:
		plan = build_plan(job, current, bindings, departments)
	except ValueError as exc:
		frappe.throw(str(exc))
	ids = {row["external_id"] for row in plan["rows"]}
	if set(decisions) - ids or any(value not in ("keep", "source") for value in decisions.values()):
		frappe.throw("处理决定无效。")
	selected = [r for r in plan["rows"] if decisions.get(r["external_id"]) == "source"]
	if not selected:
		frappe.throw("请至少选择一个采用钉钉来源的部门。")
	try:
		validate_final_graph(current, plan["rows"], decisions)
	except ValueError as exc:
		frappe.throw(str(exc))
	chart = chart_module()
	frappe.db.savepoint("organization_dingtalk_apply")
	try:
		version = current["version"] or chart._ensure_manual_organization_version(company)
		frappe.get_doc("Organization Structure Version", version).check_permission("write")
		maps = dict(options.get("dingtalk_department_maps", {}))
		targets = {r["external_id"]: r["node"] for r in plan["rows"] if r["node"]}
		audit = []
		# Create the selected nodes first. Parent edges are assigned in final-graph
		# order below so an old edge cannot cause a temporary validation cycle.
		for row in selected:
			if row["node"]:
				frappe.get_doc("Organization Node", row["node"]).check_permission("write")
				continue
			department = row["department"]
			if not department:
				frappe.has_permission("Department", "create", throw=True)
				department = frappe.get_doc({"doctype": "Department", "department_name": row["department_name"],
					"company": company, "is_group": 0}).insert().name
			node = frappe.get_doc({"doctype": "Organization Node", "node_code": "DING-" + frappe.generate_hash(length=16),
				"structure_version": version, "node_type": "部门", "display_name": row["department_name"],
				"confirmation_status": "已确认", "source_text": json.dumps({"manual_organization": True,
					"node_kind": "部门", "framework": True, "department": department, "department_label": row["department_name"],
					"roster_department": department, "roster_auto_sync": False}, ensure_ascii=False)}).insert()
			targets[row["external_id"]] = node.name
		# Detach only selected nodes, using normal validation and history tracking.
		for row in selected:
			doc = frappe.get_doc("Organization Node", targets[row["external_id"]])
			audit.append({"external_id": row["external_id"], "node": doc.name, "created": not bool(row["node"]),
				"before": {"display_name": doc.display_name, "parent_node": doc.parent_node, "source_text": doc.source_text}})
			doc.parent_node = None
			doc.save()
		# Source is parent-first; unselected mapped ancestors retain manual edges.
		for row in selected:
			doc = frappe.get_doc("Organization Node", targets[row["external_id"]])
			doc.display_name = row["department_name"]
			doc.parent_node = targets.get(row["parent_id"])
			doc.save()
			maps[row["external_id"]] = {"node": doc.name, "baseline": {
				"display_name": doc.display_name, "parent_node": doc.parent_node}, "source_parent_id": row["parent_id"]}
			entry = next(item for item in audit if item["node"] == doc.name)
			entry["after"] = {"display_name": doc.display_name, "parent_node": doc.parent_node, "source_text": doc.source_text}
		from frappe.utils.file_manager import save_file
		file = save_file("organization-dingtalk-" + token[:12] + ".json", json.dumps({
			"company": company, "corp_id": job["corp_id"], "user": frappe.session.user, "reason": reason.strip(),
			"at": str(now_datetime()), "source_at": job["pulled_at"], "snapshot": job["rows"], "changes": audit,
			"decisions": decisions, "previous_maps": options.get("dingtalk_department_maps", {})}, ensure_ascii=False),
			"Organization Structure Version", version, is_private=1)
		batch = {"token": token, "changed": len(selected), "audit_file": file.file_url}
		options.update(dingtalk_organization_connection=job["connection"], dingtalk_department_maps=maps,
			dingtalk_organization_batches=[*options.get("dingtalk_organization_batches", []), batch])
		doc = frappe.get_doc("Organization Structure Version", version)
		doc.notes = json.dumps(options, ensure_ascii=False)
		doc.save()
	except Exception:
		frappe.db.rollback(save_point="organization_dingtalk_apply")
		raise
	frappe.publish_realtime("organization_roster_updated", {"company": company}, after_commit=True)
	return batch
