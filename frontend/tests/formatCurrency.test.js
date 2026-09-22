import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"

const source = readFileSync(new URL("../src/utils/formatters.js", import.meta.url), "utf8")
// Keep the actual formatter and native Intl implementation. Only replace the
// resource/import boundary so these tests need neither a Frappe site nor Vue.
const script = new vm.Script(source
	.replace(/^import .* from .*$/gm, "")
	.replace(/^export const /gm, "const ")
	+ "\nformatCurrency")

function setup(doc) {
	const settings = { doc }
	const context = vm.createContext({
		Intl,
		createDocumentResource: (options) => {
			assert.equal(options.doctype, "System Settings")
			assert.equal(options.auto, false)
			return settings
		},
	})
	return { settings, formatCurrency: script.runInContext(context) }
}

test("currency display preserves zero, credits, decimals, and numeric API strings", () => {
	const { formatCurrency } = setup({ language: "en-US" })
	for (const [value, expected] of [
		[0, "$ 0"],
		[1234, "$ 1,234"],
		[1234.5, "$ 1,234.50"],
		[-1234.5, "-$ 1,234.50"],
		["1234.50", "$ 1,234.50"],
	]) {
		assert.equal(formatCurrency(value, "USD"), expected)
	}
})

test("India uses lakh grouping even when the UI language is English US", () => {
	const { formatCurrency } = setup({ country: "India", language: "en-US" })
	assert.equal(formatCurrency(1234567, "INR"), "₹ 12,34,567")
})

test("currency display uses current settings when they load or change", () => {
	const { settings, formatCurrency } = setup(undefined)
	// The host locale can vary; formatting before settings load must still work.
	assert.equal(typeof formatCurrency(1234.5, "EUR"), "string")
	settings.doc = { country: "Germany", language: "de-DE" }
	assert.equal(formatCurrency(1234.5, "EUR"), "1.234,50 €")
	settings.doc = { country: "United States", language: "en-US" }
	assert.equal(formatCurrency(1234.5, "EUR"), "€ 1,234.50")
})

test("missing currency and already formatted values survive repeated formatting", () => {
	const { formatCurrency } = setup({ language: "en-US" })
	for (const value of [0, 1234.5, "1234.50", null, undefined]) {
		assert.equal(formatCurrency(value), value)
		assert.equal(formatCurrency(value, ""), value)
	}
	for (const value of ["$ 1,234.50", "₹ 12,34,567", "1.234,50 €"]) {
		assert.equal(formatCurrency(value, "USD"), value)
	}
	const formatted = formatCurrency(1234.5, "USD")
	assert.equal(formatCurrency(formatted, "USD"), formatted)
})
