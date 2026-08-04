import frappe
from frappe import _
from frappe.model.document import Document


API_SYNC_MODE = "内网服务器主动拉取API"


class HRMSDingTalkSettings(Document):
	def validate(self):
		"""Prevent a production pull from being enabled with incomplete credentials.

		The first phase intentionally keeps the integration disabled until HR has
		completed employee mapping and a manual pilot.  Credentials are required
		only for the server-pull mode; Excel import stays usable without them.
		"""
		if self.daily_sync_enabled and not self.enabled:
			frappe.throw(_("请先启用钉钉集成，再启用每日自动同步。"))

		if self.daily_sync_enabled and self.sync_mode != API_SYNC_MODE:
			frappe.throw(_("启用每日自动同步前，请先将同步模式切换为“内网服务器主动拉取API”。"))

		if self.enabled and self.sync_mode == API_SYNC_MODE:
			if not self.company:
				frappe.throw(_("请先选择同步公司（Company）。"))
			if not self.client_id:
				frappe.throw(_("启用 API 同步前，请填写客户端 ID / 应用 Key（Client ID / AppKey）。"))
			if not self.get_password("client_secret", raise_exception=False):
				frappe.throw(_("启用 API 同步前，请填写客户端密钥 / 应用密钥（Client Secret / AppSecret）。"))

		if self.daily_sync_enabled:
			try:
				lookback_days = int(self.sync_lookback_days or 0)
			except (TypeError, ValueError):
				frappe.throw(_("考勤回补天数（Attendance Lookback Days）必须填写数字，并且在 1 到 31 天之间。"))
			if not 1 <= lookback_days <= 31:
				frappe.throw(_("考勤回补天数（Attendance Lookback Days）必须在 1 到 31 天之间。"))
