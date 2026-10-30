const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "hrms/public/js/hrms_announcement.js"), "utf8");

test("announcement API wrapper normalizes Frappe Deferred responses for cleanup", async () => {
	let resolveDeferred;
	const deferred = {
		then(resolve, reject) {
			resolveDeferred = resolve;
			return this;
		},
	};
	const hrms = {};
	const context = {
		window: { hrms },
		hrms,
		frappe: {
			call: () => deferred,
			utils: { escape_html: (value) => value },
		},
	};
	vm.runInNewContext(source, context, { filename: "hrms_announcement.js" });

	const request = context.window.hrms.announcement.call("hrms.api.announcement.review_announcement");
	assert.equal(typeof request.finally, "function", "shared wrapper must return a native Promise");
	const completion = request.finally(() => {});
	await Promise.resolve();
	resolveDeferred({ message: { saved: true } });
	assert.deepStrictEqual(await completion, { message: { saved: true } });
});
