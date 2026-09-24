import { createDocumentResource } from "frappe-ui"

import dayjs from "@/utils/dayjs"
import { TIME_WITH_MERIDIEM_FORMAT } from "@/utils/timeFormats"

const settings = createDocumentResource({
	doctype: "System Settings",
	name: "System Settings",
	auto: false,
})

export const formatCurrency = (value, currency) => {
	if (!currency) return value

	// hack: if value contains a space, it is already formatted
	if (value?.toString().trim().includes(" ")) return value

	const locale = settings.doc?.country == "India" ? "en-IN" : settings.doc?.language

	const formatter = Intl.NumberFormat(locale, {
		style: "currency",
		currency: currency,
		trailingZeroDisplay: "stripIfInteger",
		currencyDisplay: "narrowSymbol",
	})
	return (
		formatter
			.format(value)
			// add space between the digits and symbol
			.replace(/^(\D+)/, "$1 ")
			// remove extra spaces if any (added by some browsers)
			.replace(/\s+/, " ")
	)
}

export const formatTimestamp = (timestamp) => {
	const parsedTimestamp = dayjs(timestamp)
	const formattedTime = parsedTimestamp.format(TIME_WITH_MERIDIEM_FORMAT)

	if (parsedTimestamp.isToday()) return formattedTime
	else if (parsedTimestamp.isYesterday()) return `${formattedTime} yesterday`
	else if (parsedTimestamp.isSame(dayjs(), "year"))
		return `${formattedTime} on ${parsedTimestamp.format("D MMM")}`

	return `${formattedTime} on ${parsedTimestamp.format("D MMM, YYYY")}`
}
