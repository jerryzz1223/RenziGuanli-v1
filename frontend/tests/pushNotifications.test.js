import test from "node:test"
import assert from "node:assert/strict"

import { showNotification } from "../src/utils/pushNotifications.js"

function mockBrowser(t, userAgent, registration) {
	for (const [name, value] of Object.entries({
		window: { frappePushNotification: { serviceWorkerRegistration: registration } },
		navigator: { userAgent },
	})) {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
		Object.defineProperty(globalThis, name, { configurable: true, value })
		t.after(() => {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor)
			else delete globalThis[name]
		})
	}
}

test("ignores notifications while the service worker is not registered", (t) => {
	mockBrowser(t, "Chrome/128", undefined)
	assert.doesNotThrow(() => showNotification({ data: { title: "待审批" } }))
})

test("ignores notifications when the push client is unavailable", (t) => {
	mockBrowser(t, "Chrome/128", undefined)
	delete window.frappePushNotification
	assert.doesNotThrow(() => showNotification({ data: { title: "待审批" } }))
	window.frappePushNotification = null
	assert.doesNotThrow(() => showNotification({ data: { title: "待审批" } }))
})

test("Chrome notifications carry the destination in data and preserve message fields", (t) => {
	const calls = []
	mockBrowser(t, "Mozilla/5.0 Chrome/128.0.0.0 Safari/537.36", {
		showNotification: (...args) => calls.push(args),
	})
	showNotification({
		data: {
			title: "待审批",
			body: "你有一条新的申请",
			notification_icon: "/assets/hrms/icon.png",
			click_action: "/hrms/leave-applications",
		},
	})
	assert.deepEqual(calls, [["待审批", {
		body: "你有一条新的申请",
		icon: "/assets/hrms/icon.png",
		data: { url: "/hrms/leave-applications" },
	}]])
})

test("non-Chrome notifications expose a details action for the destination", (t) => {
	const calls = []
	mockBrowser(t, "Mozilla/5.0 Firefox/130.0", {
		showNotification: (...args) => calls.push(args),
	})
	showNotification({ data: { title: "待审批", click_action: "/hrms/leave-applications" } })
	assert.deepEqual(calls, [["待审批", {
		body: "",
		actions: [{ action: "/hrms/leave-applications", title: "View Details" }],
	}]])
})

test("non-Chrome notifications omit optional fields when no destination is provided", (t) => {
	const calls = []
	mockBrowser(t, "Mozilla/5.0 Firefox/130.0", {
		showNotification: (...args) => calls.push(args),
	})
	showNotification({ data: { title: "通知" } })
	assert.deepEqual(calls, [["通知", { body: "" }]])
})
