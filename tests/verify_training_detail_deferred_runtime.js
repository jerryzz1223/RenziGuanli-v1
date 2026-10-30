const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(
	path.join(__dirname, "../hrms/hr/doctype/training_program/training_program_list.js"),
	"utf8",
);
const start = source.indexOf("\tfunction open_training_detail(");
const end = source.indexOf("\n\tfunction render_dashboard", start);
const detailLoader = source.slice(start, end);
const flush = () => new Promise(setImmediate);

function legacyDeferred({ response, error }) {
	return {
		then(resolve, reject) {
			if (error) return Promise.reject(error).then(resolve, reject);
			else resolve(response);
		},
	};
}

function loadDetail({ response, error }) {
	const calls = [];
	const rendered = [];
	const state = { reloads: 0 };
	const context = {
		Promise,
		__: (value) => value,
		frappe: {
			call(options) {
				calls.push(options);
				return legacyDeferred({ response, error });
			},
		},
		currentCompany: () => "永新",
		render_training_detail: (_workspace, detail) => rendered.push(detail),
	};
	vm.createContext(context);
	vm.runInContext(`${detailLoader}\nthis.openTrainingDetail = open_training_detail;`, context);
	const workspace = { innerHTML: "" };
	context.openTrainingDetail({ kind: "plan", program: "TP-0001" }, workspace, () => { state.reloads += 1; });
	return { calls, rendered, state, workspace };
}

test("training detail supports a then-only Deferred response", async () => {
	const result = loadDetail({ response: { message: { name: "TP-0001", title: "安全培训" } } });
	await flush();
	assert.equal(result.workspace.__trainingDetailRow.program, "TP-0001");
	assert.equal(result.workspace.innerHTML.includes("正在读取课程详情"), true);
	assert.deepEqual(JSON.parse(JSON.stringify(result.calls[0].args)), { kind: "plan", name: "TP-0001", company: "永新" });
	assert.deepEqual(JSON.parse(JSON.stringify(result.rendered)), [{ name: "TP-0001", title: "安全培训" }]);
	assert.equal(result.state.reloads, 0);
});

test("training detail returns to the list after a then-only Deferred rejection", async () => {
	const result = loadDetail({ error: new Error("network unavailable") });
	await flush();
	await flush();
	assert.deepEqual(result.rendered, []);
	assert.equal(result.state.reloads, 1);
});
