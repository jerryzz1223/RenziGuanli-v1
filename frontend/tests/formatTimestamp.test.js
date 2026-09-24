import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"

const source = readFileSync(new URL("../src/utils/formatters.js", import.meta.url), "utf8")
const script = new vm.Script(
	source.replace(/^import .* from .*$/gm, "").replace(/^export const /gm, "const ")
		+ "\nformatTimestamp",
)

function setupTimestamp(timestamp) {
	const calls = []
	const parsedTimestamp = {
		format(format) {
			return {
				"hh:mm a": "01:05 pm",
				"D MMM": "12 Aug",
				"D MMM, YYYY": "12 Aug, 2025",
			}[format]
		},
		isToday: () => false,
		isYesterday: () => false,
		isSame: (_other, unit) => unit === "year",
	}
	const dayjs = (value) => {
		calls.push(value)
		return value === timestamp ? parsedTimestamp : {}
	}
	const formatTimestamp = script.runInNewContext({
		dayjs,
		createDocumentResource: () => ({}),
		TIME_WITH_MERIDIEM_FORMAT: "hh:mm a",
	})
	return { calls, formatTimestamp }
}

test("timestamp formatting parses a record once before choosing its date label", () => {
	const timestamp = "2026-08-12 13:05:00"
	const { calls, formatTimestamp } = setupTimestamp(timestamp)

	assert.equal(formatTimestamp(timestamp), "01:05 pm on 12 Aug")
	assert.deepEqual(calls, [timestamp, undefined])
})
