"""Restricted operational and company data-space tools for HRMS administrators."""

from __future__ import annotations

import hashlib
import json
from collections import OrderedDict

import frappe
from frappe import _
from frappe.utils import now_datetime
from frappe.utils.background_jobs import MAX_QUEUED_JOBS, get_queue, get_queue_list, get_running_jobs_in_queue


# Only company-owned input and transaction data belongs here. Company,
# Department, Designation, rule/template, permissions and credentials are
# deliberately never cleanup targets.
DATA_CLEANUP_MODULES = OrderedDict(
	(
		(
			"attendance",
			{
				"label": "考勤与奖惩数据",
				"description": "考勤导入、日检查、异常、奖励、月汇总与锁定记录",
				"risk": "medium",
				"doctypes": (
					"HRMS Attendance Exception",
					"HRMS Apple Reward Record",
					"HRMS Attendance Leave Evidence",
					"HRMS Monthly Attendance Summary",
					"HRMS Attendance Department Confirmation",
					"HRMS Attendance Lock Audit",
					"HRMS Attendance Month Lock",
					"HRMS Attendance Day Check",
					"HRMS Attendance Import Batch",
				),
			},
		),
		(
			"payroll",
			{
				"label": "薪资过程数据",
				"description": "调薪、变动项、福利源、薪资输入与结算结果",
				"risk": "medium",
				"doctypes": (
					"HRMS Payroll Settlement Record",
					"HRMS Payroll Input Record",
					"HRMS Payroll Variable Record",
					"HRMS Payroll Welfare Source Record",
					"HRMS Employee Salary Change",
					"HRMS Payroll Variable Import Batch",
				),
			},
		),
		(
			"form_intake",
			{
				"label": "表单导入与业务记录",
				"description": "通用表单导入批次、待处理行与已生成业务记录",
				"risk": "medium",
				"doctypes": ("HRMS Form Import Row", "HRMS Business Process Record", "HRMS Form Import Batch"),
			},
		),
		(
			"personnel_changes",
			{
				"label": "人事异动记录",
				"description": "调岗、晋升与离职流程记录",
				"risk": "high",
				"doctypes": ("Employee Promotion", "Employee Transfer", "Employee Separation"),
			},
		),
		(
			"recruitment",
			{
				"label": "招聘过程数据",
				"description": "录用、面试、候选人、职位与招聘申请",
				"risk": "medium",
				"doctypes": (
					"Job Offer",
					"Interview Feedback",
					"Interview",
					"Job Applicant",
					"Job Opening",
					"Job Requisition",
					"Staffing Plan",
				),
			},
		),
		(
			"dingtalk",
			{
				"label": "钉钉同步业务数据",
				"description": "原始同步记录、同步日志与员工映射（不删除钉钉密钥设置）",
				"risk": "medium",
				"doctypes": ("HRMS DingTalk Raw Record", "HRMS DingTalk Sync Log", "HRMS DingTalk User Map"),
			},
		),
		(
			"employees",
			{
				"label": "员工花名册",
				"description": "删除该公司员工主档；组织架构、字段模板与规则仍保留",
				"risk": "critical",
				"requires": ("attendance", "payroll", "form_intake", "personnel_changes", "dingtalk"),
				"doctypes": ("Employee",),
			},
		),
	)
)

LINKED_COMPANY_FIELDS = {
	"Job Applicant": ("job_title", "Job Opening"),
	"Interview": ("job_opening", "Job Opening"),
	"Interview Feedback": ("interview", "Interview"),
}


def _require_system_manager():
	if "System Manager" not in frappe.get_roles(frappe.session.user):
		frappe.throw(_("仅系统管理员可以使用数据处理中心。"), frappe.PermissionError)


def _require_company(company):
	company = str(company or "").strip()
	if not company or not frappe.db.exists("Company", company):
		frappe.throw(_("请选择有效的公司。"))
	return company


def _parse_module_keys(modules):
	if isinstance(modules, str):
		try:
			modules = json.loads(modules)
		except json.JSONDecodeError:
			modules = [item.strip() for item in modules.split(",") if item.strip()]
	requested = set(str(item) for item in (modules or []))
	keys = [key for key in DATA_CLEANUP_MODULES if key in requested]
	unknown = sorted(requested.difference(DATA_CLEANUP_MODULES))
	if unknown:
		frappe.throw(_("未知的数据模块：{0}").format(", ".join(unknown)))
	if not keys:
		frappe.throw(_("请至少选择一个需要清除的数据模块。"))
	return keys


