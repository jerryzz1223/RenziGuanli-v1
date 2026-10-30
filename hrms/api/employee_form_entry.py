"""Employee-facing HR form entry and attachment archiving."""

import os

import frappe
from frappe import _

from hrms.api.employee_field_template import (
	EMPLOYEE_MATERIAL_FIELD_PREFIX,
	_employee_attachment_title_field_available,
	_get_employee_materials,
)


EMPLOYEE_FORM_ENTRY_TYPES = {
	"employee_talk": {
		"label": "员工谈话表",
		"description": "记录员工谈话材料，先匹配员工后拍照或上传归档。",
		"material_type": "employee_talk_form",
	},
	"employee_transfer_application": {
		"label": "员工职务调动申请表",
		"description": "记录员工职务调动申请材料，先匹配员工后拍照或上传归档。",
		"material_type": "employee_transfer_application",
	},
	"reward_punishment_report": {
		"label": "奖惩提报单",
		"description": "记录奖惩提报材料，先匹配员工后拍照或上传归档。",
		"material_type": "reward_punishment_report",
	},
}
EMPLOYEE_FORM_ENTRY_ROLES = {"HR User", "HR Manager", "System Manager"}
EMPLOYEE_FORM_ATTACHMENT_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
REVOKED_MATERIAL_PREFIX = "hrms_revoked_"
REVOCATION_FIELDS = ["custom_hrms_revocation_reason", "custom_hrms_revoked_by", "custom_hrms_revoked_at"]

EMPLOYEE_ATTACHMENT_TITLE_FIELD = "custom_hrms_attachment_title"
EMPLOYEE_FORM_TITLE_LABELS = {
	"employee_talk": "谈话标题",
	"employee_transfer_application": "调动标题",
	"reward_punishment_report": "奖惩标题",
}


def _can_use_employee_form_entry():
	return frappe.session.user == "Administrator" or bool(
		EMPLOYEE_FORM_ENTRY_ROLES.intersection(frappe.get_roles(frappe.session.user))
	)


def _require_employee_form_entry_access():
	if not _can_use_employee_form_entry():
		frappe.throw(_("只有人事用户可以录入员工表单"), frappe.PermissionError)


def _form_entry_type(form_type):
	form_type = str(form_type or "").strip()
	form_entry = EMPLOYEE_FORM_ENTRY_TYPES.get(form_type)
	if not form_entry:
		frappe.throw(_("员工表单类型不正确"))
	return form_entry


def _employee_search_filters(company):
	filters = {}
	if str(company or "").strip():
		filters["company"] = str(company).strip()
	return filters


@frappe.whitelist()
def find_employee_matches(search_text: str, company: str = ""):
	"""Find employees by business code or name before any attachment is uploaded."""
	_require_employee_form_entry_access()
	query = str(search_text or "").strip()
	if len(query) < 1:
		return []
	if len(query) > 80:
		frappe.throw(_("员工工号或姓名不能超过 80 个字符"))

	fields = [
		"name",
		"employee_name",
		"custom_employee_code",
		"company",
		"department",
		"designation",
		"status",
		"image",
	]
	filters = _employee_search_filters(company)
	# Company employee code is the business identity: an exact code must resolve
	# to that employee instead of expanding into every code containing the text.
	exact_code_rows = frappe.get_list(
		"Employee",
		filters={**filters, "custom_employee_code": query},
		fields=fields,
		order_by="employee_name asc, custom_employee_code asc",
		limit_page_length=20,
	)
	rows = exact_code_rows or frappe.get_list(
		"Employee",
		filters=filters,
		or_filters=[{"employee_name": ["like", f"%{query}%"]}],
		fields=fields,
		order_by="employee_name asc, custom_employee_code asc",
		limit_page_length=20,
	)
	return [
		{
			"name": row.name,
			"employee_name": row.employee_name,
			"employee_code": str(row.custom_employee_code or "").strip(),
			"company": row.company,
			"department": row.department,
			"designation": row.designation,
			"status": row.status,
			"image": row.image,
		}
		for row in rows
	]


