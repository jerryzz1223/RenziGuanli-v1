import frappe


no_cache = 1


def get_context(context):
	# Return a fresh frappe context so both the CSRF value and the URL token are
	# available even when the public page is rendered without a desk session.
	context = frappe._dict(context or {})
	context.csrf_token = frappe.sessions.get_csrf_token()
	context.token = str(frappe.form_dict.get("token") or "")
	return context
	return context
