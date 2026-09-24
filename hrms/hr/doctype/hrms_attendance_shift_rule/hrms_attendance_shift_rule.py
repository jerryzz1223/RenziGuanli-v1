import re

import frappe
from frappe import _
from frappe.model.document import Document


def _clock_values(value):
	return re.findall(r"(?<!\d)([01]?\d|2[0-4])\s*[:：]\s*([0-5]\d)(?!\d)", value or "")


def _valid_night_rule(value):
	text = re.sub(r"\s+", "", value or "").replace("：", ":")
	if not text or text == "无":
		return True
	has_hours = bool(re.search(r"(?:>=|≥|满)\d+(?:\.\d+)?(?:小时|H)", text, re.IGNORECASE))
	clocks = _clock_values(text)
	if not clocks:
		clocks = [(hour, "00") for hour in re.findall(r"(?<!\d)([01]?\d|2[0-4])点", text)]
	has_supported_clock_rule = ("之间" in text and len(clocks) >= 2) or any(token in text for token in ("晚于", ">=", "≥")) and len(clocks) >= 1
	return has_hours and has_supported_clock_rule


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
		if (getattr(self, "extended_overtime_mode", "") or "") not in allowed_modes:
			frappe.throw(_("固定加班后续来源只能选择“不提交加班单、加班单或无”。"))
		approval_time_modes = {"仅确认已匹配审批", "有审批时段则校验", "必须覆盖实际下班"}
		if (getattr(self, "overtime_approval_time_mode", "") or "有审批时段则校验") not in approval_time_modes:
			frappe.throw(_("加班审批时间校验方式无效。"))
		if int(getattr(self, "overtime_approval_reapply_minutes", 30) or 0) < 0:
			frappe.throw(_("审批结束后再次申请阈值不能小于 0 分钟。"))
		if self.weekday_overtime_mode == "不提交加班单" and (self.weekday_overtime_hours or 0) <= 0:
			frappe.throw(_("平日免提交加班单时，必须填写大于 0 的自动加班小时。"))
		if self.weekday_overtime_mode == "无" and (self.weekday_overtime_hours or 0) > 0:
			frappe.throw(_("平日加班来源为“无”时，自动加班小时必须为 0。"))
		if getattr(self, "extended_overtime_mode", "") == "不提交加班单" and self.weekday_overtime_mode != "不提交加班单":
			frappe.throw(_("后续免申请仅适用于已配置平日固定自动加班的班次。"))
		if getattr(self, "extended_overtime_mode", "") == "不提交加班单" and not self.weekday_overtime_time:
			frappe.throw(_("后续免申请必须先配置平日固定加班结束时间。"))
		for fieldname, label in (
			("basic_time", "基本工时上下班时间"),
			("weekday_overtime_time", "平日加班起止时间"),
			("weekend_overtime_time", "周末加班起止时间"),
			("special_workday_time", "平日特殊工时时段"),
		):
			value = getattr(self, fieldname, "") or ""
			clocks = _clock_values(value)
			if value and (len(clocks) < 2 or len(clocks) % 2):
				frappe.throw(_("{0}必须由完整的 HH:MM-HH:MM 时间段组成。").format(label))
			if any(int(hour) == 24 and int(minute) != 0 for hour, minute in clocks):
				frappe.throw(_("24点只能写成 24:00。"))
			if fieldname == "special_workday_time" and value and not re.fullmatch(
				r"\s*(?:[01]?\d|2[0-3]):[0-5]\d\s*[-–—]\s*(?:次日)?(?:[01]?\d|2[0-4]):[0-5]\d\s*",
				str(value).replace("：", ":"),
			):
				frappe.throw(_("平日特殊工时时段只能填写一个 HH:MM-HH:MM 时间段。"))
		if self.overtime_begin_time and len(_clock_values(str(self.overtime_begin_time))) != 1:
			frappe.throw(_("班后开始加班时间必须使用 HH:MM 固定格式。"))
		for fieldname, label in (
			("punch_in_range", "可取上班卡时段"),
			("punch_out_range", "可取下班卡时段"),
		):
			value = getattr(self, fieldname, "") or ""
			matches = _clock_values(value)
			if value and len(matches) != 2:
				frappe.throw(_("{0}必须使用 HH:MM-HH:MM 固定格式，可在结束时间前写“次日”。").format(label))
			if any(int(hour) == 24 and int(minute) != 0 for hour, minute in matches):
				frappe.throw(_("24点只能写成 24:00。"))
		for fieldname, label in (("small_night_rule", "小夜班规则"), ("large_night_rule", "大夜班规则")):
			if not _valid_night_rule(getattr(self, fieldname, "") or ""):
				frappe.throw(_("{0}必须同时包含最低工时和可执行的下班条件，例如“满8小时且下班时间在04:30-07:59之间”或“>=11.5小时且下班时间等于或晚于08:00”。").format(label))
		existing = frappe.db.get_value(
			self.doctype,
			{"company": self.company, "rule_code": self.rule_code},
			"name",
		)
		if existing and existing != self.name:
			frappe.throw(_("该公司的班次规则编码已存在：{0}").format(self.rule_code))
