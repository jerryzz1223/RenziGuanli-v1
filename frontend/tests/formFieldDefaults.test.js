import test from "node:test"
import assert from "node:assert/strict"

import { hasFormFieldValue } from "../src/utils/formFieldDefaults.js"

test("keeps falsy field values so defaults do not overwrite saved selections", () => {
	assert.equal(hasFormFieldValue(0), true)
	assert.equal(hasFormFieldValue(false), true)
})

test("allows defaults only when a field has no value or an empty string", () => {
	for (const value of [undefined, null, ""]) {
		assert.equal(hasFormFieldValue(value), false)
	}
})
