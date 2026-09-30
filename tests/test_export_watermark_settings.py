from __future__ import annotations

import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


PATH = Path(__file__).resolve().parents[1] / "hrms" / "utils" / "export_watermark_settings.py"


class ExportWatermarkSettingsTest(unittest.TestCase):
	def setUp(self):
		self.values = {}
		self.roles = []
		frappe = types.ModuleType("frappe")
		frappe.db = types.SimpleNamespace(
			get_default=lambda key: self.values.get(key),
			set_default=lambda key, value: self.values.__setitem__(key, value),
		)
		frappe.only_for = self.roles.append
		frappe.parse_json = json.loads
		frappe.whitelist = lambda *args, **kwargs: (lambda function: function)
		frappe.throw = lambda message: (_ for _ in ()).throw(ValueError(message))
		with patch.dict(sys.modules, {"frappe": frappe}):
			spec = importlib.util.spec_from_file_location("watermark_settings_test", PATH)
			self.module = importlib.util.module_from_spec(spec)
			spec.loader.exec_module(self.module)

	def test_every_attendance_export_profile_has_a_switch(self):
		profiles = {
			"company_attendance_workbook", "daily_statistics", "attendance_detail", "leave_evidence",
			"attendance_exception", "missing_card", "apple_reward", "monthly_draft", "monthly_signed", "monthly_finance",
		}
		self.assertTrue({f"attendance_export_{name}" for name in profiles} <= set(self.module.EXPORT_DEFAULTS))
		self.assertFalse(self.module.EXPORT_DEFAULTS["attendance_exceptions"])
		self.assertFalse(self.module.EXPORT_DEFAULTS["organization_configuration"])

	def test_save_rejects_missing_rows_and_persists_print_choice(self):
		rules = {key: {"export": False, "print": False} for key in self.module.EXPORT_DEFAULTS}
		with self.assertRaisesRegex(ValueError, "刷新"):
			self.module.save_export_watermark_settings("测试", 15, json.dumps({"roster": rules["roster"]}))
		rules["roster"] = {"export": True, "print": True}
		result = self.module.save_export_watermark_settings("测试", 15, json.dumps(rules))
		self.assertEqual(self.roles, ["System Manager", "System Manager", "System Manager"])
		stored = json.loads(self.values[self.module.SETTINGS_DEFAULT_KEY])
		self.assertEqual(stored["text"], "测试")
		self.assertEqual(stored["opacity"], 15)
		self.assertTrue(next(row for row in result["exports"] if row["key"] == "roster")["print"])
		self.assertFalse(self.module.get_export_watermark_options("attendance_exceptions")["export"])
