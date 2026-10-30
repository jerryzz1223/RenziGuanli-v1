const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
	path.join(__dirname, "..", "hrms", "public", "js", "hrms_contextual_form_import.js"),
	"utf8",
);

function legacyDeferred({ response, error }) {
	return {
		then(resolve, reject) {
			if (error) reject(error);
			else resolve(response);
		},
	};
}

function flush() {
	return new Promise((resolve) => setImmediate(resolve));
}

function loadImportUi(previewReply) {
	let uploader;
	let dialog;
	const calls = [];
	const context = {
		window: {
			setTimeout(callback) { callback(); return 1; },
			clearTimeout() {},
			hrmsCapabilities: { require: () => true },
		},
		document: {},
		setTimeout(callback) { callback(); },
		__: (value) => value,
		$: () => ({ on() {} }),
		frappe: {
			defaults: { get_user_default: () => "永新" },
			utils: { escape_html: String },
			router: { on() {} },
			throw(message) { throw new Error(message); },
			call(options) {
				calls.push(options);
				if (options.method.endsWith("list_form_import_templates")) {
					return legacyDeferred({ response: { message: [{ key: "training_registration", label: "培训登记", description: "培训登记表" }] } });
				}
				return legacyDeferred(previewReply);
			},
			ui: {
				Dialog: class {
					constructor(options) {
						dialog = this;
						this.options = options;
						this.fields_dict = { import_content: { $wrapper: { html() {}, find: () => ({ on() {} }) } } };
					}
					show() {}
					set_primary_action(_label, action) { this.primaryAction = action; }
				},
				FileUploader: class {
					constructor(options) { uploader = options; }
				},
			},
		},
	};
	context.window.frappe = context.frappe;
	context.window.$ = context.$;
	vm.runInNewContext(source, context, { filename: "hrms_contextual_form_import.js" });
	return { calls, getDialog: () => dialog, getUploader: () => uploader, open: context.window.hrmsFormImport.open };
}

test("form import preview handles a then-only Deferred response", async () => {
	const ui = loadImportUi({ response: { message: { total_rows: 1, valid_rows: 1, failed_rows: 0 } } });
	await ui.open("training_registration");
	ui.getDialog().primaryAction();
	ui.getUploader().on_success({ file_url: "/private/files/training.xlsx" });
	await flush();

	assert.equal(ui.calls.length, 2);
	assert.equal(ui.calls[1].method, "hrms.api.form_data_intake.preview_form_import");
	assert.equal(ui.calls[1].args.company, "永新");
});

test("form import preview falls back cleanly when a then-only Deferred rejects", async () => {
	const ui = loadImportUi({ error: new Error("preview unavailable") });
	await ui.open("training_registration");
	ui.getDialog().primaryAction();
	ui.getUploader().on_success({ file_url: "/private/files/training.xlsx" });
	await flush();

	assert.equal(ui.calls.length, 2);
	assert.equal(ui.calls[1].method, "hrms.api.form_data_intake.preview_form_import");
});
