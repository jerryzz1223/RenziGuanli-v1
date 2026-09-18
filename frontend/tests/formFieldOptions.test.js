import test from "node:test"
import assert from "node:assert/strict"

import { normalizeSelectOptions } from "../src/utils/formFieldOptions.js"

test("normalizes newline-delimited select options", () => {
	assert.deepEqual(normalizeSelectOptions("Draft\nApproved"), [
		{ label: "Draft", value: "Draft" },
		{ label: "Approved", value: "Approved" },
	])
})

test("normalizes Windows newline-delimited select options without trailing carriage returns", () => {
	assert.deepEqual(normalizeSelectOptions("Draft\r\nApproved\r\nRejected"), [
		{ label: "Draft", value: "Draft" },
		{ label: "Approved", value: "Approved" },
		{ label: "Rejected", value: "Rejected" },
	])
})

test("drops only trailing empty options created by a final newline", () => {
	assert.deepEqual(normalizeSelectOptions("\nDraft\nApproved\n"), [
		{ label: "", value: "" },
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

test("preserves falsy option values used for clearing and boolean or numeric selections", () => {
	assert.deepEqual(
		normalizeSelectOptions([null, 0, false, "", undefined]),
		[
			{ label: 0, value: 0 },
			{ label: false, value: false },
			{ label: "", value: "" },
		]
	)
	assert.deepEqual(
		normalizeSelectOptions([
			{ label: "Zero", value: 0 },
			{ label: "No", value: false },
			{ label: "Clear", value: "" },
		]),
		[
			{ label: "Zero", value: 0 },
			{ label: "No", value: false },
			{ label: "Clear", value: "" },
		]
	)
})

test("falls back between labels and values without translating submitted values or mutating input", () => {
	const options = Object.freeze([
		Object.freeze({ value: "Draft", disabled: true }),
		Object.freeze({ label: "Approved" }),
		Object.freeze({ label: "", value: "blank-label" }),
		Object.freeze({ value: 0 }),
	])
	const translated = []
	const result = normalizeSelectOptions(options, (label) => {
		translated.push(label)
		return `t:${label}`
	})
	assert.deepEqual(result, [
		{ label: "t:Draft", value: "Draft", disabled: true },
		{ label: "t:Approved", value: "Approved" },
		{ label: "t:", value: "blank-label" },
		{ label: 0, value: 0 },
	])
	assert.deepEqual(translated, ["Draft", "Approved", ""])
	assert.deepEqual(options[0], { value: "Draft", disabled: true })
	assert.deepEqual(options[1], { label: "Approved" })
})

test("keeps the leading clear choice with Windows newlines and returns no choices for absent options", () => {
	assert.deepEqual(normalizeSelectOptions("\r\nDraft\r\n\r\n"), [
		{ label: "", value: "" },
		{ label: "Draft", value: "Draft" },
	])
	for (const options of [undefined, null, "", []]) {
		assert.deepEqual(normalizeSelectOptions(options), [])
	}
})
