const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
	path.join(__dirname, "../hrms/hr/page/employee_roster_import/employee_roster_import.js"),
	"utf8",
);
const start = source.indexOf("\tfunction confirm_import() {");
const end = source.indexOf("\n\tfunction download_failed_rows(", start);
assert(start >= 0 && end > start, "the roster submit handler must be present");
const handler = source.slice(start, end);

async function check_submit(request_succeeds) {
	const state = {
		mode: "replace",
		preview_result: { inserted: 3, updated: 189, archived: 0 },
		file: { file_url: "/private/files/roster.xlsx" },
		match_by: "employee_code",
		manual_mappings: {},
		row_overrides: {},
		import_in_progress: false,
	};
	let confirm_yes;
	let requests = 0;
	let progress_shown = 0;
	let progress_hidden = 0;
	let result_rendered = 0;
	let errors_shown = 0;
	const frappe = {
		confirm: (_message, yes) => { confirm_yes = yes; },
		call: (_options) => {
			requests++;
			// Installed Frappe returns a jQuery thenable, which has no .finally().
			return { then(resolve, reject) {
				if (request_succeeds) resolve({ message: { failed: 0 } });
				else reject({ message: "save failed" });
			} };
		},
		msgprint: () => { errors_shown++; },
	};
	const context = {
		Promise, JSON, state, frappe,
		__: (message) => message,
		page: { set_primary_action: () => {} },
		require_import_permission: () => true,
		render_import_progress: () => { progress_shown++; },
		hide_import_progress: () => { progress_hidden++; state.import_in_progress = false; },
		render_result: () => { result_rendered++; },
	};
	vm.runInNewContext(`${handler}\nconfirm_import();`, context);
	assert.equal(typeof confirm_yes, "function");
	assert.doesNotThrow(() => confirm_yes(), "confirm callback must not throw synchronously");
	await new Promise(setImmediate);
	assert.equal(requests, 1);
	assert.equal(progress_shown, 1);
	assert.equal(progress_hidden, 1);
	assert.equal(state.import_in_progress, false);
	assert.equal(result_rendered, request_succeeds ? 1 : 0);
	assert.equal(errors_shown, request_succeeds ? 0 : 1);
}

(async () => {
	await check_submit(true);
	await check_submit(false);
	console.log("Roster import handles jQuery requests and resets progress on success or failure.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
