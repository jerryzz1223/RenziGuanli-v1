import re

import frappe
from frappe import _
from frappe.model.document import Document


class HRMSAttendanceShiftRule(Document):
	def validate(self):
		self.rule_code = (self.rule_code or "").strip()
		self.rule_name = (self.rule_name or "").strip()
		self.match_tokens = (self.match_tokens or "").strip()
		if not self.rule_code or not self.rule_name or not self.match_tokens:
			frappe.throw(_("规则编码、规则名称和班次匹配关键词不能为空。"))
		for fieldname in ("basic_hours", "weekday_overtime_hours"):
			if (getattr(self, fieldname, 0) or 0) < 0:
				frappe.throw(_("工时不能小于 0。"))
		allowed_modes = {"", "不提交加班单", "加班单", "无"}
		for fieldname in ("weekday_overtime_mode", "weekend_overtime_mode", "holiday_overtime_mode"):
			if (getattr(self, fieldname, "") or "") not in allowed_modes:
				frappe.throw(_("加班来源只能选择“不提交加班单、加班单或无”。"))
		if self.weekday_overtime_mode == "不提交加班单" and (self.weekday_overtime_hours or 0) <= 0:
			frappe.throw(_("平日免提交加班单时，必须填写大于 0 的自动加班小时。"))
		if self.weekday_overtime_mode == "无" and (self.weekday_overtime_hours or 0) > 0:
			frappe.throw(_("平日加班来源为“无”时，自动加班小时必须为 0。"))
		for fieldname, label in (
			("punch_in_range", "可取上班卡时段"),
			("punch_out_range", "可取下班卡时段"),
		):
			value = getattr(self, fieldname, "") or ""
			matches = re.findall(r"(?<!\d)([01]?\d|2[0-4])\s*[:：]\s*([0-5]\d)(?!\d)", value)
			if value and len(matches) != 2:
				frappe.throw(_("{0}必须使用 HH:MM-HH:MM 固定格式，可在结束时间前写“次日”。").format(label))
			if any(int(hour) == 24 and int(minute) != 0 for hour, minute in matches):
				frappe.throw(_("24点只能写成 24:00。"))
		existing = frappe.db.get_value(
			self.doctype,
			{"company": self.company, "rule_code": self.rule_code},
			"name",
		)
		if existing and existing != self.name:
			frappe.throw(_("该公司的班次规则编码已存在：{0}").format(self.rule_code))
