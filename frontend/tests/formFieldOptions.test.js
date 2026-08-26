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

test("preserves pre-normalized select option objects", () => {
	assert.deepEqual(
		normalizeSelectOptions([
			{ label: "Approved", value: "approved" },
			{ label: "Rejected", value: "rejected", disabled: true },
		]),
		[
			{ label: "Approved", value: "approved" },
			{ label: "Rejected", value: "rejected", disabled: true },
		]
	)
})

test("filters nullish array entries while normalizing option objects", () => {
	assert.deepEqual(
		normalizeSelectOptions([null, undefined, { label: "Draft", value: "draft" }], (value) => `t:${value}`),
		[{ label: "t:Draft", value: "draft" }]
	)
})
