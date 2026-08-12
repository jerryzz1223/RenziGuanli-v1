export function normalizeSelectOptions(options, translate = (value) => value) {
	if (Array.isArray(options)) {
		return options.map((option) => ({
			label: translate(option),
			value: option,
		}))
	}

	if (typeof options === "string" && options.length) {
		return options.split("\n").map((option) => ({
			label: translate(option),
			value: option,
		}))
	}

	return []
}