def _employee_names(company):
	return frappe.get_all("Employee", filters={"company": company}, pluck="name")


def _filters_for_company(doctype, company, employees=None):
	if not frappe.db.exists("DocType", doctype):
		return None
	meta = frappe.get_meta(doctype)
	if meta.istable:
		return None
	if doctype == "Employee" or meta.has_field("company"):
		return {"company": company}
	if meta.has_field("employee"):
		employees = employees if employees is not None else _employee_names(company)
		return {"employee": ["in", employees or [""]]}
	if doctype in LINKED_COMPANY_FIELDS:
		fieldname, parent_doctype = LINKED_COMPANY_FIELDS[doctype]
		parent_filters = _filters_for_company(parent_doctype, company, employees)
		parents = frappe.get_all(parent_doctype, filters=parent_filters, pluck="name") if parent_filters else []
		return {fieldname: ["in", parents or [""]]}
	return None


def _records_by_module(company, module_keys=None):
	employees = _employee_names(company)
	result = OrderedDict()
	for module_key, config in DATA_CLEANUP_MODULES.items():
		if module_keys is not None and module_key not in module_keys:
			continue
		rows = OrderedDict()
		for doctype in config["doctypes"]:
			filters = _filters_for_company(doctype, company, employees)
			if filters is not None:
				rows[doctype] = frappe.get_all(doctype, filters=filters, pluck="name", order_by="creation desc")
		result[module_key] = rows
	return result


def _selected_records(all_records, module_keys):
	selected = OrderedDict()
	for module_key in module_keys:
		for doctype, names in all_records[module_key].items():
			selected.setdefault(doctype, [])
			selected[doctype].extend(name for name in names if name not in selected[doctype])
	return selected


