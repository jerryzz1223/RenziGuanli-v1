"""Read-only comparison of stored DingTalk departments and HRMS departments."""
from collections import defaultdict

import frappe
from hrms.api import dingtalk_integration as integration


def _department_path(identifier, index, id_field, label_field, parent_field, root=""):
	"""Diagnostic path only; an incomplete path must never establish identity."""
	parts, seen = [], set()
	while identifier and identifier != root:
		if identifier in seen:
			parts.append("[循环]")
			break
		seen.add(identifier)
		rows = index.get(identifier, [])
		if len(rows) != 1:
			parts.append("[上级缺失或不唯一: {0}]".format(identifier))
			break
		row = rows[0]
		parts.append(str(row.get(label_field) or row.get(id_field) or ""))
		identifier = str(row.get(parent_field) or "").strip()
	return " / ".join(reversed(parts))


def build_department_review(sources, departments):
	by_name = defaultdict(list)
	local_by_id = defaultdict(list)
	for row in departments:
		by_name[str(row.get("department_name") or "").strip()].append(row)
		local_by_id[str(row.get("name") or "")].append(row)
	by_id = defaultdict(list)
	source_names = defaultdict(list)
	for row in sources:
		by_id[str(row.get("external_id") or "").strip()].append(row)
		source_names[str(row.get("department_name") or "").strip()].append(row)
	result = []
	for source in sources:
		dept_id = str(source.get("external_id") or "").strip()
		label = str(source.get("department_name") or "").strip()
		parent_id = str(source.get("parent_id") or "").strip()
		issues = []
		matches = by_name.get(label, []) if label else []
		if not dept_id or not label:
			issues.append("钉钉部门编号或名称缺失")
		if len(by_id[dept_id]) != 1:
			issues.append("钉钉部门编号重复")
		if len(source_names[label]) > 1:
			issues.append("钉钉存在同名部门，需按编号人工映射")
		if len(matches) > 1:
			issues.append("系统存在同名部门，不能自动选择")
		local = matches[0] if len(matches) == 1 and len(source_names[label]) == 1 and len(by_id[dept_id]) == 1 else None
		parent_name = ""
		if dept_id != "1" and parent_id not in ("", "1"):
			parents = by_id.get(parent_id, [])
			if len(parents) != 1:
				issues.append("来源上级部门缺失或不唯一")
			else:
				parent_name = str(parents[0].get("department_name") or "").strip()
				parent_matches = by_name.get(parent_name, [])
				if len(parent_matches) != 1 or len(source_names[parent_name]) != 1:
					issues.append("系统上级部门尚未唯一匹配")
				elif local and local.get("parent_department") != parent_matches[0].get("name"):
					issues.append("上下级关系不一致，需人工确认")
		elif dept_id != "1":
			issues.append("公司根层级需人工确认")
		seen = set()
		cursor = dept_id
		while cursor and cursor != "1" and len(by_id.get(cursor, [])) == 1:
			if cursor in seen:
				issues.append("钉钉部门上下级存在循环")
				break
			seen.add(cursor)
			cursor = str(by_id[cursor][0].get("parent_id") or "").strip()
		result.append({
			"department_id": dept_id, "department_name": label,
			"parent_id": parent_id, "parent_name": parent_name,
			"matched_department": local.get("name") if local else "",
			"system_parent": local.get("parent_department") if local else "",
			"source_path": _department_path(dept_id, by_id, "external_id", "department_name", "parent_id", "1"),
			"system_path": _department_path(str(local["name"]), local_by_id, "name", "department_name", "parent_department") if local else "",
			"match_basis": "仅名称候选，尚未绑定编号" if local else "未匹配",
			"suggested_action": "人工核对" if issues else "确认编号映射" if local else "核实后新建或映射现有部门",
			"status": "待核对" if issues else "可匹配" if local else "待新建",
			"issues": list(dict.fromkeys(issues)),
		})
	candidate_names = {row["matched_department"] for row in result if row["matched_department"]}
	unmatched = [{"name": row.get("name"), "department_name": row.get("department_name"),
		"system_path": _department_path(str(row.get("name") or ""), local_by_id, "name", "department_name", "parent_department"),
		"suggested_action": "核对来源范围或保留本地部门，不自动停用"}
		for row in departments if row.get("name") not in candidate_names]
	return {"rows": result, "source_count": len(sources),
		"unmatched_system_departments": unmatched,
		"unmatched_system_count": len(unmatched),
		"matched": sum(bool(row["matched_department"]) for row in result),
		"missing": sum(not row["matched_department"] for row in result),
		"review_required": sum(bool(row["issues"]) for row in result),
		"read_only": True}


@frappe.whitelist()
def preview_organization(company: str = ""):
	integration._require_dingtalk_manager()
	company = integration._require_sync_company(company)
	raw = frappe.get_all(
		integration.DINGTALK_RAW_RECORD_DOCTYPE,
		filters={"company": company, "source_type": "department"},
		fields=["external_id", "payload_json", "received_at", "sync_log"],
		limit_page_length=0,
	)
	sources, invalid = [], 0
	for row in raw:
		try:
			payload = integration._json_loads(row.get("payload_json"))
			if not isinstance(payload, dict):
				raise ValueError("部门来源必须为对象")
			item = integration.normalize_dingtalk_department(payload)
			stored_id = str(row.get("external_id") or "").strip()
			if stored_id and item["external_id"] and stored_id != item["external_id"]:
				raise ValueError("来源编号与内容编号不一致")
			item["external_id"] = str(row.get("external_id") or item["external_id"])
			sources.append(item)
		except (TypeError, ValueError, AttributeError):
			invalid += 1
	departments = frappe.get_list(
		"Department", filters={"company": company, "disabled": 0},
		fields=["name", "department_name", "parent_department"], limit_page_length=0,
	)
	result = build_department_review(sources, departments)
	logs = sorted({str(row.get("sync_log")) for row in raw if row.get("sync_log")})
	result.update(company=company, invalid_source_records=invalid,
		source_sync_logs=logs,
		mixed_source_batches=len(logs) > 1,
		snapshot_complete=False,
		latest_source_at=max((str(row.get("received_at") or "") for row in raw), default=""),
		message="只核对已保存的钉钉来源，未连接钉钉或修改系统部门。来源可能包含旧记录，不能据此自动删除部门或调整人员。")
	return result
