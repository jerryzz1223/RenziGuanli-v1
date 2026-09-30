const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../hrms/public/js/erpnext/employee_list.js"), "utf8");

function harness(company = "A") {
	const calls = [];
	const dialogs = [];
	const messages = [];
	let refreshes = 0;
	const context = {
		console, Date, Map, Set, Promise, URL, URLSearchParams,
		window: {},
		document: { querySelector: () => null },
		sessionStorage: { getItem: () => null, setItem() {} },
		__: (text, values = []) => text.replace(/\{(\d+)\}/g, (_, index) => values[Number(index)]),
		frappe: {
			listview_settings: {},
			get_meta: () => ({ fields: [{ fieldname: "company" }] }),
			defaults: { get_user_default: () => company },
			utils: { escape_html: value => String(value) },
			msgprint: message => messages.push(message),
			show_alert() {},
			call: request => { calls.push(request); return Promise.resolve({ message: calls.length === 1 ? preview : { message: "done" } }); },
			ui: { Dialog: class {
				constructor(options) { this.options = options; dialogs.push(this); }
				show() {}
				hide() {}
			} },
		},
	};
	const preview = {
		company: "全部公司", companies: [{ company: "A" }, { company: "B" }], count: 4, employee_count: 3,
		confirmation_text: "清空全部员工及关联数据", plan_token: "token",
		records: [{ label: "员工主档", count: 3 }, { label: "考勤异常", count: 1 }],
		warnings: [{ label: "员工晋升", count: 1 }], blockers: [], linked_blockers: [],
	};
	vm.createContext(context);
	vm.runInContext(source.replace(/\}\)\(\);\s*$/, `
		globalThis.testAPI = { open_roster_cleanup_dialog, render_roster_cleanup_confirmation };
	})();`), context);
	return {
		api: context.testAPI, calls, dialogs, messages, preview,
		listview: { refresh() { refreshes++; }, start: 10 },
		refreshes: () => refreshes,
	};
}

(async () => {
	const blocked = harness();
	blocked.api.render_roster_cleanup_confirmation(blocked.listview, {
		...blocked.preview, linked_blockers: [{ label: "薪资单", count: 1 }],
	});
	assert.equal(blocked.dialogs[0].options.fields.length, 1);
	blocked.dialogs[0].options.primary_action({});
	assert.equal(blocked.calls.length, 0);

	const ready = harness();
	ready.api.open_roster_cleanup_dialog(ready.listview);
	await Promise.resolve();
	assert.equal(ready.calls[0].method, "hrms.api.data_operations.preview_all_employee_roster_cleanup");
	assert.equal(ready.dialogs.length, 1);
	assert.match(ready.dialogs[0].options.fields[0].options, /永久删除/);
	assert.match(ready.dialogs[0].options.fields[0].options, /3 名员工档案/);
	assert.match(ready.dialogs[0].options.fields[0].options, /正常流程取消已提交单据/);
	ready.dialogs[0].options.primary_action({ confirmation: "wrong", acknowledge: 1 });
	assert.equal(ready.calls.length, 1);
	ready.dialogs[0].options.primary_action({ confirmation: ready.preview.confirmation_text, acknowledge: 1 });
	await Promise.resolve();
	assert.equal(ready.calls[1].method, "hrms.api.data_operations.execute_all_employee_roster_cleanup");
	assert.equal(ready.calls[1].args.plan_token, "token");
	assert.equal(Object.hasOwn(ready.calls[1].args, "company"), false);
	assert.equal(Object.hasOwn(ready.calls[1].args, "cleanup_month"), false);
	assert.equal(ready.refreshes(), 1);
	console.log("Roster cleanup UI preview, blockers, confirmation and execution contract passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