def _plan_token(company, module_keys, records):
	payload = {
		"company": company,
		"modules": module_keys,
		"records": [(doctype, sorted(names)) for doctype, names in records.items()],
	}
	return hashlib.sha256(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def _employee_cleanup_blockers(all_records, module_keys):
	if "employees" not in module_keys:
		return []
	blockers = []
	for required in DATA_CLEANUP_MODULES["employees"]["requires"]:
		count = sum(len(names) for names in all_records.get(required, {}).values())
		if count and required not in module_keys:
			blockers.append({"key": required, "label": DATA_CLEANUP_MODULES[required]["label"], "count": count})
	return blockers


def _catalog(company):
	"""Return counts and small samples without loading every record name."""
	employees = _employee_names(company)
	catalog = []
	for key, config in DATA_CLEANUP_MODULES.items():
		doctypes = []
		total = 0
		for doctype in config["doctypes"]:
			filters = _filters_for_company(doctype, company, employees)
			if filters is None:
				continue
			count = frappe.db.count(doctype, filters)
			total += count
			if count:
				doctypes.append(
					{
						"doctype": doctype,
						"count": count,
						"sample_names": frappe.get_all(
							doctype, filters=filters, pluck="name", order_by="creation desc", limit_page_length=3
						),
					}
				)
		catalog.append(
			{
				"key": key,
				"label": config["label"],
				"description": config["description"],
				"risk": config["risk"],
				"default_selected": False,
				"requires": list(config.get("requires", ())),
				"count": total,
				"doctypes": doctypes,
			}
		)
	return catalog


def _employee_link_blockers(company, planned_records):
	"""Find Employee links outside the selected cleanup plan before deletion.

	Frappe's final link validation remains authoritative.  Surfacing direct Link
	fields here turns most late deletion failures into an actionable preview.
	"""
	employees = _employee_names(company)
	if not employees:
		return []
	link_fields = []
	if frappe.db.exists("DocType", "DocField"):
		link_fields.extend(
			{"doctype": row.parent, "fieldname": row.fieldname}
			for row in frappe.get_all(
				"DocField", filters={"fieldtype": "Link", "options": "Employee"}, fields=["parent", "fieldname"]
			)
		)
	if frappe.db.exists("DocType", "Custom Field"):
		link_fields.extend(
			{"doctype": row.dt, "fieldname": row.fieldname}
			for row in frappe.get_all(
				"Custom Field", filters={"fieldtype": "Link", "options": "Employee"}, fields=["dt", "fieldname"]
			)
		)

	planned_doctypes = set(planned_records)
	blockers = []
	seen = set()
	for row in link_fields:
		doctype = row["doctype"]
		fieldname = row["fieldname"]
		identity = (doctype, fieldname)
		if identity in seen or doctype in planned_doctypes or not frappe.db.exists("DocType", doctype):
			continue
		seen.add(identity)
		meta = frappe.get_meta(doctype)
		if meta.istable or not meta.has_field(fieldname):
			continue
		count = frappe.db.count(doctype, {fieldname: ["in", employees]})
		if count:
			blockers.append(
				{
					"doctype": doctype,
					"label": meta.get("label") or doctype,
					"fieldname": fieldname,
					"count": count,
				}
			)
	return sorted(blockers, key=lambda row: (-row["count"], row["doctype"]))


def _latest_cleanup_logs(company):
	if not frappe.db.exists("DocType", "HRMS Data Cleanup Log"):
		return []
	return frappe.get_all(
		"HRMS Data Cleanup Log",
		filters={"company_code": company},
		fields=["name", "modules", "record_count", "executed_by", "executed_at"],
		order_by="executed_at desc",
		limit_page_length=10,
	)


def _job_method(job):
	kwargs = getattr(job, "kwargs", {}) or {}
	return str(kwargs.get("method") or kwargs.get("kwargs", {}).get("method") or getattr(job, "func_name", ""))


def _job_label(method: str):
	if method == "frappe.model.delete_doc.delete_dynamic_links":
		return "关联记录清理"
	if method.startswith("hrms.api.dingtalk"):
		return "钉钉同步"
	if method.startswith("hrms."):
		return "人资后台任务"
	return "其他系统任务"


@frappe.whitelist()
def get_data_operations_overview():
	"""Return a small, read-only operational view for System Managers."""
	_require_system_manager()
	queue_limit = int(MAX_QUEUED_JOBS)
	queues = []
	relevant_jobs = []
	for queue_name in get_queue_list():
		queue = get_queue(queue_name)
		pending = int(queue.count)
		running = len(get_running_jobs_in_queue(queue))
		queues.append(
			{
				"name": queue_name,
				"pending": pending,
				"running": running,
				"level": "危险" if pending >= queue_limit else "提醒" if pending >= queue_limit * 0.8 else "正常",
			}
		)
		for job in queue.jobs[:30]:
			method = _job_method(job)
			if method.startswith("hrms.") or method == "frappe.model.delete_doc.delete_dynamic_links":
				relevant_jobs.append({"queue": queue_name, "type": _job_label(method), "method": method})

	queued_total = sum(row["pending"] for row in queues)
	return {
		"queue_limit": queue_limit,
		"queued_total": queued_total,
		"level": "危险" if any(row["level"] == "危险" for row in queues) else "提醒" if any(row["level"] == "提醒" for row in queues) else "正常",
		"queues": queues,
		"relevant_jobs": relevant_jobs[:20],
		"message": (
			"队列接近上限时，请暂停批量同步和大范围撤回；数据处理中心不会清空系统队列。"
			if queued_total >= queue_limit * 0.8
			else "队列可用。考勤撤回会在当前请求内清理生成记录，不再为每条记录投递关联清理任务。"
		),
		"actions": [
			{"label": "导入批次管理", "route": "/desk/attendance-import-center/import-batches"},
			{"label": "钉钉同步中心", "route": "/desk/attendance-import-center/dingtalk"},
			{"label": "钉钉同步日志", "route": "/desk/hrms-dingtalk-sync-log"},
		],
	}


@frappe.whitelist()
def get_company_data_management_context(company: str = ""):
	"""List managed companies and the safe cleanup catalog for one company."""
	_require_system_manager()
	companies = frappe.get_all("Company", fields=["name", "company_name", "abbr"], order_by="name asc")
	if not companies:
		return {"companies": [], "company": "", "modules": [], "protected": [], "cleanup_logs": []}
	company_names = {row.name for row in companies}
	company = company if company in company_names else companies[0].name
	for row in companies:
		row["employee_count"] = frappe.db.count("Employee", {"company": row.name})
		row["department_count"] = frappe.db.count("Department", {"company": row.name})
	return {
		"companies": companies,
		"company": company,
		"modules": _catalog(company),
		"protected": ["公司主体", "部门与组织架构", "职位/职级", "薪资与考勤规则", "字段与导入模板", "角色与权限", "钉钉密钥设置"],
		"cleanup_logs": _latest_cleanup_logs(company),
	}


@frappe.whitelist()
def preview_company_data_cleanup(company: str, modules: str | list | tuple | None = None):
	"""Build a stable deletion preview without changing data."""
	_require_system_manager()
	company = _require_company(company)
	module_keys = _parse_module_keys(modules)
	required_keys = set(module_keys)
	if "employees" in module_keys:
		required_keys.update(DATA_CLEANUP_MODULES["employees"]["requires"])
	all_records = _records_by_module(company, required_keys)
	records = _selected_records(all_records, module_keys)
	blockers = _employee_cleanup_blockers(all_records, module_keys)
	linked_blockers = _employee_link_blockers(company, records) if "employees" in module_keys else []
	return {
		"company": company,
		"modules": module_keys,
		"module_labels": [DATA_CLEANUP_MODULES[key]["label"] for key in module_keys],
		"count": sum(len(names) for names in records.values()),
		"records": [
			{"doctype": doctype, "count": len(names), "sample_names": names[:5]}
			for doctype, names in records.items()
			if names
		],
		"blockers": blockers,
		"linked_blockers": linked_blockers,
		"confirmation_text": f"清除 {company} 已选数据",
		"plan_token": _plan_token(company, module_keys, records),
	}


@frappe.whitelist()
def execute_company_data_cleanup(
	company: str,
	modules: str | list | tuple | None = None,
	confirm: str = "",
	plan_token: str = "",
):
	"""Delete exactly the previewed company records in dependency-safe order."""
	_require_system_manager()
	company = _require_company(company)
	module_keys = _parse_module_keys(modules)
	required_keys = set(module_keys)
	if "employees" in module_keys:
		required_keys.update(DATA_CLEANUP_MODULES["employees"]["requires"])
	all_records = _records_by_module(company, required_keys)
	blockers = _employee_cleanup_blockers(all_records, module_keys)
	if blockers:
		frappe.throw(
			_("清除员工花名册前，请同时选中并清除：{0}").format(
				"、".join(f"{row['label']}({row['count']})" for row in blockers)
			)
		)
	records = _selected_records(all_records, module_keys)
	linked_blockers = _employee_link_blockers(company, records) if "employees" in module_keys else []
	if linked_blockers:
		frappe.throw(
			_("员工花名册仍被其他业务记录引用，请先处理：{0}").format(
				"、".join(f"{row['label']}({row['count']})" for row in linked_blockers[:10])
			)
		)
	expected_token = _plan_token(company, module_keys, records)
	if not plan_token or plan_token != expected_token:
		frappe.throw(_("数据已变化，请重新预览后再清除。"))
	expected_confirmation = f"清除 {company} 已选数据"
	if confirm != expected_confirmation:
		frappe.throw(_("请输入完整确认文本：{0}").format(expected_confirmation))

	deleted = OrderedDict()
	savepoint = "hrms_company_data_cleanup"
	frappe.db.savepoint(savepoint)
	try:
		for doctype, names in records.items():
			deleted[doctype] = 0
			for name in names:
				doc = frappe.get_doc(doctype, name)
				doc.flags.ignore_permissions = True
				if doc.docstatus == 1:
					doc.cancel()
				frappe.delete_doc(doctype, name, ignore_permissions=True)
				deleted[doctype] += 1
		if frappe.db.exists("DocType", "HRMS Data Cleanup Log"):
			frappe.get_doc(
				{
					"doctype": "HRMS Data Cleanup Log",
					"company_code": company,
					"company_display_name": frappe.db.get_value("Company", company, "company_name") or company,
					"modules": "、".join(DATA_CLEANUP_MODULES[key]["label"] for key in module_keys),
					"record_count": sum(deleted.values()),
					"executed_by": frappe.session.user,
					"executed_at": now_datetime(),
					"plan_token": expected_token,
					"deleted_json": json.dumps(deleted, ensure_ascii=False),
				}
			).insert(ignore_permissions=True)
	except Exception:
		frappe.db.rollback(save_point=savepoint)
		raise
	return {
		"company": company,
		"count": sum(deleted.values()),
		"deleted": deleted,
		"message": _("{0}：已清除 {1} 条已选业务数据，公司与配置数据已保留。").format(company, sum(deleted.values())),
	}
