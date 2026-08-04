from collections.abc import Generator

import requests

import frappe
from frappe.utils import add_days, date_diff

country_info = {}
DEFAULT_COUNTRY_FIELDS = ("countryCode", "country", "regionName", "city")
IP_API_TIMEOUT_IN_SECONDS = 5


def _normalize_country_fields(fields: list[str] | tuple[str, ...] | str | None) -> tuple[str, ...]:
	if fields is None:
		return DEFAULT_COUNTRY_FIELDS

	raw_fields = fields.split(",") if isinstance(fields, str) else fields
	normalized_fields = tuple(dict.fromkeys(field.strip() for field in raw_fields if field and field.strip()))

	return normalized_fields or DEFAULT_COUNTRY_FIELDS


@frappe.whitelist(allow_guest=True)
def get_country(fields: list[str] | tuple[str, ...] | str | None = None) -> dict:
	global country_info
	ip = frappe.local.request_ip
	requested_fields = _normalize_country_fields(fields)
	cache_key = (ip, requested_fields)

	if cache_key not in country_info:
		try:
			res = requests.get(
				"https://pro.ip-api.com/json/{ip}?key={key}&fields={fields}".format(
					ip=ip, key=frappe.conf.get("ip-api-key"), fields=",".join(requested_fields)
				),
				timeout=IP_API_TIMEOUT_IN_SECONDS,
			)
			res.raise_for_status()
			country_info[cache_key] = res.json()

		except (requests.RequestException, ValueError):
			country_info[cache_key] = {}

	return country_info[cache_key]


def get_date_range(start_date: str, end_date: str) -> list[str]:
	"""returns list of dates between start and end dates"""
	no_of_days = date_diff(end_date, start_date) + 1
	return [add_days(start_date, i) for i in range(no_of_days)]


def generate_date_range(start_date: str, end_date: str, reverse: bool = False) -> Generator[str, None, None]:
	no_of_days = date_diff(end_date, start_date) + 1

	date_field = end_date if reverse else start_date
	direction = -1 if reverse else 1

	for n in range(no_of_days):
		yield add_days(date_field, direction * n)


def get_employee_email(employee_id: str) -> str | None:
	employee_emails = frappe.db.get_value(
		"Employee",
		employee_id,
		["prefered_email", "user_id", "company_email", "personal_email"],
		as_dict=True,
	)

	if not employee_emails:
		return None

	return (
		employee_emails.prefered_email
		or employee_emails.user_id
		or employee_emails.company_email
		or employee_emails.personal_email
	)
