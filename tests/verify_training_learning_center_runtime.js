const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadHome(call) {
	const source = fs.readFileSync(
		path.join(root, "hrms/hr/page/training_learning_center/training_learning_center.js"),
		"utf8",
	);
	const classSource = source.slice(source.indexOf("class TrainingLearningHome"));
	const context = {
		__: (value) => value,
		window: {},
		frappe: {
			call,
			defaults: { get_user_default: () => "永新" },
			utils: { escape_html: String },
		},
	};
	vm.createContext(context);
	vm.runInContext(`${classSource}\nthis.TrainingLearningHome = TrainingLearningHome;`, context);
	const wrapper = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
	const page = { main: [wrapper], set_title() {} };
	const home = new context.TrainingLearningHome(page);
	home.render = (data) => { home.rendered = data; };
	home.render_error = () => { home.renderErrorCount = (home.renderErrorCount || 0) + 1; };
	return home;
}

function deferred() {
	let resolveRequest;
	let rejectRequest;
	return {
		then(resolve, reject) {
			resolveRequest = resolve;
			rejectRequest = reject;
		},
		resolve(value) { resolveRequest(value); },
		reject(error) { rejectRequest(error); },
	};
}

test("training learning home coalesces legacy Deferred loads and releases the refresh guard", async () => {
	let callCount = 0;
	let activeDeferred;
	const home = loadHome(() => {
		callCount += 1;
		activeDeferred = deferred();
		return activeDeferred;
	});

	const firstLoad = home.show();
	const secondLoad = home.show();
	assert.strictEqual(secondLoad, firstLoad, "concurrent page loads must share one in-flight request");
	assert.equal(callCount, 1, "a shared in-flight request must issue one RPC");

	await new Promise((resolve) => setImmediate(resolve));
	activeDeferred.resolve({ message: { metrics: { planned_courses: 3 } } });
	await firstLoad;
	assert.equal(home.load_promise, null, "a completed load must release the refresh guard");
	assert.deepEqual(home.rendered, { metrics: { planned_courses: 3 } });

	const refresh = home.show(true);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(callCount, 2, "a forced refresh after completion must start a new RPC");
	activeDeferred.resolve({ message: { metrics: { planned_courses: 4 } } });
	await refresh;
});

test("training learning home releases the Deferred guard after a failed load", async () => {
	let callCount = 0;
	let activeDeferred;
	const home = loadHome(() => {
		callCount += 1;
		activeDeferred = deferred();
		return activeDeferred;
	});

	const failedLoad = home.show();
	await new Promise((resolve) => setImmediate(resolve));
	activeDeferred.reject(new Error("network unavailable"));
	await failedLoad;
	assert.equal(home.load_promise, null, "a failed load must not leave the page permanently locked");
	assert.equal(home.renderErrorCount, 1);

	const retry = home.show();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(callCount, 2, "a failed request must permit a later retry");
	activeDeferred.resolve({ message: { metrics: {} } });
	await retry;
});
