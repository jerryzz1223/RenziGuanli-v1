"""Match explicit profile abbreviations against the field's allowed values."""


PROFILE_FIELDS = ("custom_ethnicity", "custom_native_place")
NATIVE_PLACE_ALIASES = {
	"内蒙古": "内蒙古自治区",
	"广西": "广西壮族自治区",
	"西藏": "西藏自治区",
	"宁夏": "宁夏回族自治区",
	"新疆": "新疆维吾尔自治区",
	"香港": "香港特别行政区",
	"澳门": "澳门特别行政区",
}


def normalise_profile_value(fieldname, value, options):
	"""Only expand unambiguous names; leave unknown values for Select validation."""
	if fieldname not in PROFILE_FIELDS or value is None:
		return value
	text = str(value).strip()
	if isinstance(options, str):
		options = options.splitlines()
	allowed = {str(option).strip() for option in (options or ()) if str(option).strip()}
	if not text or text in allowed:
		return text
	if fieldname == "custom_ethnicity":
		candidates = {text + "族"}
	else:
		candidates = {text + "省", text + "市", NATIVE_PLACE_ALIASES.get(text)}
	matches = candidates & allowed
	return matches.pop() if len(matches) == 1 else text


def normalise_employee_profile(employee):
	for fieldname in PROFILE_FIELDS:
		field = employee.meta.get_field(fieldname)
		if field and field.fieldtype == "Select":
			employee.set(fieldname, normalise_profile_value(fieldname, employee.get(fieldname), field.options))
