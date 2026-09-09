"""One-time, reviewed organization setup. Run inside the site's bench Python.

Only Organization Node records change. A private before/after snapshot is saved.
Default is preview; call run(apply=True) to apply the user-approved screenshot.
"""
import json
from pathlib import Path

import frappe
from frappe.utils import now_datetime


def run(apply=False):
	from hrms.hr.page.organizational_chart import organizational_chart as chart
	frappe.only_for("System Manager")
	company = "永新"
	manual = chart._get_manual_organization_records(company)
	marker = "organization-navigation-20260909"
	if any(node.manual_config.get("navigation_upgrade") == marker for node in manual["nodes"]):
		return {"status": "already_applied", "node_count": len(manual["nodes"])}
	supervisors = [node for node in manual["nodes"] if chart._manual_node_kind(node) == "分管" and not node.parent_node]
	ling = [node for node in supervisors if node.manual_config.get("manager_name") == "凌龙"]
	if len(ling) != 1 or len(supervisors) != 3:
		frappe.throw("现有分管结构与已确认示意不符，请先核对，不自动迁移。")
	confirmed = ["连续课", "设备课", "品管课", "工程课", "总办室"]
	departments = {}
	for label in confirmed:
		matches = frappe.get_all("Department", filters={"company": company, "disabled": 0, "department_name": label}, pluck="name")
		if len(matches) != 1:
			frappe.throw(f"部门 {label} 无法唯一匹配，未修改。")
		departments[label] = matches[0]
		linked = [n for n in manual["nodes"] if n.manual_config.get("department") == matches[0] and chart._manual_node_kind(n) in chart.ROSTER_UNIT_KINDS]
		if len(linked) > 1 or (linked and linked[0].parent_node != ling[0].name):
			frappe.throw(f"部门 {label} 已有不同组织归属，请先核对。")
	plan = {"company": company, "management": "经营管理层", "supervisors": len(supervisors), "confirmed_units": confirmed}
	if not apply:
		return {"status": "preview", **plan}
	before = [frappe.get_doc("Organization Node", node.name).as_dict() for node in manual["nodes"]]
	stamp = now_datetime().strftime("%Y%m%d-%H%M%S-%f")
	backup = Path(frappe.get_site_path("private", "backups", f"organization-navigation-{stamp}.json"))
	backup.parent.mkdir(parents=True, exist_ok=True)
	backup.write_text(frappe.as_json({"plan": plan, "before": before}), encoding="utf-8")
	backup.chmod(0o600)
	try:
		management = chart.save_manual_organization_node("管理层", display_name="经营管理层", company=company)
		management_doc = frappe.get_doc("Organization Node", management["name"])
		config = chart._manual_node_config(management_doc.source_text)
		config.update({"leadership_from_roster": True, "navigation_upgrade": marker})
		management_doc.source_text = json.dumps(config, ensure_ascii=False)
		management_doc.notes = "用户确认：组织列表与树状图共用层级；管理层合并展示总经理／副总经理，具体汇报关系不推断。"
		management_doc.save()
		for index, node in enumerate(supervisors, 1):
			doc = frappe.get_doc("Organization Node", node.name)
			doc.parent_node = management_doc.name
			if doc.display_name.startswith("分管："):
				doc.display_name = "分管" + ["一", "二", "三"][index - 1]
			doc.notes = (doc.notes or "") + f"\n{marker}：原显示名称 {node.display_name}；负责人和节点编号保留。"
			doc.save()
		for label, department in departments.items():
			if any(node.manual_config.get("department") == department for node in manual["nodes"]):
				continue
			chart.save_manual_organization_node("室" if label.endswith("室") else "课", display_name=label,
				department=department, parent_node=ling[0].name, company=company)
		after = chart._get_manual_organization_records(company)
		backup.write_text(frappe.as_json({"plan": plan, "before": before,
			"after": [frappe.get_doc("Organization Node", node.name).as_dict() for node in after["nodes"]]}), encoding="utf-8")
		frappe.db.commit()
		return {"status": "applied", "backup": str(backup), "node_count": len(after["nodes"]), **plan}
	except Exception:
		frappe.db.rollback()
		raise


if __name__ == "__main__":
	import sys
	frappe.init(site="hrms.localhost", sites_path="/home/frappe/frappe-bench/sites")
	frappe.connect()
	frappe.set_user("Administrator")
	try:
		print(json.dumps(run(apply="--apply" in sys.argv), ensure_ascii=False))
	finally:
		frappe.destroy()
