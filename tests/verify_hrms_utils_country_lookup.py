#!/usr/bin/env python3
"""Contract checks for the lightweight `hrms.utils.get_country` helper."""

from __future__ import annotations

import importlib.util
import sys
import types
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = PROJECT_ROOT / "hrms" / "utils" / "__init__.py"


def load_hrms_utils_module():
	module_name = "hrms_utils_country_lookup_contract"
	for key in (module_name, "frappe", "frappe.utils"):
		sys.modules.pop(key, None)

	frappe_module = types.ModuleType("frappe")
	frappe_module.local = types.SimpleNamespace(request_ip="203.0.113.9")
	frappe_module.conf = types.SimpleNamespace(get=lambda _key: "test-key")
	frappe_module.db = types.SimpleNamespace(get_value=lambda *args, **kwargs: None)

	def whitelist(**_kwargs):
		def decorator(func):
			return func

		return decorator

	frappe_module.whitelist = whitelist

	utils_module = types.ModuleType("frappe.utils")
	utils_module.add_days = lambda date_str, days: (date.fromisoformat(date_str) + timedelta(days=days)).isoformat()
	utils_module.date_diff = lambda end_date, start_date: (
		date.fromisoformat(end_date) - date.fromisoformat(start_date)
	).days

	sys.modules["frappe"] = frappe_module
	sys.modules["frappe.utils"] = utils_module

	spec = importlib.util.spec_from_file_location(module_name, MODULE_PATH)
	module = importlib.util.module_from_spec(spec)
	assert spec.loader is not None
	spec.loader.exec_module(module)
	return module


def test_get_country_uses_timeout_and_caches_by_requested_fields():
	module = load_hrms_utils_module()
	module.country_info.clear()
	request_log = []

	def fake_get(url, timeout):
		request_log.append((url, timeout))
		return types.SimpleNamespace(
			raise_for_status=lambda: None,
			json=lambda: {"url": url, "timeout": timeout},
		)

	with patch.object(module.requests, "get", side_effect=fake_get):
		default_result = module.get_country()
		custom_result = module.get_country(["country"])
		custom_result_again = module.get_country(["country"])

	assert "fields=countryCode,country,regionName,city" in default_result["url"]
	assert "fields=country" in custom_result["url"]
	assert custom_result == custom_result_again
	assert request_log == [
		(default_result["url"], module.IP_API_TIMEOUT_IN_SECONDS),
		(custom_result["url"], module.IP_API_TIMEOUT_IN_SECONDS),
	]


def test_get_country_returns_empty_dict_on_request_failure():
	module = load_hrms_utils_module()
	module.country_info.clear()

	with patch.object(module.requests, "get", side_effect=module.requests.Timeout("timed out")):
		assert module.get_country(["country"]) == {}
		assert module.get_country(["country"]) == {}


def test_get_country_skips_lookup_without_request_ip():
	module = load_hrms_utils_module()
	module.country_info.clear()
	module.frappe.local = types.SimpleNamespace()

	with patch.object(module.requests, "get") as mocked_get:
		assert module.get_country(["country"]) == {}

	mocked_get.assert_not_called()


if __name__ == "__main__":
	test_get_country_uses_timeout_and_caches_by_requested_fields()
	test_get_country_returns_empty_dict_on_request_failure()
	test_get_country_skips_lookup_without_request_ip()
	print("hrms utils country lookup contract passed.")
