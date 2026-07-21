import frappe
from frappe import _
from frappe.model.document import Document


class HRMSDingTalkSettings(Document):
	def validate(self):
		"""Prevent a production pull from being enabled with incomplete credentials.

		The first phase intentionally keeps the integration disabled until HR has
		completed employee mapping and a manual pilot.  Credentials are required
		only for the server-pull mode; Excel import stays usable without them.
		"""
		if self.daily_sync_enabled and not self.enabled:
			frappe.throw(_("请先启用钉钉集成，再启用每日自动同步。"))

		if self.enabled and self.sync_mode == "内网服务器主动拉取API":
			if not self.company:
				frappe.throw(_("请先选择同步公司（Company）。"))
			if not self.client_id:
				frappe.throw(_("启用 API 同步前，请填写客户端 ID / 应用 Key（Client ID / AppKey）。"))
			if not self.get_password("client_secret", raise_exception=False):
				frappe.throw(_("启用 API 同步前，请填写客户端密钥 / 应用密钥（Client Secret / AppSecret）。"))

		if self.daily_sync_enabled:
			lookback_days = int(self.sync_lookback_days or 0)
			if not 1 <= lookback_days <= 31:
				frappe.throw(_("考勤回补天数（Attendance Lookback Days）必须在 1 到 31 天之间。"))
