function normalizeSelectOption(option, translate) {
	if (option == null) {
		return null
	}

	if (typeof option === "object" && !Array.isArray(option)) {
		const value = option.value ?? option.label
		const label = option.label ?? value

		return {
			...option,
			label: typeof label === "string" ? translate(label) : label,
			value,
		}
	}

	return {
		label: translate(option),
		value: option,
	}
}

export function normalizeSelectOptions(options, translate = (value) => value) {
	if (Array.isArray(options)) {
		return options
			.map((option) => normalizeSelectOption(option, translate))
			.filter(Boolean)
	}

	if (typeof options === "string" && options.length) {
		const lines = options.split("\n").map((option) => option.replace(/\r$/, ""))

		while (lines.length > 1 && lines.at(-1) === "") {
			lines.pop()
		}

		return lines.map((option) => ({
			label: translate(option),
			value: option,
		}))
	}

	return []
}
