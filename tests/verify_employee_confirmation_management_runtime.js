const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class Element {
	constructor() { this.nodes = new Map(); this.events = new Map(); this.value = ""; this.content = ""; this[0] = {}; this.length = 1; }
	find(key) { if (!this.nodes.has(key)) this.nodes.set(key, new Element()); return this.nodes.get(key); }
	before() { return this; }
	parent() { return this; }
	on(event, selector, fn) { this.events.set(`${event}:${selector}`, fn); return this; }
	html(value) { if (value === undefined) return this.content; this.content = value; return this; }
	text(value) { return this.html(value); }
	val(value) { if (value === undefined) return this.value; this.value = value; return this; }
	empty() { this.content = ""; return this; }
	each() { return this; }
}
const requests = [];
const dialogs = [];
const routes = [];
let createAllowed = true;
const context = {
	console, Promise, MutationObserver: class { observe() {} },
	$: (value) => value instanceof Element ? value : new Element(),
	__: (text, args = []) => text.replace(/\{(\d+)\}/g, (_, n) => args[n]),
	window: { hrmsConfirmationEmployee: "EMP-1", hrmsCompanyContext: { getCurrentCompany: () => "公司甲" } },
	frappe: {
		listview_settings: {}, defaults: {},
		utils: { escape_html: (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;") },
		model: { can_create: () => createAllowed },
		datetime: { get_today: () => "2026-10-30" },
		set_route: (...args) => routes.push(args),
		call(options) {
			let resolve, reject;
			const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
			requests.push({ options, resolve, reject });
			// Mimic the then-only Deferred supplied by older Frappe builds.
			return { then: promise.then.bind(promise) };
		},
		ui: { Dialog: class {
			constructor(config) { this.config = config; dialogs.push(this); }
			show() { this.visible = true; }
			hide() { this.visible = false; }
			disable_primary_action() { this.disabled = true; }
			enable_primary_action() { this.disabled = false; }
		} },
	},
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../hrms/hr/doctype/employee_promotion/employee_promotion_list.js"), "utf8"), context);
const list = { $result: new Element(), $frappe_list: new Element(), page: { set_title(title) { this.title = title; }, set_primary_action(label, action) { this.label = label; this.action = action; } } };
const settings = context.frappe.listview_settings["Employee Promotion"];
const tick = () => new Promise((done) => setImmediate(done));

(async () => {
	settings.onload(list);
	settings.refresh(list);
	const panel = list.$confirmation_panel;
	assert.equal(list.page.title, "转正管理");
	assert.equal(list.page.label, "新增员工转正");
	assert.equal(requests[0].options.args.search, "EMP-1");
	assert.equal(requests[0].options.args.company, "公司甲");
	assert.equal(context.window.hrmsConfirmationEmployee, undefined);
	requests[0].resolve({ message: { total: 21, rows: [{ name: 'EMP-"1', employee_name: '<script>bad</script>', custom_employee_code: "1001", department: "生产部", designation: "操作员", date_of_joining: "2026-10-01", final_confirmation_date: "2026-11-01" }] } });
	await tick();
	const table = panel.find(".candidate-content").content;
	for (const label of ["工号", "姓名", "部门", "岗位", "入职日期", "计划转正日期"]) assert(table.includes(label));
	assert(table.includes("&lt;script>"));
	assert(!table.includes("<script>"));
	assert(table.includes('data-confirm="EMP-&quot;1"'));
	assert(panel.find(".candidate-paging").content.includes("下一页"));
	panel.events.get("click:[data-page]").call({ dataset: { page: "20" } });
	assert.equal(requests[1].options.args.start, 20);
	panel.find(".candidate-search").val("新搜索");
	panel.events.get("click:.candidate-reload")();
	assert.equal(requests[2].options.args.start, 0);
	requests[2].resolve({ message: { rows: [], total: 0 } });
	await tick();
	requests[1].resolve({ message: { rows: [{ employee_name: "过期结果" }], total: 1 } });
	await tick();
	assert(panel.find(".candidate-content").content.includes("暂无符合条件"));
	assert(!panel.find(".candidate-content").content.includes("过期结果"));
	panel.events.get("click:.candidate-reload")();
	requests[3].reject(new Error("permission denied"));
	await tick();
	assert(panel.find(".candidate-content").content.includes("查看权限"));
	panel.events.get("click:[data-confirm]").call({ dataset: { confirm: "EMP-1" } });
	const dialog = dialogs[0];
	assert.equal(dialog.config.title, "新增员工转正");
	assert.equal(dialog.config.fields.find((f) => f.fieldname === "confirmation_date").label, "转正日期");
	assert.equal(dialog.config.fields.find((f) => f.fieldname === "employee").default, "EMP-1");
	dialog.config.primary_action({ employee: "EMP-1", confirmation_date: "2026-10-30", notes: "面谈通过", result: "转正通过" });
	assert(dialog.disabled);
	requests[4].reject(new Error("validation failed"));
	await tick();
	assert(!dialog.disabled);
	assert(dialog.visible);
	dialog.config.primary_action({ employee: "EMP-1", confirmation_date: "2026-10-30", notes: "面谈通过", result: "转正通过" });
	requests[5].resolve({ message: "CONF-1" });
	await tick();
	assert(!dialog.visible);
	assert.deepEqual(routes[0], ["Form", "Employee Promotion", "CONF-1"]);
	createAllowed = false;
	panel.events.get("click:[data-confirm]").call({ dataset: { confirm: "EMP-2" } });
	assert.equal(dialogs.length, 1);
	console.log("Confirmation management runtime passed: permission scope, search/paging, stale responses, escaping, Chinese dialog and Deferred-compatible draft creation.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