@frappe.whitelist()
def archive_employee_form_attachment(employee: str, form_type: str, file_url: str, title: str = ""):
	"""Attach an uploaded photo/PDF to the selected employee's material archive."""
	_require_employee_form_entry_access()
	form_entry = _form_entry_type(form_type)
	title = str(title or "").strip()
	if not title:
		frappe.throw(_("请输入{0}").format(EMPLOYEE_FORM_TITLE_LABELS[form_type]))
	if len(title) > 140:
		frappe.throw(_("标题不能超过 140 个字符"))
	if not employee or not file_url:
		frappe.throw(_("请选择员工并上传材料"))

	doc = frappe.get_doc("Employee", employee)
	doc.check_permission("write")
	file_name = frappe.db.get_value("File", {"file_url": file_url}, "name")
	if not file_name:
		frappe.throw(_("未找到已上传的表单材料"))

	frappe.db.sql("SELECT name FROM `tabFile` WHERE name=%s FOR UPDATE", (file_name,))
	file_doc = frappe.get_doc("File", file_name)
	file_doc.check_permission("read")
	if str(file_doc.attached_to_field or "").startswith(REVOKED_MATERIAL_PREFIX):
		frappe.throw(_("已撤销的材料不能重新归档，请重新上传材料"))
	is_attached_to_employee = (
		file_doc.attached_to_doctype == "Employee" and file_doc.attached_to_name == doc.name
	)
	if not is_attached_to_employee and file_doc.owner != frappe.session.user:
		frappe.throw(_("只能归档当前登录用户上传的材料"), frappe.PermissionError)

	extension = os.path.splitext((file_doc.file_name or file_url).split("?", 1)[0])[1].lower()
	if extension not in EMPLOYEE_FORM_ATTACHMENT_EXTENSIONS:
		frappe.throw(_("仅支持 JPG、PNG、WebP 或 PDF 格式的员工表单"))
	if not _employee_attachment_title_field_available():
		frappe.throw(_("系统尚未完成员工材料标题字段迁移，请先执行站点 migrate"))

	file_doc.db_set("attached_to_doctype", "Employee")
	file_doc.db_set("attached_to_name", doc.name)
	file_doc.db_set("attached_to_field", f"{EMPLOYEE_MATERIAL_FIELD_PREFIX}{form_entry['material_type']}")
	file_doc.db_set(EMPLOYEE_ATTACHMENT_TITLE_FIELD, title)
	return {
		"employee": {
			"name": doc.name,
			"employee_name": doc.employee_name,
			"employee_code": str(doc.custom_employee_code or "").strip(),
		},
		"form_type": form_type,
		"form_label": form_entry["label"],
		"title": title,
		"file_name": file_doc.file_name,
		"materials": _get_employee_materials(doc),
	}


@frappe.whitelist()
def list_employee_form_entries(form_type: str, company: str = "", search_text: str = ""):
	"""List submitted attachments for one form type and visible employees."""
	_require_employee_form_entry_access()
	form_entry = _form_entry_type(form_type)
	search = str(search_text or "").strip().casefold()
	material_field = f"{EMPLOYEE_MATERIAL_FIELD_PREFIX}{form_entry['material_type']}"
	fields = ["name", "file_name", "file_url", "attached_to_name", "attached_to_field", "modified", "creation", "owner"]
	fields.extend(field for field in REVOCATION_FIELDS if frappe.db.has_column("File", field))
	if _employee_attachment_title_field_available():
		fields.insert(3, EMPLOYEE_ATTACHMENT_TITLE_FIELD)
	files = frappe.get_list(
		"File",
		filters={
			"attached_to_doctype": "Employee",
			"attached_to_field": ["in", [material_field, form_entry["material_type"], f"{REVOKED_MATERIAL_PREFIX}{form_entry['material_type']}"]],
		},
		fields=fields,
		order_by="modified desc, creation desc",
		limit_page_length=200,
	)
	if not files:
		return []

	employee_names = sorted({row.attached_to_name for row in files if row.attached_to_name})
	owners = sorted({row.owner for row in files if row.owner})
	employees = frappe.get_list(
		"Employee",
		filters={**_employee_search_filters(company), "name": ["in", employee_names]},
		fields=["name", "employee_name", "custom_employee_code", "department", "designation", "status"],
		limit_page_length=0,
	)
	if search:
		employees = [
			row
			for row in employees
			if search in str(row.employee_name or "").casefold()
			or search in str(row.department or "").casefold()
		]
	employees_by_name = {row.name: row for row in employees}
	users = frappe.get_all(
		"User",
		filters={"name": ["in", owners]},
		fields=["name", "full_name"],
		limit_page_length=0,
	)
	users_by_name = {row.name: row for row in users}
	return [
		{
			"name": row.name,
			"entry_status": "已撤销" if str(row.attached_to_field or "").startswith(REVOKED_MATERIAL_PREFIX) else "已录入",
			"revocation_reason": row.get("custom_hrms_revocation_reason") or "",
			"revoked_by": row.get("custom_hrms_revoked_by") or "",
			"revoked_at": row.get("custom_hrms_revoked_at") or "",
			"employee": row.attached_to_name,
			"employee_name": employees_by_name[row.attached_to_name].employee_name,
			"employee_code": str(employees_by_name[row.attached_to_name].custom_employee_code or "").strip(),
			"department": employees_by_name[row.attached_to_name].department,
			"designation": employees_by_name[row.attached_to_name].designation,
			"status": employees_by_name[row.attached_to_name].status,
			"file_name": row.file_name,
			"title": str(row.get(EMPLOYEE_ATTACHMENT_TITLE_FIELD) or "").strip(),
			"file_url": row.file_url,
			"modified": row.modified,
			"creation": row.creation,
			"submitted_by": row.owner,
			"submitted_by_name": (users_by_name.get(row.owner).full_name if users_by_name.get(row.owner) else None) or row.owner,
		}
		for row in files
		if row.attached_to_name in employees_by_name
	]


