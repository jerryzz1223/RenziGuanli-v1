import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"

const source = readFileSync(new URL("../src/utils/commonUtils.js", import.meta.url), "utf8")
// Replace only the UI dependency/export wrapper; execute the real helper in an
// isolated browser context without requiring Vue or changing process globals.
assert.match(source, /^import \{ toast \} from "frappe-ui"/)
const script = new vm.Script(source
	.replace(/^import \{ toast \} from "frappe-ui"/, "")
	.replace("export function useDownloadPDF", "function useDownloadPDF")
	+ "\nuseDownloadPDF")

function setup(fetchResponse, csrfToken = "test-token", downloadFailure = null) {
	const calls = { requests: [], toasts: [], blobs: [], revoked: [], timers: [], clicks: [] }
	const context = vm.createContext({
		URLSearchParams,
		Error,
		toast: (message) => calls.toasts.push(message),
		fetch: async (...args) => {
			calls.requests.push(args)
			return fetchResponse()
		},
		window: {
			location: { hostname: "hr.example.test" },
			csrf_token: csrfToken,
			URL: {
				createObjectURL: (blob) => { calls.blobs.push(blob); return "blob:test-pdf" },
				revokeObjectURL: (url) => calls.revoked.push(url),
			},
		},
		document: {
			createElement: (tag) => {
				assert.equal(tag, "a")
				if (downloadFailure === "create") throw new Error("anchor creation failed")
				return { click() {
					if (downloadFailure === "click") throw new Error("download click failed")
					calls.clicks.push({ href: this.href, download: this.download })
				} }
			},
		},
		setTimeout: (callback, delay) => calls.timers.push({ callback, delay }),
	})
	return { calls, useDownloadPDF: script.runInContext(context) }
}

test("PDF download encodes names, sends CSRF, and releases its URL after the click", async () => {
	const blob = new Blob(["pdf"], { type: "application/pdf" })
	const { calls, useDownloadPDF } = setup(async () => ({ ok: true, blob: async () => blob }))
	await useDownloadPDF().downloadPDF({ doctype: "Leave Application", docname: "申请 & #1", filename: "请假单" })
	const [url, request] = calls.requests[0]
	assert.equal(url, "/api/method/hrms.api._download_pdf")
	assert.equal(request.method, "POST")
	assert.equal(request.headers["X-Frappe-Site-Name"], "hr.example.test")
	assert.equal(request.headers["X-Frappe-CSRF-Token"], "test-token")
	assert.deepEqual([...request.body], [["doctype", "Leave Application"], ["docname", "申请 & #1"]])
	assert.deepEqual(calls.blobs, [blob])
	assert.deepEqual(calls.clicks, [{ href: "blob:test-pdf", download: "请假单.pdf" }])
	assert.equal(calls.timers.length, 1)
	assert.ok(calls.timers[0].delay > 0)
	assert.deepEqual(calls.revoked, [])
	calls.timers[0].callback()
	assert.deepEqual(calls.revoked, ["blob:test-pdf"])
	assert.deepEqual(calls.toasts, [])
})

test("PDF download defaults the filename and omits unavailable CSRF", async () => {
	const { calls, useDownloadPDF } = setup(async () => ({ ok: true, blob: async () => new Blob() }), null)
	await useDownloadPDF(null).downloadPDF({ doctype: "Leave Application", docname: "LEAVE-001" })
	assert.equal(calls.clicks[0].download, "LEAVE-001.pdf")
	assert.equal(Object.hasOwn(calls.requests[0][1].headers, "X-Frappe-CSRF-Token"), false)
})

test("HTTP failure shows a translated error without reading or downloading the response", async () => {
	const { calls, useDownloadPDF } = setup(async () => ({
		ok: false,
		blob: () => assert.fail("Error responses must not be downloaded"),
	}))
	await useDownloadPDF((text) => `translated:${text}`).downloadPDF({ doctype: "Leave Application", docname: "LEAVE-001" })
	assert.equal(calls.toasts.length, 1)
	assert.equal(calls.toasts[0].title, "translated:Download Failed")
	assert.equal(calls.toasts[0].text, "translated:Error downloading PDF")
	assert.equal(calls.toasts[0].type, "error")
	assert.deepEqual(calls.blobs, [])
	assert.deepEqual(calls.clicks, [])
	assert.deepEqual(calls.timers, [])
})

test("network and response-body failures report errors without triggering a download", async () => {
	for (const fetchResponse of [
		async () => { throw new Error("offline") },
		async () => ({ ok: true, blob: async () => { throw "body unavailable" } }),
	]) {
		const { calls, useDownloadPDF } = setup(fetchResponse)
		await useDownloadPDF().downloadPDF({ doctype: "Leave Application", docname: "LEAVE-001" })
		assert.equal(calls.toasts.length, 1)
		assert.equal(calls.toasts[0].title, "Error")
		assert.match(calls.toasts[0].text, /^Error downloading PDF: (offline|body unavailable)$/)
		assert.equal(calls.toasts[0].type, "error")
		assert.deepEqual(calls.blobs, [])
		assert.deepEqual(calls.clicks, [])
		assert.deepEqual(calls.timers, [])
	}
})


test("PDF object URLs are released even when creating or clicking the link fails", async () => {
	for (const failure of ["create", "click"]) {
		const { calls, useDownloadPDF } = setup(
			async () => ({ ok: true, blob: async () => new Blob() }),
			"test-token",
			failure,
		)
		await useDownloadPDF().downloadPDF({ doctype: "Leave Application", docname: "LEAVE-001" })
		assert.equal(calls.blobs.length, 1)
		assert.deepEqual(calls.clicks, [])
		assert.equal(calls.toasts.length, 1)
		assert.equal(calls.toasts[0].type, "error")
		assert.match(calls.toasts[0].text, /(?:anchor creation|download click) failed$/)
		assert.equal(calls.timers.length, 1)
		calls.timers[0].callback()
		assert.deepEqual(calls.revoked, ["blob:test-pdf"])
	}
})
