import test from "node:test"
import assert from "node:assert/strict"

import { formatTranslationTemplate } from "../src/plugins/translationsPlugin.js"

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
