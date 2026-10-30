const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { test } = require("node:test");

const source = fs.readFileSync(
	path.join(__dirname, "..", "hrms", "public", "js", "hrms_test_data_reset.js"),
	"utf8",
);

function flush() {
	return new Promise((resolve) => setImmediate(resolve));
}

function legacyDeferred({ response, error }) {
	return {
		then(resolve, reject) {
			if (error) reject(error);
			else resolve(response);
		},
	};
}

function loadResetControl(reply) {
	const buttons = [];
	const routeHandlers = [];
	const calls = [];
	const document = {
		body: {
			appendChild(button) {
				buttons.push(button);
			},
		},
		querySelector(selector) {
			if (selector === ".hrms-test-data-reset") return buttons.at(-1);
			return null;
		},
		createElement() {
			return {
				addEventListener(event, listener) {
					if (event === "click") this.click = listener;
				},
				remove() {
					const index = buttons.indexOf(this);
					if (index >= 0) buttons.splice(index, 1);
				},
			};
		},
	};
	const context = {
		window: {},
		document,
		setTimeout(callback) {
			callback();
		},
		__: (value) => value,
		$: (target) => ({ ready: (callback) => callback() }),
		frappe: {
			get_route: () => ["List", "Employee"],
			router: { on: (_event, callback) => routeHandlers.push(callback) },
			call(options) {
				calls.push(options);
				return legacyDeferred(reply);
			},
			show_alert() {},
		},
	};
	context.window.frappe = context.frappe;
	vm.runInNewContext(source, context, { filename: "hrms_test_data_reset.js" });
	return { buttons, calls, routeHandlers };
}

test("test-data reset control supports a then-only Deferred preview response", async () => {
	const control = loadResetControl({ response: { message: { enabled: true } } });
	await flush();

	assert.equal(control.calls.length, 1);
	assert.equal(control.calls[0].method, "hrms.api.test_data_reset.get_test_data_reset_context");
	assert.equal(control.buttons.length, 1);
	assert.match(control.buttons[0].className, /btn-danger/);
});

test("test-data reset control removes its button when a then-only Deferred rejects", async () => {
	const control = loadResetControl({ error: new Error("preview unavailable") });
	await flush();

	assert.equal(control.calls.length, 1);
	assert.equal(control.buttons.length, 0);
});
