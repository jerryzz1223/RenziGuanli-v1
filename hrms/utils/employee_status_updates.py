"""Separate approved workflow/archive writes from manual status corrections."""
from contextlib import contextmanager
from contextvars import ContextVar
from html import escape

_status_write = ContextVar("hrms_employee_status_write", default=None)


@contextmanager
def employee_status_update(employee, source):
	if source not in {"separation", "roster_import", "confirmation", "transfer"}:
		raise ValueError("Unsupported employee status source")
	token = _status_write.set((id(employee), source))
	try:
		yield
	finally:
		_status_write.reset(token)


def save_employee_status_update(employee, source, **kwargs):
	with employee_status_update(employee, source):
		return employee.save(**kwargs)


def validate_employee_status_correction(employee):
	import frappe
	from frappe import _

	# Only this validation may create an audit entry for the ensuing save.
	employee.flags.hrms_status_correction = None
	if employee.is_new():
		return
	before = employee.get_doc_before_save()
	if not before:
		return
	fields = ("status", "custom_work_nature", "relieving_date", "reason_for_leaving")
	old = {field: str(before.get(field) or "") for field in fields}
	new = {field: str(employee.get(field) or "") for field in fields}
	if old == new:
		return
	departure_states = {"Left", "Inactive", "离职", "已离职", "待离职"}
	if not any(values[field] in departure_states for values in (old, new) for field in ("status", "custom_work_nature")):
		return
	trusted = _status_write.get()
	if trusted and trusted[0] == id(employee):
		return
	user = frappe.session.user
	if user != "Administrator" and "System Manager" not in frappe.get_roles(user):
		frappe.throw(_("日常离职请通过离职申请、审批及实际离职流程办理；只有管理员可以直接纠正离职档案。"), frappe.PermissionError)
	if not new["reason_for_leaving"].strip():
		frappe.throw(_("管理员纠正离职档案时必须填写离职原因（恢复在职时请注明纠错原因）。"))
	if (new["status"] == "Left" or new["custom_work_nature"] in {"离职", "已离职"}) and not new["relieving_date"]:
		frappe.throw(_("管理员直接改为离职时必须填写实际离职日期。"))
	employee.flags.hrms_status_correction = {"user": user, "old": old, "new": new}


def record_employee_status_correction(employee):
	change = getattr(employee.flags, "hrms_status_correction", None)
	if not change:
		return
	parts = ["管理员离职档案纠错", "操作人：" + change["user"]]
	for field, label in (("status", "状态"), ("custom_work_nature", "工作性质"), ("relieving_date", "离职日期"), ("reason_for_leaving", "原因")):
		parts.append("{0}：{1} → {2}".format(label, change["old"][field] or "空", change["new"][field] or "空"))
	employee.add_comment("Info", "<br>".join(escape(part) for part in parts))
	employee.flags.hrms_status_correction = None


def validate_employee_work_nature_change(employee):
	"""Reject direct changes before derived work-nature fields are synchronized."""
	import frappe
	from frappe import _

	if employee.is_new():
		return
	trusted = _status_write.get()
	if trusted and trusted[0] == id(employee):
		return
	# Existing approved archive/import paths keep their established behavior.
	if getattr(employee.flags, "hrms_employee_roster_import", False) or getattr(employee.flags, "hrms_dingtalk_sync", False):
		return
	before = employee.get_doc_before_save()
	if not before:
		return
	fields = ("custom_work_nature", "employment_type", "status", "custom_is_confirmed")
	if any(str(before.get(field) or "") != str(employee.get(field) or "") for field in fields):
		frappe.throw(_("工作性质及任职状态不可直接修改，请通过转正、离职或返聘等对应人事流程办理。"), frappe.PermissionError)
