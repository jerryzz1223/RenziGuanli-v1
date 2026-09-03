import frappe
from werkzeug.exceptions import abort
from werkzeug.wrappers import Response


BLANK_BRAND_ASSET = "/assets/hrms/images/blank-brand.svg"
DEFAULT_DESK_BRAND_ASSET = "/assets/hrms/images/yongxin-brand-mark-red.png"
LEGACY_DESK_BRAND_ASSET = "/assets/hrms/images/yongxin-brand-mark.png"
DEFAULT_SPLASH_BRAND_ASSET = "/assets/hrms/images/yongxin-brand-mark.png"


def serve_blank_for_undefined_image():
	"""Short-circuit Frappe's transient invalid Desk image instead of rendering Desk HTML."""
	request = getattr(frappe.local, "request", None)
	if not request or request.path != "/desk/undefined":
		return
	destination = str(request.headers.get("Sec-Fetch-Dest") or "").lower()
	accept = str(request.headers.get("Accept") or "").lower()
	if destination == "image" or accept.startswith("image/"):
		abort(Response(status=204))


def _set_supported_single_values(doctype, values):
	"""Set branding options without assuming every supported Frappe version has every field."""
	meta = frappe.get_meta(doctype)
	for fieldname, value in values.items():
		if meta.has_field(fieldname):
			frappe.db.set_single_value(doctype, fieldname, value)


def ensure_default_desk_branding():
	"""Set Yongxin's initial Desk logo without overwriting a later admin upload."""
	meta = frappe.get_meta("Navbar Settings")
	if not meta.has_field("app_logo"):
		return
	current = frappe.db.get_single_value("Navbar Settings", "app_logo")
	if not current or current in {BLANK_BRAND_ASSET, LEGACY_DESK_BRAND_ASSET}:
		frappe.db.set_single_value("Navbar Settings", "app_logo", DEFAULT_DESK_BRAND_ASSET)


def apply_login_page_customizations():
	"""Keep login neutral while using the Yongxin mark for the Desk splash screen."""
	_set_supported_single_values(
		"Website Settings",
		{
			"app_name": "人资管理系统",
			"app_logo": BLANK_BRAND_ASSET,
			"favicon": BLANK_BRAND_ASSET,
			"splash_image": DEFAULT_SPLASH_BRAND_ASSET,
		},
	)
	ensure_default_desk_branding()
	_set_supported_single_values(
		"System Settings",
		{
			"allow_login_using_user_name": 1,
			"login_with_email_link": 0,
		},
	)

	frappe.clear_cache()
	return {
		"app_logo": BLANK_BRAND_ASSET,
		"favicon": BLANK_BRAND_ASSET,
		"login_method": "username_password",
	}
