import test from "node:test"
import assert from "node:assert/strict"

import { normalizeSelectOptions } from "../src/utils/formFieldOptions.js"

test("normalizes newline-delimited select options", () => {
	assert.deepEqual(normalizeSelectOptions("Draft\nApproved"), [
		{ label: "Draft", value: "Draft" },
		{ label: "Approved", value: "Approved" },
	])
})

test("normalizes array select options without throwing", () => {
	assert.deepEqual(normalizeSelectOptions(["Draft", "Cancelled"]), [
		{ label: "Draft", value: "Draft" },
		{ label: "Cancelled", value: "Cancelled" },
	])
})

test("applies translation callback to normalized select options", () => {
	assert.deepEqual(normalizeSelectOptions(["Draft"], (value) => `t:${value}`), [
		{ label: "t:Draft", value: "Draft" },
	])
})