@frappe.whitelist()
def get_employee_form_entry_summaries(employee: str, company: str = ""):
	"""Return the latest submitted material for each form type of one employee."""
	_require_employee_form_entry_access()
	employee_name = str(employee or "").strip()
	if not employee_name:
		return {}

	employees = frappe.get_list(
		"Employee",
		filters={**_employee_search_filters(company), "name": employee_name},
		fields=["name", "employee_name", "custom_employee_code", "department", "designation", "status"],
		limit_page_length=1,
	)
	if not employees:
		return {}
	employee_row = employees[0]
	summaries = {}
	for form_type, form_entry in EMPLOYEE_FORM_ENTRY_TYPES.items():
		material_field = f"{EMPLOYEE_MATERIAL_FIELD_PREFIX}{form_entry['material_type']}"
		fields = ["name", "file_name", "file_url", "modified", "creation", "owner"]
		if _employee_attachment_title_field_available():
			fields.insert(3, EMPLOYEE_ATTACHMENT_TITLE_FIELD)
		files = frappe.get_list(
			"File",
			filters={
				"attached_to_doctype": "Employee",
				"attached_to_name": employee_name,
				"attached_to_field": ["in", [material_field, form_entry["material_type"]]],
			},
			fields=fields,
			order_by="modified desc, creation desc",
			limit_page_length=1,
		)
		if not files:
			summaries[form_type] = None
			continue

		row = files[0]
		submitted_by_name = frappe.db.get_value("User", row.owner, "full_name") or row.owner
		summaries[form_type] = {
			"employee": employee_row.name,
			"employee_name": employee_row.employee_name,
			"employee_code": str(employee_row.custom_employee_code or "").strip(),
			"department": employee_row.department,
			"designation": employee_row.designation,
			"status": employee_row.status,
			"file_name": row.file_name,
			"title": str(row.get(EMPLOYEE_ATTACHMENT_TITLE_FIELD) or "").strip(),
			"file_url": row.file_url,
			"modified": row.modified,
			"creation": row.creation,
			"submitted_by": row.owner,
			"submitted_by_name": submitted_by_name,
		}
	return summaries


@frappe.whitelist()
def revoke_employee_form_entry(file_name: str, form_type: str, reason: str):
	"""Retain evidence in the entry ledger while removing it from active archives."""
	_require_employee_form_entry_access()
	form_entry = _form_entry_type(form_type)
	reason = str(reason or "").strip()
	if not reason or len(reason) > 1000:
		frappe.throw(_("请填写撤销原因（最多 1000 个字符）"))
	if not all(frappe.db.has_column("File", field) for field in REVOCATION_FIELDS):
		frappe.throw(_("撤销字段尚未完成迁移，请先执行站点 migrate"))
	# Serialize repeat requests so the first operator's evidence is retained.
	frappe.db.sql("SELECT name FROM `tabFile` WHERE name=%s FOR UPDATE", (file_name,))
	file_doc = frappe.get_doc("File", file_name)
	file_doc.check_permission("read")
	material_type = form_entry["material_type"]
	active_fields = [f"{EMPLOYEE_MATERIAL_FIELD_PREFIX}{material_type}", material_type]
	revoked_field = f"{REVOKED_MATERIAL_PREFIX}{material_type}"
	if file_doc.attached_to_doctype != "Employee" or file_doc.attached_to_field not in active_fields + [revoked_field]:
		frappe.throw(_("该材料不属于指定员工表单"))
	employee = frappe.get_doc("Employee", file_doc.attached_to_name)
	employee.check_permission("write")
	if file_doc.attached_to_field == revoked_field:
		return {"name": file_doc.name, "entry_status": "已撤销"}
	file_doc.db_set({
		"attached_to_field": revoked_field,
		"custom_hrms_revocation_reason": reason,
		"custom_hrms_revoked_by": frappe.session.user,
		"custom_hrms_revoked_at": frappe.utils.now(),
	})
	return {"name": file_doc.name, "entry_status": "已撤销"}
