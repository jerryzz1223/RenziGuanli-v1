import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_days, cstr, getdate, nowdate


ACTIVE_STATUS = "有效"
PRIMARY_TYPE = "主职"


class EmployeePositionAssignment(Document):
	def validate(self):
		self._normalize_primary_fields()
		self._validate_dates()
		self._validate_company()
		self._validate_reports_to()
		self._validate_grade_tags()
		if self.status == ACTIVE_STATUS and self.is_primary:
			self._validate_primary_position()
			self._validate_no_overlapping_primary()

	def on_update(self):
		if self.status == ACTIVE_STATUS and self.is_primary:
			sync_employee_primary_assignment(self)

	def _normalize_primary_fields(self):
		if self.relationship_type == PRIMARY_TYPE:
			self.is_primary = 1
		elif self.is_primary:
			self.relationship_type = PRIMARY_TYPE

	def _validate_dates(self):
		if self.effective_to and getdate(self.effective_to) < getdate(self.effective_from):
			frappe.throw(_("生效结束日不能早于生效开始日。"))

	def _validate_company(self):
		employee_company = frappe.db.get_value("Employee", self.employee, "company")
		if employee_company and employee_company != self.company:
			frappe.throw(_("任职关系公司必须与员工所属公司一致。"))

	def _validate_reports_to(self):
		if not self.reports_to:
			return
		if self.reports_to == self.employee:
			frappe.throw(_("直属上级不能是员工本人。"))
		seen = {self.employee}
		current = self.reports_to
		while current:
			if current in seen:
				frappe.throw(_("直属上级关系会形成循环。"))
			seen.add(current)
			current = frappe.db.get_value("Employee", current, "reports_to")

	def _validate_grade_tags(self):
		seen = set()
		for row in self.grade_tags or []:
			if not row.grade_tag or row.grade_tag in seen:
				frappe.throw(_("同一任职关系不能重复选择职级标签。"))
			if row.valid_to and row.valid_from and getdate(row.valid_to) < getdate(row.valid_from):
				frappe.throw(_("职级标签结束日不能早于开始日。"))
			seen.add(row.grade_tag)

	def _validate_primary_position(self):
		position = frappe.get_cached_doc("Organization Position", self.organization_position)
		if position.status != "有效" or position.confirmation_status != "已确认":
			frappe.throw(_("星标主职只能使用已确认且有效的岗位节点。"))
		if not position.department:
			frappe.throw(_("星标主职岗位必须先关联对应部门。"))

	def _validate_no_overlapping_primary(self):
		for assignment in frappe.get_all(
			"Employee Position Assignment",
			filters={"employee": self.employee, "status": ACTIVE_STATUS, "is_primary": 1, "name": ["!=", self.name or ""]},
			fields=["name", "effective_from", "effective_to"],
			limit_page_length=0,
		):
			if _periods_overlap(self.effective_from, self.effective_to, assignment.effective_from, assignment.effective_to):
				frappe.throw(_("该员工在相同有效期间已有星标主职：{0}。").format(assignment.name))


def _periods_overlap(start_a, end_a, start_b, end_b):
	start_a = getdate(start_a)
	start_b = getdate(start_b)
	end_a = getdate(end_a) if end_a else None
	end_b = getdate(end_b) if end_b else None
	return (end_b is None or start_a <= end_b) and (end_a is None or start_b <= end_a)


def sync_employee_primary_assignment(assignment):
	"""Synchronize the only legacy Employee fields that current HRMS rules understand."""
	position = frappe.get_cached_doc("Organization Position", assignment.organization_position)
	employee = frappe.get_doc("Employee", assignment.employee)
	employee.check_permission("write")
	employee.department = position.department
	employee.designation = position.designation or None
	employee.reports_to = assignment.reports_to or position.reports_to_employee or None
	employee.save(ignore_permissions=False)


@frappe.whitelist()
def switch_primary_assignment(assignment_name: str, effective_from: str | None = None):
	"""Atomically replace the active primary assignment and synchronize Employee fields."""
	assignment = frappe.get_doc("Employee Position Assignment", assignment_name)
	assignment.check_permission("write")
	frappe.get_doc("Employee", assignment.employee).check_permission("write")
	effective_from = getdate(effective_from or assignment.effective_from or nowdate())

	for current in frappe.get_all(
		"Employee Position Assignment",
		filters={"employee": assignment.employee, "status": ACTIVE_STATUS, "is_primary": 1, "name": ["!=", assignment.name]},
		fields=["name", "effective_from", "effective_to"],
		limit_page_length=0,
	):
		if _periods_overlap(effective_from, assignment.effective_to, current.effective_from, current.effective_to):
			current_doc = frappe.get_doc("Employee Position Assignment", current.name)
			current_doc.status = "已结束"
			current_doc.effective_to = add_days(effective_from, -1)
			current_doc.is_primary = 0
			current_doc.save(ignore_permissions=False)

	assignment.relationship_type = PRIMARY_TYPE
	assignment.is_primary = 1
	assignment.status = ACTIVE_STATUS
	assignment.effective_from = effective_from
	assignment.save(ignore_permissions=False)
	return {"assignment": assignment.name, "employee": assignment.employee, "effective_from": str(effective_from)}


@frappe.whitelist()
def get_effective_primary_assignment(employee: str, on_date: str | None = None):
	"""Return the only active starred assignment for downstream integrations."""
	frappe.get_doc("Employee", employee).check_permission("read")
	on_date = getdate(on_date or nowdate())
	rows = frappe.get_all(
		"Employee Position Assignment",
		filters={"employee": employee, "status": ACTIVE_STATUS, "is_primary": 1, "effective_from": ["<=", on_date]},
		fields=["name", "organization_position", "effective_from", "effective_to", "reports_to"],
		order_by="effective_from desc",
		limit_page_length=20,
	)
	valid = [row for row in rows if not row.effective_to or getdate(row.effective_to) >= on_date]
	if len(valid) > 1:
		frappe.throw(_("员工 {0} 存在多个有效星标主职。" ).format(cstr(employee)))
	return valid[0] if valid else None
