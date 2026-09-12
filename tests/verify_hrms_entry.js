const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

function classList() {
	const values = new Set();
	return {
		add: (...names) => names.forEach((name) => values.add(name)),
		contains: (name) => values.has(name),
		toggle: (name, enabled) => (enabled ? values.add(name) : values.delete(name)),
	};
}

test("root entry supports intranet Desktop icons without data-id", () => {
	const appended = [];
	const entry = {
		classList: classList(),
		append: (...nodes) => appended.push(...nodes),
		querySelector(selector) {
			if (selector === ".icon-title") return { setAttribute() {} };
			if (selector === "img.app-icon") return { getAttribute: () => "", setAttribute() {} };
			return null;
		},
	};
	const wrapper = {
		classList: classList(),
		querySelector(selector) {
			if (selector.includes('href="/desk/hrms-workbench"')) return entry;
			return null;
		},
	};
	const body = { classList: classList() };
	const document = {
		body,
		readyState: "complete",
		createElement: () => ({ className: "", innerHTML: "", textContent: "" }),
		getElementById: () => null,
		querySelector: (selector) => (selector === ".desktop-wrapper" ? wrapper : null),
		querySelectorAll: () => [],
	};
	const window = { location: { pathname: "/" }, frappe: { router: { on() {} } } };
	const source = fs.readFileSync(path.join(projectRoot, "hrms/public/js/hrms_entry.js"), "utf8");

	vm.runInNewContext(source, {
		document,
		window,
		MutationObserver: class {
			observe() {}
		},
		requestAnimationFrame: (callback) => callback(),
	});

	assert.equal(body.classList.contains("hrms-entry-page"), true);
	assert.equal(wrapper.classList.contains("hrms-entry"), true);
	assert.equal(entry.classList.contains("hrms-entry-card"), true);
	assert.equal(appended.length, 2);
});

test("entry layout hides non-HRMS Desktop icons", () => {
	const css = fs.readFileSync(path.join(projectRoot, "hrms/public/css/hrms_entry.css"), "utf8");
	assert.match(css, /a\.desktop-icon:not\(\.hrms-entry-card\)\s*\{\s*display:\s*none\s*!important;/);
});
