import test from "node:test"
import assert from "node:assert/strict"
import dayjs from "dayjs"

import { TIME_WITH_MERIDIEM_FORMAT } from "../src/utils/timeFormats.js"

test("formats afternoon times with a 12-hour clock when meridiem is shown", () => {
	assert.equal(dayjs("2026-08-12 13:05:00").format(TIME_WITH_MERIDIEM_FORMAT), "01:05 pm")
})

test("formats midnight times consistently when meridiem is shown", () => {
	assert.equal(dayjs("2026-08-12 00:15:00").format(TIME_WITH_MERIDIEM_FORMAT), "12:15 am")
})
