const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function controller() {
	const events = [];
	const context = {
		frappe: {
			pages: { "attendance-import-center": {} },
			confirm: (message, yes) => events.push({ kind: "confirm", message, yes }),
			msgprint: (options) => events.push({ kind: "error", ...options }),
		},
		__: (value) => value,
	};
	vm.createContext(context);
	const source = fs.readFileSync(path.join(__dirname, "../hrms/hr/page/attendance_import_center/attendance_import_center.js"), "utf8");
	vm.runInContext(source + "\nthis.Controller = AttendanceImportCenter;", context);
	const page = Object.create(context.Controller.prototype);
	page.company = "TEST-HRMS";
	page.attendance_month = "2099-10";
	page.escape = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	page.load_monthly_final = () => events.push({ kind: "refresh" });
	page.lock_and_generate_monthly_final_files = () => events.push({ kind: "lock" });
	return { page, events };
}

test("generation informs every missing item and only locks after acknowledgement", () => {
	const { page, events } = controller();
	const missing = Array.from({ length: 501 }, (_, index) => ({ employee_code: `TEST-${index}`, message: "缺少住房补贴" }));
	page.call_processing_api = (method, args, options) => {
		assert.equal(method, "get_monthly_final_generation_check");
		assert.equal(args.company, "TEST-HRMS");
		options.on_success({ ready: true, inputs: [{ label: "住房补贴", status: "已就绪", missing_items: missing }] });
	};
	page.generate_monthly_final_files();
	assert.equal(events.length, 1);
	assert.equal(events[0].kind, "confirm");
	for (const row of missing) assert.ok(events[0].message.includes(row.employee_code));
	events[0].yes();
	assert.equal(events[1].kind, "lock");
});

test("errors show all details and cannot invoke lock", () => {
	const { page, events } = controller();
	page.call_processing_api = (_method, _args, options) => options.on_success({ ready: false, inputs: [{ label: "考勤", status: "需修正", issues: [{ employee_code: "TEST-1", attendance_date: "2099-10-01", source_row: 23, message: "<img>无效工时" }, { employee_code: "TEST-2", message: "缺少工号" }] }] });
	page.generate_monthly_final_files();
	assert.equal(events[0].kind, "error");
	assert.ok(events[0].message.includes("TEST-1"));
	assert.ok(events[0].message.includes("TEST-2"));
	assert.ok(events[0].message.includes("第23行"));
	assert.ok(events[0].message.includes("&lt;img&gt;"));
	assert.ok(!events.some((entry) => entry.kind === "lock" || entry.kind === "confirm"));
});
