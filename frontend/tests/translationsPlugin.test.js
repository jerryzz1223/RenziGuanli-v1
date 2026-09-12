import test from "node:test"
import assert from "node:assert/strict"

import { formatTranslationTemplate, translationsPlugin } from "../src/plugins/translationsPlugin.js"

test("untranslated prototype property names remain plain text", () => {
	const app = { config: { globalProperties: {} }, provide() {} }
	translationsPlugin.install(app)
	const translate = app.config.globalProperties.__

	for (const text of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
		assert.equal(translate(text), text)
		assert.equal(translate(text, {}, "missing-context"), text)
	}
})

test("loads own translations and preserves context and placeholder fallbacks", async () => {
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
	globalThis.window = {
		frappe: {
			boot: {
				__messages: {
					constructor: "构造函数",
					"Welcome {0}": "欢迎 {0}",
					Open: "打开",
					"Open:status": "待处理",
				},
			},
		},
	}
	try {
		await translationsPlugin.isReady()
		const app = { config: { globalProperties: {} }, provide() {} }
		translationsPlugin.install(app)
		const translate = app.config.globalProperties.__
		assert.equal(translate("constructor"), "构造函数")
		assert.equal(translate("Welcome {0}", ["王工"]), "欢迎 王工")
		assert.equal(translate("Open", null, "status"), "待处理")
		assert.equal(translate("Open", null, "missing"), "打开")
		assert.equal(translate("toString"), "toString")
	} finally {
		globalThis.window.frappe.boot.__messages = {}
		await translationsPlugin.isReady()
		if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow)
		else delete globalThis.window
	}
})

test("formats positional translation placeholders", () => {
	assert.equal(formatTranslationTemplate("{0} 已审批，{1} 待处理", ["3", "2"]), "3 已审批，2 待处理")
})

test("formats named translation placeholders", () => {
	assert.equal(
		formatTranslationTemplate("欢迎你，{name}。你有 {count} 条通知。", {
			name: "王工",
			count: 5,
		}),
		"欢迎你，王工。你有 5 条通知。"
	)
})

test("keeps unknown placeholders unchanged", () => {
	assert.equal(
		formatTranslationTemplate("欢迎你，{name}。部门：{department}", { name: "王工" }),
		"欢迎你，王工。部门：{department}"
	)
})
